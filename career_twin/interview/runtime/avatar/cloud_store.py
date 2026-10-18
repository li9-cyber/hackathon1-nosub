"""Durable CPU-chat reservations, isolated from the historical GPU ledger."""
import os
import time

from career_twin.interview.runtime.cloudrun.store import Store, Rejected, enabled, reserve_provider


class CloudChatStore(Store):
    def __init__(self):
        super().__init__()
        self.object = os.environ['CHAT_CONTROL_OBJECT']
        if not self.object.startswith('browser-chat/') or '..' in self.object:
            raise RuntimeError('Invalid browser chat ledger path')
        state, _ = self.read()
        if state.get('hosting') != 'cloudrun-browser':
            raise RuntimeError('Wrong chat ledger; never import or reset implicitly')

    def reserve(self, chars, request_id):
        def charge(state):
            enabled(state, time.time())
            if request_id in state['requests']:
                raise Rejected('DUPLICATE_REQUEST')
            reserve_provider(state, chars * 30)
            state['reserved_chars'] += chars
            state['requests'][request_id] = {'chars': chars, 'created': time.time()}
        self.change(charge)

    def close(self):
        self.client.close()
