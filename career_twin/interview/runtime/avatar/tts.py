"""Provider-independent PCM interface. Google remains the only TTS provider."""
import io
import threading
import time
import wave
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class AudioChunk:
    pcm: bytes
    sequence: int
    sample_rate: int = 16000
    channels: int = 1


@dataclass
class AudioStream:
    request_id: str
    chunks: Iterable[AudioChunk]
    sample_rate: int = 16000
    channels: int = 1

    def __iter__(self):
        return iter(self.chunks)

    def wav(self):
        """Initial HTTP transport buffers a sentence; the interface need not."""
        output = io.BytesIO()
        with wave.open(output, 'wb') as handle:
            handle.setnchannels(self.channels)
            handle.setsampwidth(2)
            handle.setframerate(self.sample_rate)
            total = 0
            for chunk in self:
                if (chunk.sample_rate != self.sample_rate or chunk.channels != self.channels
                        or len(chunk.pcm) % (2 * self.channels)):
                    raise ValueError('INVALID_PCM_CHUNK')
                total += len(chunk.pcm)
                if total > self.sample_rate * self.channels * 2 * 120:
                    raise ValueError('AUDIO_TOO_LONG')
                handle.writeframesraw(chunk.pcm)
            if not total:
                raise ValueError('EMPTY_AUDIO')
        return output.getvalue()


class GoogleAudioService:
    def __init__(self, settings, enabled=False, ledger=None):
        self.settings = settings
        self.enabled = enabled
        self.provider = None
        self.lock = threading.Lock()
        self.ledger = ledger

    def _prepare(self):
        if self.provider is None:
            from career_twin.interview.runtime.adapters.tts import GoogleTTS
            self.provider = GoogleTTS(self.settings)
            if self.ledger is not None:
                self.provider.ledger = self.ledger
        if not self.provider.validated:
            self.provider.validate_voice()

    def prepare(self):
        """Initialize credentials/voice metadata without synthesizing paid audio."""
        if not self.enabled:
            raise RuntimeError('GOOGLE_TTS_DISABLED')
        with self.lock:
            self._prepare()

    def synthesize(self, text, request_id, cancelled):
        if not self.enabled:
            raise RuntimeError('GOOGLE_TTS_DISABLED: configure LOCAL_GOOGLE_TTS=true and ADC to use Google TTS')
        with self.lock:
            if cancelled.is_set():
                raise RuntimeError('CANCELLED')
            self._prepare()
            started = time.perf_counter()
            chunks = []

            def consume(pcm):
                if cancelled.is_set():
                    raise RuntimeError('CANCELLED')
                chunks.append(AudioChunk(pcm, len(chunks)))

            metrics = self.provider.stream(text, request_id, cancelled, consume)
            return AudioStream(request_id, chunks), {
                **metrics, 'tts_ms': round((time.perf_counter() - started) * 1000, 1),
                'provider': 'google', 'voice': self.settings.voice,
                'streaming_transport': False,
            }

    def cancel(self):
        if self.provider:
            self.provider.cancel()
