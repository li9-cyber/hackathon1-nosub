"""Bounded requests: resumable CV work survives disconnect; explicit cancel stops it."""
import asyncio
from contextvars import ContextVar

progress_callback = ContextVar('career_progress', default=None)
STAGES = {'memory_lookup':8, 'cv_structure':120, 'normalize_profile':180, 'normalize_job':90,
          'clarify_question':45, 'clarify_answer':60, 'source_validation':None,
          'saving_profile':None, 'jd_evidence_matching_v11':90, 'jd_role_classification_v11':45}

async def report_stage(stage):
    callback=progress_callback.get()
    if callback and stage in STAGES:
        from career_twin.shared.core.errors import AppError
        try:await callback(stage,STAGES[stage])
        except AppError:pass  # Telemetry failure must not discard an answer.

# A fast path only. Durable cancellation state handles requests on other workers.
active = {}


def signal(owner, request_id):
    event = active.get((owner, request_id))
    if event:
        event.set()


async def run(app, scope, receive, send, owner, request_id, cancelled, progress=None, *, continue_on_disconnect=False):
    messages = asyncio.Queue(maxsize=1)
    disconnected = asyncio.Event()
    stop = asyncio.Event()
    body_complete = asyncio.Event()
    key = (owner, request_id)
    active[key] = stop

    async def pump():
        # Exactly one reader owns ASGI receive; body chunks are forwarded intact.
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                disconnected.set()
                return
            if message['type'] == 'http.request' and not message.get('more_body', False):
                body_complete.set()
            await messages.put(message)

    async def replay():
        if disconnected.is_set() and messages.empty():
            return {'type': 'http.disconnect'}
        return await messages.get()

    async def watch_cancel():
        while True:
            if await cancelled():
                return
            try:
                await asyncio.wait_for(stop.wait(), timeout=1)
                return
            except TimeoutError:
                pass

    async def disconnected_before_body():
        await disconnected.wait()
        if continue_on_disconnect and body_complete.is_set():
            # Keep the original bounded ASGI request running, never an untracked
            # detached task. Its result commits through the usual project CAS.
            await asyncio.Future()

    async def safe_send(message):
        if disconnected.is_set() and continue_on_disconnect:
            # Preserve response status bookkeeping even when the socket is gone.
            # ASGI servers accept sends after disconnect as a no-op in normal use.
            try:await send(message)
            except OSError:pass
        else:
            await send(message)

    reader = asyncio.create_task(pump())
    token=progress_callback.set(progress)
    try:worker = asyncio.create_task(app(scope, replay, safe_send))
    finally:progress_callback.reset(token)
    control = asyncio.create_task(watch_cancel())
    gone = asyncio.create_task(disconnected_before_body())
    tasks = (reader, worker, control, gone)
    try:
        # A normal reader exit on disconnect does not terminate resumable work.
        watched = {worker, control, gone, reader}
        while True:
            done, _ = await asyncio.wait(watched, return_when=asyncio.FIRST_COMPLETED)
            if reader in done and not reader.cancelled() and reader.exception() is None and continue_on_disconnect and body_complete.is_set():
                watched.discard(reader)
                if not done.intersection({worker, control, gone}):continue
            break
        if worker in done:
            await worker
            return 'completed'
        for task in (reader, control):
            if task in done:
                await task  # Preserve unexpected receiver/storage failures.
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)
        return 'disconnected' if disconnected.is_set() else 'cancelled'
    finally:
        if active.get(key) is stop:
            active.pop(key, None)
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
