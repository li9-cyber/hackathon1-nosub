"""Small durable control file in GCS, updated with generation preconditions.

No database, service-account keys, implicit initialization, or reset-on-error.
Only the CPU gateway can admit billable work; the GPU validates each admission.
"""
import copy
import hashlib
import json
import os
import time
from urllib.parse import quote

import httpx

PROJECT = 'hackathon1-509717'
METADATA = 'http://metadata.google.internal/computeMetadata/v1/'


class Rejected(RuntimeError):
    def __init__(self, code, status=409):
        super().__init__(code)
        self.code, self.status = code, status


def metadata(path):
    response = httpx.get(METADATA + path, headers={'Metadata-Flavor': 'Google'}, timeout=5)
    response.raise_for_status()
    if response.headers.get('Metadata-Flavor') != 'Google':
        raise RuntimeError('Invalid metadata response')
    return response


def assert_cloud():
    if os.name == 'nt' or not os.environ.get('K_SERVICE'):
        raise RuntimeError('Cloud Run execution only')
    if metadata('project/project-id').text != PROJECT:
        raise RuntimeError('Wrong GCP project')


def identity_token(audience):
    return metadata('instance/service-accounts/default/identity?audience=' + quote(audience, safe='') + '&format=full').text


class Store:
    def __init__(self):
        self.bucket = os.environ['CONTROL_BUCKET']
        self.object = 'control/round.json'
        self.client = httpx.Client(timeout=10)
        self.token, self.until = '', 0

    def headers(self):
        if time.monotonic() >= self.until:
            data = metadata('instance/service-accounts/default/token').json()
            self.token = data['access_token']
            self.until = time.monotonic() + max(1, data['expires_in'] - 60)
        return {'Authorization': 'Bearer ' + self.token}

    def read(self):
        url = f'https://storage.googleapis.com/storage/v1/b/{self.bucket}/o/{quote(self.object, safe="")}'
        headers = self.headers()
        meta = self.client.get(url, headers=headers)
        meta.raise_for_status()  # A missing ledger must never become an empty ledger.
        generation = meta.json()['generation']
        response = self.client.get(url, headers=headers, params={'alt': 'media', 'ifGenerationMatch': generation})
        if response.status_code == 412:
            raise Rejected('STATE_CHANGED', 503)
        response.raise_for_status()
        value = response.json()
        if value['project'] != PROJECT or value['schema'] != 1:
            raise RuntimeError('Invalid durable ledger')
        return value, generation

    def change(self, transform):
        for _ in range(5):
            try:
                state, generation = self.read()
            except Rejected:
                continue
            state = copy.deepcopy(state)
            result = transform(state)
            response = self.client.post(
                f'https://storage.googleapis.com/upload/storage/v1/b/{self.bucket}/o',
                params={'uploadType': 'media', 'name': self.object, 'ifGenerationMatch': generation},
                headers={**self.headers(), 'Content-Type': 'application/json'},
                content=json.dumps(state).encode())
            if response.status_code == 412:
                continue
            response.raise_for_status()
            return result
        raise Rejected('CONTROL_BUSY', 503)


def provider_window_open(state, now):
    if not state.get('enabled', False):
        return False
    expiry = state.get('expires_epoch')
    if expiry is None:
        return (state.get('hosting') == 'cloudrun-browser'
                and state.get('provider_window_mode') == 'budget_only')
    return now < expiry


def enabled(state, now):
    if not provider_window_open(state, now):
        raise Rejected('DEMO_WINDOW_CLOSED', 403)


def session(state, sid, now):
    current = state.get('session')
    if not current or current['id'] != sid or current['expires'] <= now:
        raise Rejected('SESSION_EXPIRED', 410)
    return current


def reserve_provider(state, charge):
    if state.get('hosting') == 'hongkong-single-vm':
        # The whole VM window was reserved once, including this API sub-budget.
        run = state['vm_runs'][state['vm_run_id']]
        if run['provider_reserved_microusd'] + charge > run['provider_limit_microusd']:
            raise Rejected('GPU_ALLOWANCE_EXHAUSTED', 429)
        run['provider_reserved_microusd'] += charge
    else:
        if state['gpu_reserved_microusd'] + charge > state['gpu_limit_microusd']:
            raise Rejected('GPU_ALLOWANCE_EXHAUSTED', 429)
        state['gpu_reserved_microusd'] += charge


def admit(state, sid, request_id, text, now, chat_request_id=None):
    enabled(state, now)
    current = session(state, sid, now)
    if state.get('chat_active') and state['chat_active']['until'] > now:
        raise Rejected('BUSY')
    chat = None
    if chat_request_id:
        chat = state.get('chat_requests', {}).get(chat_request_id)
        if (not chat or chat['session'] != sid or chat['cancelled'] or chat['consumed']
                or chat['until'] <= now or chat['generation'] != current['generation']
                or chat.get('reply_sha256') != hashlib.sha256(text.encode()).hexdigest()):
            raise Rejected('CHAT_CANCELLED')
    if request_id in state['requests']:
        raise Rejected('DUPLICATE_REQUEST')
    if state.get('active') and state['active']['until'] > now:
        raise Rejected('BUSY')
    # Conversational turns are serialized instead of a restrictive 3/min quota.
    # The persistent financial/TTS ceilings remain in force.
    if state['reserved_chars'] + len(text) > 10000:
        raise Rejected('TTS_BUDGET_EXHAUSTED', 429)
    # Reserve the union of bounded request windows plus a 10-minute idle tail.
    # 600 microUSD/sec is above the reviewed 8 CPU/32Gi/L4 rate (473.64).
    # Overlapping requests extend the allowance instead of paying a new cold-start
    # allowance every sentence. Failed/cancelled reservations are not refunded.
    until = now + 1080  # up to 480s cold-start/proxy window, then 600s idle
    previous_until = state.get('reserved_until_epoch', 0)
    seconds = max(0, until - max(now, previous_until))
    charge = len(text) * 30  # Chirp HD $30/1M chars
    if state.get('hosting') != 'hongkong-single-vm':
        charge += int(seconds * 600 + 0.999)
    reserve_provider(state, charge)
    state['reserved_chars'] += len(text)
    if chat:
        chat['consumed'] = True
    state['reserved_until_epoch'] = max(previous_until, until)
    request = {'id': request_id, 'session': sid, 'generation': current['generation'],
               'text_sha256': hashlib.sha256(text.encode()).hexdigest(), 'chars': len(text),
               'created': now, 'until': now + 480, 'claimed': False, 'cancelled': False}
    state['requests'][request_id] = request
    state['active'] = {'id': request_id, 'until': now + 480}
    current['expires'] = now + 900
    return request
