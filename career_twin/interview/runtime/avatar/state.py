"""One local session; monotonic commands protect against reordered HTTP requests."""
import secrets
import threading
import time
from dataclasses import dataclass, field

from fastapi import HTTPException


@dataclass
class AvatarSession:
    id: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    sequence: int = 0
    request_id: str | None = None
    state: str = 'IDLE'
    expires: float = field(default_factory=lambda: time.monotonic() + 900)
    cancel: threading.Event = field(default_factory=threading.Event)
    seen: set = field(default_factory=set)

    def advance(self, sequence, request_id=None):
        next_sequence = self.sequence + 1 if sequence is None else sequence
        if next_sequence <= self.sequence:
            raise HTTPException(409, 'STALE_GENERATION')
        if request_id and request_id in self.seen:
            raise HTTPException(409, 'DUPLICATE_REQUEST')
        if len(self.seen) >= 1000:
            raise HTTPException(429, 'SESSION_REQUEST_LIMIT')
        self.cancel.set()
        self.cancel = threading.Event()
        self.sequence = next_sequence
        self.request_id = request_id
        if request_id:
            self.seen.add(request_id)
        self.expires = time.monotonic() + 900
        return self.cancel

    def current(self, sequence):
        return self.sequence == sequence and not self.cancel.is_set()

    def snapshot(self):
        return {'session_id': self.id, 'generation': self.sequence,
                'request_id': self.request_id, 'state': self.state}
