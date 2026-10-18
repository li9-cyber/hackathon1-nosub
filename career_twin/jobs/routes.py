"""Thin job router, using existing project authentication and storage."""
from fastapi import APIRouter
from . import service

router=APIRouter(prefix='/api/career')

@router.get('/jobs')
async def snapshot():return service.snapshot()

@router.post('/search')
async def search(body:dict):return await service.search(body)

@router.post('/job/extract')
async def extract(body:dict):return await service.extract(body.get('job_id'),bool(body.get('retry')),bool(body.get('refresh')))

@router.post('/job/deep')
async def deep(body:dict):return await service.deep(body.get('job_id'))

@router.post('/job/match')
async def match(body:dict):return service.snapshot()

@router.post('/job/bookmark')
def bookmark(body:dict):return service.bookmark(body.get('job_id'),body.get('bookmarked'))

@router.post('/job')
async def manual(body:dict):return await service.manual(body)

@router.post('/job/overview')
async def overview(body:dict):
    state=service.snapshot()
    return dict(profile_summary='沿用已保存的個人資料與技能證據。',direction_summary='搜尋職位後按要求逐項比對。',strengths=[],directions=[],evidence=state.get('skill_evidence',[]))

@router.post('/tailor')
async def tailor(body:dict):
    from .applications import tailor
    return await tailor(body)

@router.post('/draft')
async def draft(body:dict):
    from .applications import edit
    return edit(body)

@router.post('/export')
async def export(body:dict):
    from .applications import export
    return export(body)
