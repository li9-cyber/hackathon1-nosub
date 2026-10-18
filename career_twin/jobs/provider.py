"""Exactly one Techmap search; no redirect, retry, detail request or pagination."""
import asyncio
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urlsplit
import httpx
from career_twin.shared.core.config import get_techmap_settings
from career_twin.shared.core.errors import AppError
from career_twin.shared.matching.service import digest

HOST = 'daily-international-job-postings.p.rapidapi.com'

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'): self.skip+=1
        if tag in ('p','br','li','div','h1','h2','h3'): self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style'): self.skip=max(0,self.skip-1)
        if tag in ('p','li','div'): self.parts.append('\n')
    def handle_data(self,data):
        if not self.skip:self.parts.append(data)

def plain(value):
    parser=PlainText(); parser.feed(value or '')
    return '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())

def text(value):
    if isinstance(value,list):return ', '.join(filter(None,map(text,value)))
    if isinstance(value,dict):return text(value.get('name') or value.get('value'))
    return str(value).strip() if value is not None else ''

def safe_url(value):
    try:
        p=urlsplit(value or '')
        return value if p.scheme in ('http','https') and p.hostname and not p.username else None
    except ValueError:return None

def map_job(row):
    node=row.get('jsonLD') or {}
    if isinstance(node,list):node=next((v for v in node if isinstance(v,dict)),{})
    if not isinstance(node,dict):node={}
    url=safe_url(node.get('url')) or safe_url(row.get('url')) or safe_url(node.get('sameAs'))
    jd=plain(text(node.get('description') or row.get('description')))
    for field in ('educationRequirements','experienceRequirements'):
        extra=plain(text(node.get(field)))
        if extra and extra not in jd:jd+='\n'+extra
    identity=text(node.get('identifier')) or text(row.get('id')) or url or digest(row)
    location=', '.join(dict.fromkeys(filter(None,[text(row.get('city')),text(row.get('state')),text(row.get('countryCode'))])))
    if not location:
        loc=node.get('jobLocation') or {}
        if isinstance(loc,list):loc=loc[0] if loc else {}
        address=loc.get('address',{}) if isinstance(loc,dict) else {}
        location=', '.join(filter(None,[text(address.get(k)) for k in ('addressLocality','addressRegion','addressCountry')])) if isinstance(address,dict) else text(address)
    salary=node.get('baseSalary') or {}
    value=salary.get('value',{}) if isinstance(salary,dict) else {}
    salary_display=text(salary) if not isinstance(value,dict) else ' '.join(filter(None,[text(salary.get('currency')),text(value.get('minValue') or value.get('value')),('– '+text(value['maxValue'])) if value.get('maxValue') else '',text(value.get('unitText'))]))
    return dict(id='job_'+digest(identity)[:24],version=digest([jd,node,row]),source='techmap',
        title=text(row.get('title') or node.get('title')) or '未提供',company=text(row.get('company') or node.get('hiringOrganization')),
        location=location,url=url,jd=jd,raw_jd=node.get('description'),provider_metadata=row,
        salary_display=salary_display,employment_type=text(node.get('employmentType') or row.get('workType') or row.get('contractType')),
        deadline=text(node.get('validThrough')),published_at=text(node.get('datePosted')),
        normalized=False,requirements=[],analysis_status='pending' if jd else 'failed',
        details_notice='' if jd else '來源未提供 JD 正文，請貼上職位內容。',full_description=bool(jd),
        description_completeness='api_description' if jd else 'missing')

def parameters(body):
    today=datetime.now(timezone(timedelta(hours=8))).date()
    result=dict(countryCode='hk',page=1,sort='newest',dateCreatedMin=(today-timedelta(days=30)).isoformat(),dateCreatedMax=today.isoformat())
    for key,field in [('keywords','title'),('city','city'),('work_type','workType'),('contract_type','contractType'),('work_place','workPlace')]:
        if body.get(key):result[field]=str(body[key])[:160]
    if body.get('minimum_salary',0)>0:result['minSalary']=body['minimum_salary']
    return result

async def search(body):
    settings=get_techmap_settings()
    if not settings.api_key:raise AppError('techmap_key_missing','未設定 Techmap Key。',503)
    if settings.base_url!='https://'+HOST or settings.host!=HOST:raise AppError('techmap_config','Techmap 位址設定不正確。',503)
    params=parameters(body)
    try:
        async with asyncio.timeout(30),httpx.AsyncClient(timeout=29,follow_redirects=False) as client:
            response=await client.get(settings.base_url+'/api/v2/jobs/search',params=params,headers={'X-RapidAPI-Key':settings.api_key,'X-RapidAPI-Host':HOST})
        if response.status_code!=200:raise AppError('techmap_error',f'Techmap 回應 HTTP {response.status_code}；沒有自動重試。',502)
        payload=response.json()
        if not isinstance(payload,dict) or not isinstance(payload.get('result'),list):raise ValueError()
        jobs={}
        for row in payload['result'][:10]:
            if not isinstance(row,dict):continue
            job=map_job(row);jobs[job['id']]=job
        return dict(jobs=list(jobs.values()),total_count=payload.get('totalCount'),parameters=params)
    except (TimeoutError,httpx.TimeoutException):raise AppError('techmap_timeout','Techmap 搜尋超時；沒有自動重試。',504) from None
    except (httpx.HTTPError,ValueError):raise AppError('techmap_error','Techmap 連線或回應失敗；沒有自動重試。',502) from None
