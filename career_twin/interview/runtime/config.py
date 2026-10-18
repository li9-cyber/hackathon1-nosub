import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


PROJECT = 'hackathon1-509717'


def require_cloud_window():
    """Fail closed; a checked-in file or environment variable is not authorization."""
    if os.name == 'nt' or os.environ.get('ALLOW_CLOUD_EXECUTION') != '1':
        raise RuntimeError('Execution is allowed only in the approved GCP window')
    request = Request('http://metadata.google.internal/computeMetadata/v1/project/project-id',
                      headers={'Metadata-Flavor': 'Google'})
    with urlopen(request, timeout=3) as response:
        if response.headers.get('Metadata-Flavor') != 'Google' or response.read().decode() != PROJECT:
            raise RuntimeError('GCP project identity mismatch')
    approval = json.loads(Path(os.environ.get('RUN_APPROVAL_FILE', '/state/run-approval.json')).read_text())
    # Windows DateTime emits seven fractional digits; Ubuntu host Python 3.10
    # accepts at most six, while the application container is Python 3.12.
    stamp = re.sub(r'(\.\d{6})\d+', r'\1', approval['expires_utc'])
    deadline = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    if approval['project'] != PROJECT or deadline <= datetime.now(timezone.utc):
        raise RuntimeError('Approved run expired or project mismatch')
    if not 1 <= approval['max_minutes'] <= 60:
        raise RuntimeError('Run duration exceeds the implemented 60 minute safety limit')
    return deadline


@dataclass(frozen=True)
class Settings:
    state_dir: Path = Path(os.environ.get('STATE_DIR', '/state'))
    asset_dir: Path = Path(os.environ.get('ASSET_DIR', '/assets'))
    upstream: Path = Path(os.environ.get('LIVETALKING_DIR', '/opt/LiveTalking'))
    voice: str = os.environ.get('TTS_VOICE', 'en-US-Chirp3-HD-Charon')
    language: str = os.environ.get('TTS_LANGUAGE', 'en-US')
    endpoint: str = os.environ.get('TTS_ENDPOINT', 'texttospeech.googleapis.com')
    public_ip: str = os.environ.get('MEDIA_PUBLIC_IP', '')
    origins: tuple = tuple(os.environ.get('ALLOWED_ORIGINS', 'http://localhost:8080,http://127.0.0.1:8080').split(','))
    max_chars: int = 600
    tts_total_chars: int = 10000
    session_seconds: int = 900
    task_seconds: int = 180
    batch_size: int = 4

    def token(self):
        value = (self.state_dir / 'demo-token').read_text().strip()
        if len(value) < 32:
            raise RuntimeError('Generate a random demo token on the VM first')
        return value
