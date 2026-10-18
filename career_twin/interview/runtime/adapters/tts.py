import hashlib
import json
import os
import re
import threading

from google.api_core.client_options import ClientOptions
from google.cloud import texttospeech

from career_twin.interview.runtime.budget import TTSLedger


class Cancelled(RuntimeError):
    pass


def split_text(text, size=160):
    """Preserve every character; split only for bounded streaming requests."""
    while text:
        end = min(size, len(text))
        if end < len(text):
            boundaries = [m.end() for m in re.finditer(r'[.!?]\s+|\s+', text[:end])]
            if boundaries:
                end = boundaries[-1]
        yield text[:end]
        text = text[end:]


class GoogleTTS:
    # Raw signed little-endian PCM, mono, 16 kHz. No WAV header, no browser TTS.
    sample_rate = 16000

    def __init__(self, settings):
        self.settings = settings
        self.client = texttospeech.TextToSpeechClient(
            client_options=ClientOptions(api_endpoint=settings.endpoint))
        self.ledger = TTSLedger(settings.state_dir, settings.tts_total_chars)
        self.cache = settings.state_dir / 'tts-cache'
        self.cache.mkdir(exist_ok=True)
        self.call = None
        self.lock = threading.Lock()
        self.validated = False

    def validate_voice(self):
        voices = self.client.list_voices(language_code=self.settings.language, retry=None, timeout=15).voices
        self.validated = any(v.name == self.settings.voice and
                             v.ssml_gender == texttospeech.SsmlVoiceGender.MALE for v in voices)
        if not self.validated:
            raise RuntimeError('Configured male voice unavailable; no automatic voice fallback')

    def key(self, text):
        data = {'text': text, 'voice': self.settings.voice, 'language': self.settings.language,
                'endpoint': self.settings.endpoint, 'format': 'PCM_S16LE', 'rate': self.sample_rate, 'channels': 1}
        return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

    def cancel(self):
        with self.lock:
            if self.call is not None:
                self.call.cancel()

    def stream(self, text, request_id, cancel, consume):
        if not self.validated:
            raise RuntimeError('Voice was not validated')
        target = self.cache / (self.key(text) + '.pcm')
        if target.exists():
            with target.open('rb') as handle:
                while chunk := handle.read(6400):
                    if cancel.is_set():
                        raise Cancelled()
                    consume(chunk)
            return {'cache_hit': True}
        if cancel.is_set():
            raise Cancelled()
        # Reserve the entire input before contacting a billable RPC. No automatic retries.
        self.ledger.reserve(len(text), request_id)
        config = texttospeech.StreamingSynthesizeConfig(
            voice=texttospeech.VoiceSelectionParams(name=self.settings.voice,
                                                  language_code=self.settings.language),
            streaming_audio_config=texttospeech.StreamingAudioConfig(
                audio_encoding=texttospeech.AudioEncoding.PCM, sample_rate_hertz=self.sample_rate))

        def requests():
            yield texttospeech.StreamingSynthesizeRequest(streaming_config=config)
            for segment in split_text(text):
                if cancel.is_set():
                    return
                yield texttospeech.StreamingSynthesizeRequest(
                    input=texttospeech.StreamingSynthesisInput(text=segment))

        temporary = target.with_suffix('.partial')
        total = 0
        try:
            call = self.client.streaming_synthesize(requests=requests(), retry=None, timeout=90)
            with self.lock:
                self.call = call
                if cancel.is_set():
                    call.cancel()
            with temporary.open('wb') as handle:
                for response in call:
                    if cancel.is_set():
                        raise Cancelled()
                    data = response.audio_content
                    total += len(data)
                    if total > self.sample_rate * 2 * 120:
                        raise RuntimeError('TTS audio exceeds 120 seconds')
                    handle.write(data)
                    consume(data)  # Backpressure propagates to the gRPC receive loop.
                handle.flush()
                os.fsync(handle.fileno())
            if cancel.is_set():
                raise Cancelled()
            if total == 0 or total % 2:
                raise RuntimeError('Invalid PCM stream')
            os.replace(temporary, target)
            return {'cache_hit': False}
        finally:
            with self.lock:
                if self.call is not None:
                    self.call.cancel()
                self.call = None
            temporary.unlink(missing_ok=True)
