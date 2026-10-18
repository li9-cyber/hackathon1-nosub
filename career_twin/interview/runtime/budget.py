"""A file ledger, not a database. Reservations are never refunded after cancellation."""
import json
import os
import time
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def exclusive_file(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as handle:
        if os.name == 'nt':
            import msvcrt
            if handle.seek(0, 2) == 0:
                handle.write(b'\0')
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def atomic_json(path: Path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as handle:
        json.dump(value, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


class BudgetExceeded(RuntimeError):
    pass


class TTSLedger:
    def __init__(self, root: Path, limit=10000):
        self.path = root / 'tts-ledger.json'
        self.limit = limit

    def reserve(self, chars, request_id):
        with exclusive_file(self.path.with_suffix('.lock')):
            # Bootstrap explicitly creates the ledger. Missing/corrupt files never reset usage.
            state = json.loads(self.path.read_text())
            if not isinstance(state['reserved_chars'], int) or state['reserved_chars'] < 0:
                raise RuntimeError('Invalid TTS ledger')
            if chars <= 0 or state['reserved_chars'] + chars > self.limit:
                raise BudgetExceeded('The round TTS character limit has been reached')
            state['reserved_chars'] += chars
            state['requests'].append({'request_id': request_id, 'chars': chars, 'submitted_at': time.time()})
            atomic_json(self.path, state)

    def used(self):
        return json.loads(self.path.read_text())['reserved_chars']
