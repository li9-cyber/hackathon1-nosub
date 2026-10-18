"""Voice chat embedded in the career app, using DigitalLife's existing providers.

Provider access is off by default. When enabled in Cloud Run, the original durable
allowance is shared atomically; conversation state lives in its own namespace.
No local ledger or new allowance is ever created.
"""
import asyncio
import copy
import hashlib
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, model_validator

from career_twin.shared.core.config import RUNTIME
from career_twin.interview.runtime.avatar.cloud_store import CloudChatStore
from career_twin.interview.runtime.avatar.live_chat import stream_turn
from career_twin.interview.runtime.avatar.state import AvatarSession
from career_twin.interview.runtime.avatar.tts import GoogleAudioService
from career_twin.interview.runtime.cloudrun import chatbot
from career_twin.interview.runtime.cloudrun.store import Rejected, assert_cloud, enabled, provider_window_open
from career_twin.interview.runtime.config import Settings


class ScopedStore:
    """Isolate the interview session while preserving global charges and test state."""
    keys = ('session', 'active', 'chat_active', 'chat_requests')

    def __init__(self, base):
        self.base = base

    def view(self, state):
        value = copy.deepcopy(state)
        namespace = value.get('hackathon_voice', {})
        for key in self.keys:
            value[key] = copy.deepcopy(namespace.get(key, {} if key == 'chat_requests' else None))
        return value

    def read(self):
        state, generation = self.base.read()
        return self.view(state), generation

    def change(self, transform):
        def scoped(state):
            value = self.view(state)
            result = transform(value)
            state['hackathon_voice'] = {key: value[key] for key in self.keys}
            for key, item in value.items():
                if key not in (*self.keys, 'hackathon_voice'):
                    state[key] = item
            return result
        return self.base.change(scoped)

    def reserve(self, chars, request_id):
        return self.base.reserve(chars, request_id)

    def headers(self):
        return self.base.headers()

    def close(self):
        self.base.close()


class Turn(BaseModel):
    pilot_mode: Literal['interview_interviewer', 'interview_coach'] = 'interview_interviewer'
    request_id: uuid.UUID
    text: str = Field(default='', max_length=4000)
    # 150 s, mono 16 kHz PCM plus WAV/base64 overhead. Duration is checked below.
    audio_wav: str = Field(default='', max_length=6_500_000)
    history: list[dict[Literal['role', 'content'], str]] = Field(default_factory=list, max_length=24)
    client_sequence: int = Field(ge=1)

    @model_validator(mode='after')
    def valid(self):
        if bool(self.text.strip()) == bool(self.audio_wav):
            raise ValueError('Provide exactly one input')
        if sum(len(m.get('content', '')) for m in self.history) > 12000:
            raise ValueError('History too large')
        for message in self.history:
            if message.get('role') not in ('user', 'assistant') or not 1 <= len(message.get('content', '')) <= 4000:
                raise ValueError('Invalid history')
        return self


class Command(BaseModel):
    client_sequence: int = Field(ge=1)


def owner(request):
    from career_twin.shared.projects.project_context import current
    if current.get():
        return current.get().scoped_owner
    # IAP strips forged identity headers at the cloud ingress. Local mode cannot
    # enable live providers. No CV or personal profile is used by this component.
    if os.environ.get('K_SERVICE'):
        if getattr(request.state, 'career_authenticated', False):
            from career_twin.shared.projects.project_context import owner as workspace_owner
            return 'general:' + workspace_owner(request)
        identity = request.headers.get('x-goog-authenticated-user-email', '')
        if not identity.startswith('accounts.google.com:'):
            raise Rejected('SIGN_IN_REQUIRED', 403)
        return identity
    if request.headers.get('x-career-general') == '1':
        from career_twin.shared.projects.project_context import owner as workspace_owner
        return 'general:' + workspace_owner(request)
    return 'local'


class VoiceChat:
    def __init__(self, store=None, synth=None, tokens=None, transcriber=None):
        self.store, self.synth = store, synth
        self.tokens, self.transcriber = tokens, transcriber
        self.current = None
        self.current_owner = None
        self.client = None
        self.gate = asyncio.Lock()
        self.connect_gate = asyncio.Lock()
        self.tasks = set()
        self.failure = None

    async def open(self):
        if not self.store and os.environ.get('INTERVIEW_VOICE_ENABLED') == '1':
            try:
                assert_cloud()
                self.store = ScopedStore(await asyncio.to_thread(CloudChatStore))
                root = Path('/tmp/hackathon-voice')
                root.mkdir(parents=True, exist_ok=True)
                self.synth = GoogleAudioService(Settings(state_dir=root), enabled=True, ledger=self.store)
            except Exception:
                # A voice configuration error must not take down CV/job workflows.
                self.failure = 'VOICE_CONFIGURATION_UNAVAILABLE'
        self.client = httpx.AsyncClient(limits=httpx.Limits(max_connections=6, max_keepalive_connections=4))

    async def close(self):
        if self.current:
            self.current.cancel.set()
        if self.synth:
            self.synth.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)
        if self.client:
            await self.client.aclose()
        if self.store:
            self.store.close()

    async def status(self):
        reason = self.failure or 'VOICE_NOT_ENABLED'
        if self.store and self.synth:
            try:
                state, _ = await asyncio.to_thread(self.store.read)
                reason = ('DEMO_WINDOW_CLOSED' if not provider_window_open(state, time.time()) else
                          'GPU_ALLOWANCE_EXHAUSTED' if state['gpu_reserved_microusd'] >= state['gpu_limit_microusd'] else
                          'CHAT_KEY_MISSING' if not self.tokens and not os.environ.get('DEEPSEEK_API_KEY', '').strip() else None)
            except Exception:
                reason = 'VOICE_CONFIGURATION_UNAVAILABLE'
        return {'ready': reason is None, 'reason': reason, 'language': 'en-US'}

    async def require_ready(self):
        status = await self.status()
        if not status['ready']:
            raise Rejected(status['reason'], 503)

    def session(self, sid, identity):
        if not self.current or self.current.id != sid or self.current_owner != identity:
            raise Rejected('SESSION_NOT_FOUND', 404)
        if self.current.expires < time.monotonic():
            self.current.cancel.set()
            raise Rejected('SESSION_EXPIRED', 410)
        return self.current

    def sync(self, session):
        def update(state):
            state['session'] = {'id': session.id, 'generation': session.sequence, 'expires': time.time() + 900}
            if state.get('chat_active'):
                state['chat_requests'][state['chat_active']['id']]['cancelled'] = True
                state['chat_active'] = None
        self.store.change(update)

    def advance(self, session, sequence, request_id=None):
        try:
            return session.advance(sequence, request_id)
        except HTTPException as error:
            raise Rejected(str(error.detail), error.status_code) from None


@asynccontextmanager
async def lifespan(app):
    runtime = VoiceChat()
    app.state.voice_chat = runtime
    await runtime.open()
    try:
        yield
    finally:
        await runtime.close()


router = APIRouter(prefix='/api/interview')


def runtime(request):
    value = getattr(request.app.state, 'voice_chat', None)
    if value is None:
        raise Rejected('VOICE_NOT_ENABLED', 503)
    return value


@router.get('/config')
async def config(request: Request):
    value = getattr(request.app.state, 'voice_chat', None)
    return await value.status() if value else {'ready': False, 'reason': 'VOICE_NOT_ENABLED', 'language': 'en-US'}


@router.post('/sessions')
async def connect(request: Request):
    value = runtime(request)
    identity = owner(request)
    await value.require_ready()
    async with value.connect_gate:
        if value.current and value.current.expires > time.monotonic():
            raise Rejected('BUSY', 409)
        if value.current:
            value.current.cancel.set()
            value.synth.cancel()
        session = AvatarSession()
        await asyncio.to_thread(value.sync, session)
        value.current, value.current_owner = session, identity
        return session.snapshot()


@router.post('/sessions/{sid}/stop')
async def stop(sid: str, body: Command, request: Request):
    value = runtime(request)
    async with value.connect_gate:
        session = value.session(sid, owner(request))
        value.advance(session, body.client_sequence)
        value.synth.cancel()
        await asyncio.to_thread(value.sync, session)
    return {'stopped': True}


@router.post('/sessions/{sid}/end')
async def end(sid: str, body: Command, request: Request):
    value = runtime(request)
    async with value.connect_gate:
        session = value.session(sid, owner(request))
        value.advance(session, body.client_sequence)
        session.cancel.set()
        value.synth.cancel()
        await asyncio.to_thread(value.sync, session)
        session.expires = 0
        value.current_owner = None
    return {'ended': True}


@router.get('/cue')
async def cue(request: Request):
    value = runtime(request)
    owner(request)
    await value.require_ready()
    key = hashlib.sha256('en-US-Chirp3-HD-Charon:en-US:Go ahead.'.encode()).hexdigest()[:20]
    path = RUNTIME / 'interview/runtime/seed' / f'chat-cue-{key}.wav'
    if not path.is_file():
        raise Rejected('CUE_UNAVAILABLE', 503)
    if isinstance(value.synth, GoogleAudioService):
        await asyncio.gather(asyncio.to_thread(value.store.headers), asyncio.to_thread(value.synth.prepare))
    # Reuse the already generated acknowledgement; no synthesis on page load.
    return FileResponse(path, media_type='audio/wav')


@router.post('/sessions/{sid}/chat-stream')
async def turn(sid: str, body: Turn, request: Request):
    value = runtime(request)
    token_source = value.tokens
    context_status = {}
    from career_twin.interview.context import build, validate_revision
    context = build(body.pilot_mode) if request.headers.get('x-career-general') != '1' else None
    if context:
        from career_twin.interview.runtime.avatar.live_chat import answer_tokens
        context_status.update(context.status())
        async def contextual_tokens(client, transcript, history):
            await asyncio.to_thread(validate_revision, context)
            source = value.tokens or answer_tokens
            last_check = time.monotonic()
            async for token in source(client, transcript, history, context=context):
                if time.monotonic() - last_check > .5:
                    await asyncio.to_thread(validate_revision, context)
                    last_check = time.monotonic()
                yield token
            await asyncio.to_thread(validate_revision, context)
        token_source = contextual_tokens
    audio, seconds = chatbot.parse_wav(body.audio_wav, max_seconds=150, max_bytes=4_850_000) if body.audio_wav else (None, 0)
    async with value.connect_gate:
        session = value.session(sid, owner(request))
        await value.require_ready()
        cancel = value.advance(session, body.client_sequence, str(body.request_id))
        sequence = session.sequence
        value.synth.cancel()
        await asyncio.to_thread(value.sync, session)
        await asyncio.to_thread(value.store.change, lambda state: chatbot.begin_chat(state, sid, str(body.request_id), seconds, time.time()))

    async def speak(text, rid):
        async with value.gate:
            if value.current is not session or not session.current(sequence):
                raise Rejected('CHAT_CANCELLED')
            task = asyncio.create_task(asyncio.to_thread(value.synth.synthesize, text, rid, cancel))
            value.tasks.add(task)
            task.add_done_callback(value.tasks.discard)
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                cancel.set()
                value.synth.cancel()
                await asyncio.shield(task)
                raise

    async def events():
        reported_context = False
        try:
            async for event in stream_turn(value.store, sid, str(body.request_id), body.text.strip(),
                    audio, body.history, speak, cancel, token_source, value.transcriber, value.client):
                if context_status and not reported_context:
                    reported_context = True
                    yield json.dumps({'type': 'context', **context_status}) + '\n'
                yield event
        finally:
            cancel.set()
            if value.current is session and session.sequence == sequence:
                value.synth.cancel()

    return StreamingResponse(events(), media_type='application/x-ndjson', headers={'X-Accel-Buffering': 'no'})
