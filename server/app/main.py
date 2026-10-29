import logging
import os
import uuid
import base64
import json

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from . import accounts, discovery, migrate, outbox, security, worker
from .core import admin, auth, flags, health, me, objects, search
from .db import Database
from .errors import ApiError, error_body
from .settings import Settings
from .storage import LocalStorage

log = logging.getLogger('commons')
CORE_ROUTERS = (auth.router, me.router, objects.router, search.router, flags.router, health.router, admin.router)
HTTP_CODES = {400: 'malformed_request', 401: 'unauthenticated', 403: 'action_not_allowed', 404: 'resource_not_found',
              405: 'method_not_allowed', 413: 'payload_too_large', 415: 'unsupported_media_type'}


def preserve_route_cache(path, headers):
    value = headers.get('cache-control', '')
    if not value:
        return False
    if path.startswith('/api/public/'):
        return True
    directives = [part.strip().lower() for part in value.split(',')]
    return path.startswith('/api/media/f/') and any(
        part == 'private' or part.startswith('private=') for part in directives)


async def adapt_binary_media_chunk(request):
    """Feed the existing JSON chunk handler without widening any other route's media types."""
    ctype = request.headers.get('content-type', '').split(';')[0].strip().lower()
    if ctype != 'application/octet-stream' or not security.binary_media_chunk(request):
        return
    raw = await request.body()
    encoded = json.dumps({'data': base64.b64encode(raw).decode('ascii')}, separators=(',', ':')).encode()
    request._body = encoded
    request.scope['headers'] = [
        (key, value) for key, value in request.scope['headers']
        if key not in (b'content-type', b'content-length')
    ] + [(b'content-type', b'application/json'), (b'content-length', str(len(encoded)).encode())]
    if hasattr(request, '_headers'):
        del request._headers


def error_response(request, err):
    rid = getattr(request.state, 'request_id', None)
    return JSONResponse(error_body(err.code, err.message, rid, **err.extra), err.status, headers=err.headers)


def check_module_routes(module):
    prefix = f'/api/{module.name}'
    for route in module.router.routes:
        path = getattr(route, 'path', '')
        if path != prefix and not path.startswith(prefix + '/'):
            raise ValueError(f'module {module.name} route {path} must live under {prefix}/')
    if module.admin_router is not None:
        admin_prefix = f'/api/admin/{module.name}'
        for route in module.admin_router.routes:
            path = getattr(route, 'path', '')
            if path != admin_prefix and not path.startswith(admin_prefix + '/'):
                raise ValueError(f'module {module.name} admin route {path} must live under {admin_prefix}/')


def create_app(settings=None):
    settings = settings or Settings.from_env(os.environ)
    db = Database(settings.db_path)
    modules = discovery.discover(settings.module_package)
    outbox.bind_modules(db, settings.module_package, modules)
    accounts.bind_modules(db, settings.module_package, modules)
    worker.bind_modules(db, settings.module_package, modules)
    if settings.auto_migrate:
        migrate.migrate(db, modules, settings.backup_dir)
    app = FastAPI(title='Commons API', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.db = db
    app.state.modules = modules
    app.state.storage = LocalStorage(settings.storage_dir, settings.content_origin) if settings.storage_dir else None
    security_headers = security.response_headers(settings)
    db.outbox_app_context = outbox.AppContext(db, settings, app.state.storage)

    @app.middleware('http')
    async def guard(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        try:
            security.check_request(request, settings)
            await adapt_binary_media_chunk(request)
            response = await call_next(request)
        except ApiError as err:
            response = error_response(request, err)
        except Exception:
            log.exception('unhandled error request_id=%s', request.state.request_id)
            response = error_response(request, ApiError('internal_error'))
        if request.url.path.startswith('/api/') and not preserve_route_cache(request.url.path, response.headers):
            response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Request-ID'] = request.state.request_id
        for name, value in security_headers.items():
            response.headers.setdefault(name, value)
        return response

    @app.exception_handler(ApiError)
    async def api_error(request, err):
        return error_response(request, err)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        errors = exc.errors()
        types = {e.get('type') for e in errors}
        if 'json_invalid' in types:
            err = ApiError('malformed_request')
        elif 'extra_forbidden' in types:
            err = ApiError('unknown_field')
        else:
            err = ApiError('validation_failed')
        err.extra = {'fields': [{'loc': [str(p) for p in e.get('loc', ())], 'type': e.get('type')} for e in errors]}
        return error_response(request, err)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        code = HTTP_CODES.get(exc.status_code, 'internal_error')
        return error_response(request, ApiError(code))

    for router in CORE_ROUTERS:
        app.include_router(router)
    for module in modules:
        if module.router is not None:
            check_module_routes(module)
            app.include_router(module.router)
            if module.admin_router is not None:
                app.include_router(module.admin_router)
    if settings.static_dir:
        app.mount('/', StaticFiles(directory=settings.static_dir, html=True), name='static')
    return app
