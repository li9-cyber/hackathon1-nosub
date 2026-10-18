"""Preserved frontend with persistent CV extraction and AI interview."""
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from career_twin.shared.core.config import WEB
from career_twin.api.http import RequestBodyLimit, install_http, install_identity_context
from career_twin.api.public_path import PublicPathMiddleware
from career_twin.shared.core.site_auth import LoginGate
from career_twin.interview.interview_api import lifespan, router as interview_router
from career_twin.interview.workspace import router as workspace_router
from career_twin.profile.routes import router as profile_router
from career_twin.jobs.routes import router as jobs_router

app = FastAPI(title='Finance Career - AI Interview', lifespan=lifespan)
app.add_middleware(RequestBodyLimit)
install_http(app)
install_identity_context(app)

@app.get('/', include_in_schema=False)
async def index():
    return FileResponse(WEB / 'career.html')

@app.get('/api/health')
@app.get('/healthz', include_in_schema=False)
async def health():
    return {'status': 'ok', 'active_features': ['ai_interview', 'cv_extraction', 'jobs'], 'release': 'jobs-20261018'}

app.include_router(workspace_router)
app.include_router(profile_router)
app.include_router(jobs_router)
app.include_router(interview_router)
app.mount('/static', StaticFiles(directory=WEB), name='static')

@app.api_route('/api/{path:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], include_in_schema=False)
@app.api_route('/internal/{path:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], include_in_schema=False)
async def archived(path: str):
    return JSONResponse(status_code=410, content={'error': {
        'code': 'feature_archived',
        'message': '此功能尚未在目前版本啟用。',
    }})

app.add_middleware(LoginGate)
app.add_middleware(PublicPathMiddleware)
