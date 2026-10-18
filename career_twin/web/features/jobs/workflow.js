/* Saved jobs are the only data source. Three independent extraction requests;
   no Techmap retries/paging and deep analysis only in its button handler. */
"use strict";
(() => {
const $=id=>document.getElementById(id),labels={high:'高度符合',medium:'中度符合',low:'不符合'};
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls='button-secondary')=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
let searching=false,queueScope=null,queueRunning=false,dialog=null,poll=null;
const running=new Set();
const attempted=new Set();
const bookmarking=new Set();
const applying=new Set();
function current(){return CareerWorkspace.getState();}
function accept(state,scope){if(scope===CareerProjects.id()&&(!current()||state.revision>=current().revision))CareerWorkspace.restore(state);}
async function request(path,body,limit=65000){const scope=CareerProjects.id();const result=await CareerAPI.request('/api/career'+path,{body,projectId:scope,signal:AbortSignal.timeout(limit)});accept(result,scope);return result;}
function query(){return {keywords:$('search-title').value.trim()||current()?.preferences?.target_role,city:$('search-location').value==='Hong Kong'?'':$('search-location').value,minimum_salary:Number($('search-salary').value)||0,work_type:$('search-work-type').value,contract_type:$('search-contract-type').value,work_place:$('search-work-place').value};}
async function search(input){
 if(searching)return;
 if(!current()){$('search-notice').textContent='請先保存 CV／個人資料，再搜尋職位。';return;}
 searching=true;$('search-jobs').disabled=true;
 try{await request('/search',{...query(),...input,request_id:crypto.randomUUID()},35000);await prepare();}
 catch(e){$('search-notice').textContent=e.name==='TimeoutError'?'系統需要更長時間處理，正在讀取已保存結果。':e.message;await recover();}
 finally{searching=false;$('search-jobs').disabled=false;}
}
async function prepare({allSaved=false}={}){
 const scope=CareerProjects.id();if(queueRunning&&queueScope===scope)return;
 queueRunning=true;queueScope=scope;
 clearTimeout(poll);poll=setTimeout(recover,700);
 $('analyze-saved-jobs').disabled=true;
 const ids=(current()?.jobs||[]).filter(j=>!j.normalized&&j.jd&&j.extraction?.status!=='running'&&(allSaved||(j.analysis_status==='pending'&&!attempted.has(scope+':'+j.id+':'+j.version)))).map(j=>{attempted.add(scope+':'+j.id+':'+j.version);return j.id;});
 async function worker(){while(ids.length&&scope===CareerProjects.id()){const id=ids.shift();try{await request('/job/extract',{job_id:id,retry:allSaved});}catch(e){if(scope===CareerProjects.id())$('search-notice').textContent=e.message;}}}
 try{await Promise.all([worker(),worker(),worker()]);}finally{if(queueScope===scope){queueRunning=false;$('analyze-saved-jobs').disabled=false;}}
}
async function recover(){try{await request('/jobs',undefined,10000);}catch{/* Existing saved cards remain visible. */}}
function track(state){
 clearTimeout(poll);
 const active=state?.job_search?.status==='running'||state?.jobs?.some(j=>j.extraction?.status==='running'||j.deep_attempt?.status==='running');
 if(active)poll=setTimeout(recover,1800);
}
function message(job){const a=job.extraction;if(a?.status==='running')return Date.now()/1000-a.started_at>20?'系統需要更長時間處理，完成後會自動顯示。':'正在抽取 JD 要求…';return job.details_notice||'等待抽取要求';}
function render(context){
 const state=context.state;track(state);
 const search=state.job_search||{},ids=new Set(search.result_ids||[]);
 const jobs=state.jobs.filter(j=>j.source!=='techmap'||ids.has(j.id));
 const met=$('job-match-filter').value==='met';
 const visible=jobs.filter(j=>!met||state.matches.find(m=>m.job_id===j.id)?.band==='high');
 $('job-results').replaceChildren(...visible.map(j=>card(j,context)));
 renderBookmarks(context);
 if(!visible.length)$('job-results').append(node('p','尚未取得職位。設定條件後按搜尋，或貼上完整 JD。','empty-state'));
 $('search-notice').textContent=search.message||'只有按下搜尋才會發出一次 Techmap 請求，最多 10 個職位。';
 $('search-metadata').textContent=search.fetched_at?`已保存 ${search.result_ids.length} 個職位${search.elapsed_seconds!=null?' · '+search.elapsed_seconds+' 秒':''} · ${search.fetched_at}`:'';
 const searched=state.jobs.filter(j=>ids.has(j.id)),scopeJobs=searched.length?searched:jobs;
 const complete=scopeJobs.filter(j=>j.normalized&&state.matches.some(m=>m.job_id===j.id&&m.status==='complete')).length;
 $('saved-analysis-summary').textContent=scopeJobs.length?`已完成分析 ${complete} / ${scopeJobs.length} 份（${Math.round(complete/scopeJobs.length*100)}%） · 分析完成不代表 CV 符合要求。`:'';
 const unfinished=state.jobs.filter(j=>!j.normalized&&j.jd&&j.extraction?.status!=='running');
 $('analyze-saved-jobs').hidden=!unfinished.length;
 $('analyze-saved-jobs').disabled=queueRunning||searching;
 $('analyze-saved-jobs').textContent=`分析未完成職位（${unfinished.length}）`;
 $('search-preferences').textContent='搜尋條件只在按搜尋時送出；已保存卡片不會重複取得 JD。';
 $('retry-search').hidden=!['failed','timeout'].includes(search.status);
 $('search-jobs').disabled=searching||search.status==='running';
 $('job-filter-notice').textContent=met?'只顯示高度符合的已保存結果。':'';
 if(state.jobs.some(j=>j.analysis_status==='pending'))queueMicrotask(prepare);
}
function renderBookmarks(context){
 const saved=(context.state.jobs||[]).filter(j=>j.bookmarked);
 $('bookmarked-job-results').replaceChildren(...saved.map(j=>card(j,context)));
 if(!saved.length)$('bookmarked-job-results').append(node('p','尚未加入職位。在探索職位點亮卡片左上角的書籤，即可保留在這裡。','empty-state'));
}
function bookmarkButton(job){
 const scope=CareerProjects.id(),key=scope+':'+job.id;
 const toggle=button('',async()=>{
  if(bookmarking.has(key))return;
  bookmarking.add(key);toggle.disabled=true;
  try{await request('/job/bookmark',{job_id:job.id,bookmarked:!job.bookmarked});if(scope===CareerProjects.id())$('saved-jobs-notice').textContent='';}
  catch(e){if(scope===CareerProjects.id()){const message='書籤未能保存：'+e.message;$('saved-jobs-notice').textContent=message;$('search-notice').textContent=message;}}
  finally{bookmarking.delete(key);if(scope===CareerProjects.id()){for(const b of document.querySelectorAll('.job-bookmark'))if(b.dataset.bookmarkJobId===job.id)b.disabled=false;}}
 },'job-bookmark');
 const label=job.bookmarked?'取消書籤':'加入已分析職位';toggle.title=label;toggle.setAttribute('aria-label',label);toggle.setAttribute('aria-pressed',String(!!job.bookmarked));toggle.dataset.bookmarkJobId=job.id;toggle.disabled=bookmarking.has(key);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M6 3h12v18l-6-4-6 4z');svg.append(path);toggle.append(svg);return toggle;
}
async function applyFor(job,context,control){
 const scope=CareerProjects.id(),key=scope+':'+job.id;
 if(applying.has(key))return;
 applying.add(key);control.disabled=true;control.textContent='正在保存…';
 try{
  const state=await request('/job/bookmark',{job_id:job.id,bookmarked:true});
  if(scope!==CareerProjects.id())return;
  close();context.selectTailoring?.(state.jobs.find(j=>j.id===job.id));
  await CareerProjects.flush();
 }catch(e){if(scope===CareerProjects.id()){const message='未能準備申請：'+e.message;$('saved-jobs-notice').textContent=message;$('search-notice').textContent=message;}}
 finally{applying.delete(key);if(scope===CareerProjects.id()){for(const b of document.querySelectorAll('.job-apply'))if(b.dataset.applyJobId===job.id){b.disabled=false;b.textContent='申請';}}}
}
function applyButton(job,context){const b=button('申請',()=>applyFor(job,context,b),'button-primary job-apply');b.dataset.applyJobId=job.id;b.disabled=applying.has(CareerProjects.id()+':'+job.id);return b;}
function sourceView(job,units){const pre=node('pre',undefined,'saved-jd-source');const spans=units.flatMap(u=>(u.source_spans||[]).map(s=>({...s,status:u.status}))).sort((a,b)=>a.start-b.start);const chars=Array.from(job.jd||'');let cursor=0;
 for(const s of spans){if(s.start<cursor||chars.slice(s.start,s.end).join('')!==s.quote)continue;pre.append(document.createTextNode(chars.slice(cursor,s.start).join('')));pre.append(node('mark',s.quote,'match-'+s.status));cursor=s.end;}
 pre.append(document.createTextNode(chars.slice(cursor).join('')));return pre;
}
function open(job,context,unit=null,deep=false){
 close();dialog=node('dialog',undefined,'job-detail-drawer saved-job-dialog');const d=dialog;
 const header=node('header',undefined,'job-detail-header');header.append(node('h2',job.title),button('關閉',()=>d.close()));d.append(header);
 const match=context.state.matches.find(m=>m.job_id===job.id),units=match?.units||[];
 if(unit){d.append(node('h3',unit.name),node('p',unit.reason));for(const p of unit.citations||[]){d.append(node('h4',p.origin==='supplement'?'補充資訊證據':'CV 原文證據'));const box=node('pre',undefined,'saved-jd-source');for(const part of CareerEvidence.segments(p.text,p.source_spans)){box.append(node(part.highlight?'mark':'span',part.text));}d.append(box);}if(!unit.citations?.length)d.append(node('p','目前未找到匹配證據，不代表你不具備這項能力；補充經歷後可重新計算。'));}
 if(deep){d.append(node('p',`匹配程度：${labels[match?.band]||'尚未完成分析'}`));const saved=job.deep_analysis;if(saved){for(const [key,title] of [['strengths','具體優勢'],['gaps','待補充證據'],['suggestions','改進建議']]){d.append(node('h3',title));for(const text of saved.content[key]||[])d.append(node('p',text));}}else d.append(node('p',job.deep_attempt?.message||'正在分析…'));}
 if(job.normalized&&job.requirements?.some(r=>!r.label)){
  const update=button('更新要求摘要',async()=>{update.disabled=true;update.textContent='正在更新摘要…';try{const state=await request('/job/extract',{job_id:job.id,retry:true,refresh:true});const latest=state.jobs.find(j=>j.id===job.id);if(latest.extraction?.status!=='success')throw new Error(latest.extraction?.message||'更新尚未完成，已保存的要求仍保留。');open(latest,{...context,state});}catch(e){update.disabled=false;update.textContent='更新要求摘要';d.append(node('p',e.message,'hint'));}});
  d.append(update);
 }
 const details=node('details');details.open=!deep;details.append(node('summary','查看已保存 JD 與要求 Highlight'),sourceView(job,unit?[unit]:units));d.append(details);
 d.append(applyButton(job,context));document.body.append(d);d.showModal();d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=null;},{once:true});
}
function close(){dialog?.close();dialog?.remove();dialog=null;}
async function analyzeDeep(job,context,b){
 if(running.has(job.id))return;
 if(job.deep_analysis){open(job,context,null,true);return;}
 running.add(job.id);b.disabled=true;b.textContent='正在深度分析…';const scope=CareerProjects.id();
 clearTimeout(poll);poll=setTimeout(recover,700);
 const timer=setTimeout(()=>{b.textContent='系統需要更長時間處理…';},40000);
 try{const state=await request('/job/deep',{job_id:job.id},80000);if(scope===CareerProjects.id())open(state.jobs.find(j=>j.id===job.id),{...context,state},null,true);}
 catch(e){if(scope===CareerProjects.id())$('search-notice').textContent=e.message;}
 finally{clearTimeout(timer);running.delete(job.id);if(scope===CareerProjects.id())CareerWorkspace.restore(current());}
}
function card(job,context){
 const article=node('article',undefined,'job-card-v2 saved-job-card');article.dataset.jobId=job.id;article.dataset.analysisStatus=job.normalized?'success':job.analysis_status;article.dataset.source=job.source;article.dataset.analysisSeconds=job.extraction?.elapsed_seconds??'';
 const left=node('section',undefined,'job-identity'),right=node('section',undefined,'job-analysis-column');
 left.append(bookmarkButton(job));
 left.append(button(job.title,()=>open(job,context),'job-open'),node('p',job.company||'未提供','job-company'));
 const facts=node('dl',undefined,'job-facts');for(const [key,value] of [['地點',job.location],['薪金',job.salary_display],['截止日期',job.deadline],['工作類型',job.employment_type],['刊登日期',job.published_at]])facts.append(node('dt',key),node('dd',value||'未提供'));left.append(facts,button('查看已保存 JD',()=>open(job,context),'button-quiet'));
 if(job.url&&/^https?:\/\//i.test(job.url)){const a=node('a','原始招聘 ↗','job-source-top');a.href=job.url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label','開啟原始職缺');right.append(a);}
 right.append(node('h3','JD Requirements'));
 const match=context.state.matches.find(m=>m.job_id===job.id),requirements=node('div',undefined,'saved-job-requirements');
 if(match){for(const u of match.units||[]){const label=u.label||(u.alternative_groups?.length?u.alternative_groups.map(g=>g.map(p=>p.name).join(' + ')).join(' 或 '):(u.names||[u.name]).join(' / '));const b=button(`${u.type==='Preferred'?'加分':'必要'} · ${label}`,()=>open(job,context,u),'job-skill-chip match-'+u.status);b.title=u.reason;b.setAttribute('aria-label',label+'：'+u.reason);requirements.append(b);}}
 else requirements.append(node('p',message(job),'job-processing'));
 right.append(requirements);
 if(!job.normalized&&job.extraction?.status!=='running'&&job.analysis_status!=='running')right.append(button(['pending','unanalysed'].includes(job.analysis_status)?'分析這份 JD':'重試這份 JD',async()=>{try{await request('/job/extract',{job_id:job.id,retry:true});}catch(e){$('search-notice').textContent=e.message;}}));
 const footer=node('footer',undefined,'job-next-action');const score=node('div',undefined,'saved-job-score match-'+(match?.band||'pending'));
 score.append(node('strong',match?.score!=null?labels[match.band]:'尚未完成分析'));score.setAttribute('aria-label','匹配程度：'+score.textContent);footer.append(score);
 const deep=button(job.deep_analysis?'查看深度分析':'深度分析',()=>analyzeDeep(job,context,deep),'button-primary');deep.disabled=!job.normalized||running.has(job.id)||job.deep_attempt?.status==='running';
 if(job.deep_attempt?.status==='running')deep.textContent=Date.now()/1000-job.deep_attempt.started_at>40?'系統需要更長時間處理…':'正在深度分析…';
 footer.append(deep,applyButton(job,context));right.append(footer);
 article.append(left,right);return article;
}
document.addEventListener('career:project-reset',()=>{clearTimeout(poll);close();});
$('analyze-saved-jobs').onclick=()=>prepare({allSaved:true});
window.CareerJobWorkflow={render,search,card,open,close,query,recover};
})();
