"""Optional URL namespace for a shared-domain proxy; internal API paths stay stable."""
import os
import re
from urllib.parse import urlsplit, urlunsplit
from starlette.responses import PlainTextResponse, RedirectResponse


class PublicPathMiddleware:
    def __init__(self, app, prefix=None):
        self.app = app
        self.prefix = (os.getenv('CAREER_PUBLIC_PATH', '') if prefix is None else prefix).rstrip('/')
        if self.prefix and not re.fullmatch(r'(?:/[A-Za-z0-9_-]+)+', self.prefix):
            raise ValueError('CAREER_PUBLIC_PATH must be a simple absolute URL path')

    def external(self, value):
        if not value.startswith('/') or value.startswith('//'):
            return value
        if value == self.prefix or value.startswith(self.prefix + '/'):
            return value
        return self.prefix + value

    async def __call__(self, scope, receive, send):
        if not self.prefix or scope['type'] not in ('http', 'websocket'):
            return await self.app(scope, receive, send)
        path = scope['path']
        if scope['type'] == 'http' and path == self.prefix:
            query = scope.get('query_string', b'').decode('latin-1')
            return await RedirectResponse(self.prefix + '/' + ('?' + query if query else ''), status_code=307)(scope, receive, send)
        if not path.startswith(self.prefix + '/'):
            if path == '/healthz' and scope['type'] == 'http':
                return await self.app(scope, receive, send)
            if scope['type'] == 'websocket':
                return await send({'type': 'websocket.close', 'code': 1008})
            return await PlainTextResponse('Not found', status_code=404)(scope, receive, send)
        # Keep the internal router namespace unchanged. Adding this prefix to
        # root_path as well would make nested StaticFiles mounts strip it twice.
        inner = dict(scope, path=path[len(self.prefix):])
        inner['raw_path'] = inner['path'].encode('utf-8')
        # HTML must pass through the body transformer, including FileResponse.
        inner['extensions'] = {k: v for k, v in scope.get('extensions', {}).items()
                               if k != 'http.response.pathsend'}
        start, chunks = None, []

        async def response(message):
            nonlocal start
            if message['type'] == 'http.response.start':
                headers = []
                for name, value in message['headers']:
                    if name.lower() == b'location':
                        location = value.decode('latin-1')
                        parsed = urlsplit(location)
                        host = dict(scope.get('headers', [])).get(b'host', b'').decode('latin-1')
                        if parsed.netloc and parsed.netloc == host:
                            # Starlette's trailing-slash redirects are absolute.
                            # Return a relative URL so the proxy host is retained.
                            location = urlunsplit(('', '', self.external(parsed.path), parsed.query, parsed.fragment))
                        else:
                            location = self.external(location)
                        value = location.encode('latin-1')
                    elif name.lower() == b'set-cookie':
                        value = re.sub(rb'(?i)(;\s*path=)(/[^;]*)',
                            lambda m: m[1] + self.external(m[2].decode('latin-1')).encode('latin-1'), value)
                    headers.append((name, value))
                message = {**message, 'headers': headers}
                content_type = dict(headers).get(b'content-type', b'')
                if message['status'] == 200 and content_type.startswith(b'text/html') and scope.get('method') != 'HEAD':
                    start = message
                    return
            elif message['type'] == 'http.response.body' and start:
                chunks.append(message.get('body', b''))
                if message.get('more_body', False):
                    return
                html = b''.join(chunks).decode('utf-8')
                html = re.sub(r'''\b(src|href|action)=(['"])(/(?!/)[^'"]*)\2''',
                    lambda m: m[1] + '=' + m[2] + self.external(m[3]) + m[2], html)
                body = html.encode('utf-8')
                headers = [(k, v) for k, v in start['headers'] if k.lower() not in (b'content-length', b'etag')]
                await send({**start, 'headers': headers + [(b'content-length', str(len(body)).encode())]})
                await send({'type': 'http.response.body', 'body': body})
                return
            await send(message)

        await self.app(inner, receive, response)
