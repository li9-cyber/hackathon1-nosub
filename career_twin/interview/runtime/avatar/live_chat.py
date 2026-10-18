"""Sentence-streamed local conversation; provider adapters remain server-side."""
import asyncio
import base64
import io
import json
import re
import sys
import time
import wave
from array import array
from contextlib import asynccontextmanager

import httpx

from career_twin.interview.runtime.cloudrun import chatbot
from career_twin.interview.runtime.cloudrun.store import Rejected

PROMPT = (
    chatbot.INTERVIEW_ROLE +
    'Respond to the candidate\'s actual answers and remember the interview context. '
    'Usually use a few short spoken sentences. '
    'Use plain speech without Markdown or stage directions. Never invent what you heard. '
    'You are a virtual avatar, so do not invent a real-world biography or personal experiences.'
)


def take_sentences(buffer, final=False):
    """Small complete clauses start speaking before the rest of the reply arrives."""
    result = []
    while buffer:
        boundary = re.search(r'[.!?。！？](?:["\u201d\u2019])?(?:\s+|$)', buffer)
        end = boundary.end() if boundary else 0
        if not end and len(buffer) >= 220:
            end = buffer.rfind(' ', 0, 220)
            if end < 40:
                end = 220
        if not end and final:
            end = len(buffer)
        if not end:
            break
        part, buffer = buffer[:end].strip(), buffer[end:]
        if part:
            result.append(part)
    return result, buffer


async def answer_tokens(client, text, history, context=None):
    import os
    background = [{'role': 'user', 'content': json.dumps({'background_data': context.data}, ensure_ascii=False)}] if context else []
    async with client.stream('POST', 'https://api.deepseek.com/chat/completions',
            headers={'Authorization': 'Bearer ' + os.environ['DEEPSEEK_API_KEY'].strip()},
            json={'model': chatbot.CHAT_MODEL, 'thinking': {'type': 'disabled'},
                  'stream': True, 'max_tokens': 512,
                  'messages': [{'role': 'system', 'content': (PROMPT if not context else context.prompt + ' Speak concise natural English, without Markdown. You are a virtual avatar.')}, *background, *history,
                               {'role': 'user', 'content': text}]}, timeout=40) as response:
        if response.status_code != 200:
            codes = {401: 'CHAT_KEY_REJECTED', 403: 'CHAT_KEY_REJECTED',
                     402: 'CHAT_BALANCE_EMPTY', 429: 'CHAT_PROVIDER_BUSY'}
            raise Rejected(codes.get(response.status_code, 'CHAT_PROVIDER_FAILED'), 502)
        finished, count = False, 0
        async for line in response.aiter_lines():
            if not line.startswith('data:'):
                continue
            payload = line[5:].strip()
            if payload == '[DONE]':
                break
            try:
                data = json.loads(payload)
                choice = data['choices'][0]
                delta = choice.get('delta', {})
                if delta.get('tool_calls'):
                    raise ValueError('Unexpected tool call')
                token = delta.get('content') or ''
                if not isinstance(token, str):
                    raise ValueError('Invalid content')
                reason = choice.get('finish_reason')
                if reason:
                    if reason != 'stop':
                        raise Rejected('CHAT_RESPONSE_INCOMPLETE', 502)
                    finished = True
                count += len(token)
                if count > 4000:
                    raise ValueError('Oversized reply')
                if token:
                    yield token  # reasoning_content is deliberately not spoken.
            except (KeyError, IndexError, ValueError, TypeError):
                raise Rejected('CHAT_INVALID_RESPONSE', 502) from None
        if not finished or not count:
            raise Rejected('CHAT_RESPONSE_INCOMPLETE', 502)


def recognition_chunks(audio):
    """Keep one answer; bound inline STT requests below Google's 60 s limit.

    Non-overlapping PCM spans cover every sample. Prefer a quiet boundary between
    50 and 55 seconds, so a 150-second answer needs at most three provider calls.
    Audio stays in request memory, never in a storage bucket.
    """
    with wave.open(io.BytesIO(audio), 'rb') as source:
        rate, count = source.getframerate(), source.getnframes()
        if count <= rate * 55:
            return [audio]
        params, pcm = source.getparams(), source.readframes(count)
    chunks, start = [], 0
    while start < count:
        end = min(count, start + rate * 55)
        if end < count:
            # 20 ms windows; choose a low-energy boundary near the end.
            step = max(1, rate // 50)
            def energy(at):
                samples = array('h', pcm[at * 2:(at + step) * 2])
                if sys.byteorder != 'little':
                    samples.byteswap()
                return sum(v * v for v in samples)
            end = min(range(start + rate * 50, end, step), key=energy)
        output = io.BytesIO()
        with wave.open(output, 'wb') as target:
            target.setparams(params)
            target.writeframes(pcm[start * 2:end * 2])
        chunks.append(output.getvalue())
        start = end
    return chunks


async def transcribe_conversation(client, store, audio):
    async def recognize(chunk):
        try:
            return await chatbot.transcribe(client, store, chunk, model='latest_long')
        except Rejected as error:
            if error.code == 'NO_SPEECH_DETECTED':
                return ''  # A thinking pause is not a failed answer.
            raise
    tasks = [asyncio.create_task(recognize(chunk)) for chunk in recognition_chunks(audio)]
    try:
        text = ' '.join(part for part in await asyncio.gather(*tasks) if part)
    finally:
        # Failed recognition or user cancellation must not leave paid calls running.
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    if not text:
        raise Rejected('NO_SPEECH_DETECTED', 422)
    if len(text) > 4000:
        raise Rejected('TRANSCRIPT_TOO_LONG', 422)
    return text


@asynccontextmanager
async def provider_connection(client):
    if client is not None:
        yield client
    else:
        async with httpx.AsyncClient() as temporary:
            yield temporary


async def stream_turn(store, sid, rid, text, audio, history, synthesize, cancelled,
                      token_source=None, transcriber=None, provider_client=None):
    """The route reserves the turn before yielding HTTP headers. Never retry providers."""
    token_source = token_source or answer_tokens
    transcriber = transcriber or transcribe_conversation
    events, sentences = asyncio.Queue(maxsize=8), asyncio.Queue(maxsize=2)
    started = time.monotonic()
    reply, transcript = '', text
    failure = None
    last_verification = 0

    async def verify(force=False):
        nonlocal last_verification
        if cancelled.is_set():
            raise Rejected('CHAT_CANCELLED')
        # Session commands immediately set the shared cancellation event. Check
        # persistent expiry periodically, not via a filesystem lock for every token.
        if not force and time.monotonic() - last_verification < .5:
            return
        state, _ = await asyncio.to_thread(store.read)
        chatbot.chat_current(state, sid, rid)
        last_verification = time.monotonic()

    async def generate():
        nonlocal reply, transcript
        async with provider_connection(provider_client) as client:
            await verify()
            recognition_started = time.monotonic()
            if audio:
                await events.put({'type': 'state', 'state': 'transcribing'})
                transcript = await transcriber(client, store, audio)
            await verify()
            await events.put({'type': 'transcript', 'text': transcript,
                              'stt_ms': round((time.monotonic() - recognition_started) * 1000) if audio else 0})
            await events.put({'type': 'state', 'state': 'thinking'})
            buffer = ''
            async for token in token_source(client, transcript, history):
                await verify()
                reply += token
                buffer += token
                await events.put({'type': 'text', 'delta': token})
                parts, buffer = take_sentences(buffer)
                for part in parts:
                    await sentences.put(part)
            parts, _ = take_sentences(buffer, final=True)
            for part in parts:
                await sentences.put(part)
            await sentences.put(None)

    async def voice():
        sequence = 0
        while (part := await sentences.get()) is not None:
            await verify(force=True)
            stream, metrics = await synthesize(part, f'{rid}:{sequence}')
            await verify()
            await events.put({'type': 'audio', 'sequence': sequence, 'text': part,
                              'wav': base64.b64encode(stream.wav()).decode(),
                              'tts_ms': metrics.get('tts_ms'),
                              'elapsed_ms': round((time.monotonic() - started) * 1000)})
            sequence += 1

    async def run():
        nonlocal failure
        generating, speaking = asyncio.create_task(generate()), asyncio.create_task(voice())
        try:
            await asyncio.gather(generating, speaking)
            await verify()
            await asyncio.to_thread(store.change, lambda s: chatbot.finish_chat(s, sid, rid, reply))
            await events.put({'type': 'done', 'reply': reply, 'transcript': transcript,
                              'elapsed_ms': round((time.monotonic() - started) * 1000)})
        except Exception as error:
            code = error.code if isinstance(error, Rejected) else (
                'CHAT_NETWORK_ERROR' if isinstance(error, httpx.HTTPError) else 'CHAT_PROVIDER_FAILED')
            failure = {'type': 'error', 'code': code}
            await events.put(failure)
        finally:
            generating.cancel()
            speaking.cancel()
            await asyncio.gather(generating, speaking, return_exceptions=True)

    task = asyncio.create_task(run())
    try:
        async with asyncio.timeout(100):
            while True:
                try:
                    event = await asyncio.wait_for(events.get(), timeout=.5)
                except TimeoutError:
                    await verify()
                    continue
                if failure:
                    event = failure
                if event['type'] != 'error':
                    await verify()
                yield json.dumps(event, ensure_ascii=False) + '\n'
                if event['type'] in ('done', 'error'):
                    break
    except (Rejected, TimeoutError) as error:
        yield json.dumps({'type': 'error', 'code': getattr(error, 'code', 'CHAT_TIMEOUT')}) + '\n'
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.to_thread(store.change, lambda s: chatbot.abandon_chat(s, rid))
