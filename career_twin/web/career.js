"use strict";
(() => {
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)window.CareerI18n.text(n,text);if(cls)n.className=cls;return n;};
const labels={met:window.CareerI18n.msg("符合已知最低要求"),not_met:window.CareerI18n.msg("未符合"),unknown:window.CareerI18n.msg("資料待確認")},salaryLabels={met:window.CareerI18n.msg("已公布範圍符合（不保證 offer）"),not_met:window.CareerI18n.msg("不符合薪資期望"),possible:window.CareerI18n.msg("區間部分重疊，可能符合"),unknown:window.CareerI18n.msg("薪資口徑或資料待確認"),no_minimum:window.CareerI18n.msg("不設薪資下限")};
const origins={cv_explicit:window.CareerI18n.msg("CV 明確提供"),user_supplied:window.CareerI18n.msg("使用者補充／確認"),ai_inferred:window.CareerI18n.msg("AI 推測，待確認")};
let state=null,config=null,page="input",independent=false,busy=false,generation=0,controller=null,disabled=[],selectedJob=null,planningJob=null,frame=null,legacyKey="",legacyReady=false;
const edits=new Map(),legacyStates=new Map(),legacyDrafts=new Map(),legacyVersions=new Map(),synced=new Set(),applicationDrafts=new Map();
let qualificationReturn=null,manualSearch=null,jobsVisible=10;
let jobFlow=null,searchRunning=false,searchRun=0;
let cancelling=false,analysisMode=false,analysisAll=false,cvRequest=false;
let stopRecovery=null;
const operationNotice=progress=>window.CareerOperations.describe(progress);
function recoverOperation(force=false){
 if(config?.cv_extraction_mode==='single_pass'){stopRecovery?.();stopRecovery=window.CareerCVExtraction.recover(force);return;}
 const project=window.CareerProjects?.id();if(!project||!state||busy)return;
 stopRecovery?.();const token=++generation;controller=new AbortController();const signal=controller.signal;
 setBusy(true);note('',true);note(CareerI18n.msg('正在恢復處理狀態…'));
 stopRecovery=window.CareerOperations.watch(project,signal,{
  current:()=>token===generation&&project===window.CareerProjects?.id(),
  progress:(p,op)=>{analysisMode=['/api/career/extract','/api/career/normalize'].includes(op?.path);analysisAll=analysisMode&&state?.evidence_profile?.status==='current';updateAnalysisUI();note(operationNotice(p));},
  load:latest=>{if(latest&&(!state||latest.revision>=state.revision)){state=latest;render();}},
  complete:(op,observed)=>{
   setBusy(false);controller=null;
   if(!op){note(observed?CareerI18n.msg('處理狀態已失效；已載入保存資料，請重試。'):'');return;}
   const seenKey='career-operation:'+project;let seen;try{seen=sessionStorage.getItem(seenKey);sessionStorage.setItem(seenKey,op.request_id);}catch{}
   if(seen===op.request_id&&!observed){note();return;}
   const incomplete=!!state?.normalization_notice||state?.evidence_profile?.status==='partial'||(op.path==='/api/career/clarifications/analyze'&&state?.clarifications?.some(q=>q.answers?.length&&q.answers.at(-1).state!=='complete'));
   note(CareerI18n.msg(op.status==='completed'?(incomplete?'處理已結束，仍有分析未完成；已載入保存資料，可重試。':'處理已完成，已載入最新結果。'):op.status==='cancelled'?'已取消這次處理，資料已保留，可以重試。':'處理已中斷或失敗；已載入保存資料，請重試。'));
  },
  error:()=>note(CareerI18n.msg('暫時無法讀取處理狀態，正在重新連線；不會重複提交 AI。'))
 });
}
let detailJobId=null,directionBasis="",applicationBasis="",applicationJobVersion="";
const btn=(text,fn)=>{const b=el("button",text,"button-secondary");b.type="button";b.addEventListener("click",fn);return b;};
const badge=v=>el("span",labels[v]||v,"status status-"+v);
function note(text="",bad=false){if(analysisMode){const banner=$('cv-analysis-banner');window.CareerI18n.text($('cv-analysis-message'),text);banner.hidden=!text;banner.classList.toggle('is-error',bad);window.CareerI18n.text($('cv-analysis-heading'),CareerI18n.msg(bad?'分析未完成':'CV 分析進度'));return;}const n=$(bad?"error":"notice");window.CareerI18n.text(n,text);n.hidden=!text;window.CareerFeedback?.set(text,bad);}
function profileProgress(){if(!state)return;window.CareerI18n.text($("profile-heading"),window.CareerI18n.msg("個人資料與優勢"));}
function updateAnalysisUI(){
 $('cancel-profile').hidden=!busy||!analysisMode;
 $('cv-analysis-banner').classList.toggle('is-running',busy&&analysisMode);
 window.CareerProfileExperiences?.updateProcessing(busy&&analysisMode,analysisAll);
}
function setBusy(value){
 if(value&&busy)return;
 busy=value;updateAnalysisUI();$('cancel').hidden=!value;
 document.body.setAttribute('aria-busy',String(value));
 for(const id of ['profile-status','normalization-notice'])if($(id))$(id).hidden=value||!$(id).textContent;
 if(value){
  disabled=[...document.querySelectorAll('button,input,textarea,select')].filter(n=>!['cancel','cancel-profile'].includes(n.id)&&!n.dataset.page&&!n.hasAttribute('data-layout')&&!n.matches('.cv-source-toggle,.cv-skill-tag,.cv-skill-scroll-arrow')).map(n=>[n,n.disabled]);
  disabled.forEach(([n])=>n.disabled=true);
 }else{disabled.forEach(([n,v])=>n.disabled=v);disabled=[];}
 profileProgress();
}

async function cancel(){
 if(cancelling||!busy)return;searchRunning=false;searchRun++;
 if(cvRequest){
  generation++;controller?.abort();controller=null;cvRequest=false;setBusy(false);
  note(window.CareerI18n.msg('已停止等待；後端處理仍會保存結果，完成後會自動更新。'));
  stopRecovery?.();stopRecovery=window.CareerCVExtraction.recover(true,true);return;
 }
 const token=++generation,scope=window.CareerProjects?.id(),previous=controller;
 cancelling=true;$("cancel").disabled=true;note('',true);note(window.CareerI18n.msg("正在取消處理，請稍候…"));
 const stopped=window.CareerAPI.cancel(previous?.signal);previous?.abort();
 try{
  const result=await stopped;if(token!==generation)return;
  if(scope&&scope===window.CareerProjects?.id()){
   const project=await window.CareerAPI.request('/api/projects/'+scope,{projectId:null});
   if(token!==generation)return;
   if(project.state&&(!state||project.state.revision>state.revision)){state=project.state;render();}
  }
  controller=null;setBusy(false);
  note(window.CareerI18n.msg(result.unsupported?"已取消等待；輸入與最後成功版本保留。已送出的 AI 請求不保證能撤回。":"已取消這次處理，資料已保留，可以重試。"));
 }catch{
  if(token===generation)note(window.CareerI18n.msg("尚未確認取消，請再按一次取消；已有資料保留。"));
 }finally{cancelling=false;$("cancel").disabled=false;}
}
async function api(path,data,message=window.CareerI18n.msg("處理中，請稍候…"),binary=false){
 if(busy&&!(searchRunning&&path==='/jobs/prepare'))return null;
 const token=++generation,revision=state?.revision;controller=new AbortController();const signal=controller.signal;
 cvRequest=['/extract','/supplement'].includes(path)&&config?.cv_extraction_mode==='single_pass';
 analysisMode=['/extract','/normalize'].includes(path);analysisAll=!!data.reanalyze_capabilities||!!data.reanalyze_activities||!state?.extracted;$('cv-analysis-banner').hidden=true;$('notice').hidden=true;$('error').hidden=true;if(analysisMode)window.CareerFeedback?.set('');
 note();note('',true);setBusy(true);note(message);
 let done=false,timer=null,checking=false;const started=Date.now();
 const singleCV=['/extract','/supplement'].includes(path)&&config?.cv_extraction_mode==='single_pass';
 const resumable=!singleCV&&['/extract','/normalize','/clarifications/analyze','/clarifications/prepare'].includes(path);
 const track=resumable;
 async function progress(){
  if(done||token!==generation||checking)return;checking=true;
  try{
   const status=await window.CareerAPI.progress(signal);
   if(done||token!==generation||signal.aborted)return;
   const p=status?.pending&&status.progress,m=window.CareerI18n.msg;
   note(p?operationNotice(p):CareerI18n.join([message,' · ',m('已等待 {0} 秒',[Math.floor((Date.now()-started)/1000)]),' · ',m('剩餘時間無法準確預估。')]));
  }catch{/* Progress failure never cancels the actual saved operation. */}
  finally{checking=false;}
 }
 if(track)timer=setInterval(progress,2000);else if(['/job','/tailor'].includes(path))timer=setTimeout(()=>{if(!done)note(window.CareerI18n.msg('系統需要更長時間處理，完成後會自動保存並顯示。'));},path==='/job'?20000:40000);
 try{
  const result=await window.CareerAPI.request('/api/career'+path,{body:data,binary,signal:singleCV?AbortSignal.any([signal,AbortSignal.timeout(35000)]):signal});
  if(token!==generation||state?.revision!==revision)return null;
  note(window.CareerI18n.msg(!data.structure_only&&['/extract','/normalize'].includes(path)&&(result.normalization_notice||result.evidence_profile?.status==='partial')?'經歷原文已保存並顯示；部分能力尚未完成，請按「重新分析能力」重試。':path==='/clarifications/analyze'&&result.clarifications?.some(q=>q.id===data.clarification_id&&q.answers?.at(-1)?.state!=='complete')?'答案已保存；能力分析未完成，可重試。':'已完成。'));
  if(['/job','/job/manual','/job/match'].includes(path)){
   const job=result.jobs?.find(j=>j.id===data.job_id)||result.jobs?.at(-1);
   if(job?.analysis_status==='partial')note(window.CareerI18n.msg('部分職位條件待確認；有效結果已保留，暫不作完整評分。'));
   else if(['failed','quota'].includes(job?.analysis_status)){note();note(window.CareerI18n.msg('職位原文已保存；分析尚未完成。{0}',[job.details_notice||'']),true);}
   const matching=result.matches?.find(r=>r.job_id===job?.id)?.evidence_matching;
   if(matching&&result.matching_failures?.[matching.basis]==='request_budget_exhausted'){note();note(window.CareerI18n.msg('匹配分析未完成；職位分析額度已用完。'),true);}
   else if(matching?.status==='role_unverified')note(window.CareerI18n.msg('職位類別待確認'));
   else if(matching?.status==='analysis_incomplete')note(window.CareerI18n.msg('匹配分析尚未完成'));
  }
  if(singleCV){const record=path==='/supplement'?result.evidence_profile?.supplemental_evidence?.find(r=>r.submission_id===data.submission_id||r.text===data.text&&r.experience_id===data.item_id):null;note(record?window.CareerI18n.msg(record.message):window.CareerCVExtraction.statusText(result),['failed','timeout'].includes(record?.analysis_status||result.cv_extraction?.status));}
  return result;
 }catch(e){if(token===generation&&e.name!=='AbortError'){note();note(e instanceof TypeError?window.CareerI18n.msg('無法連接後端；輸入仍保留，可重試。'):e.message,!['trial_ai_busy','request_cancelled','operation_in_progress'].includes(e.code));if(singleCV||resumable||e.code==='operation_in_progress')setTimeout(()=>{if(token===generation)recoverOperation(singleCV);},0);}return null;}
 finally{done=true;clearInterval(timer);if(token===generation){if(!searchRunning)setBusy(false);controller=null;cvRequest=false;}}
}
function snapshot(){
 rememberApplication();
 const fields={};document.querySelectorAll('.view input[id],.view textarea[id],.view select[id]').forEach(n=>{if(n.type!=='file'&&!n.id.startsWith('pilot-')&&!n.id.startsWith('cv-supplement-'))fields[n.id]={value:n.value,checked:n.checked};});
 return {fields,manualSearch,qualificationReturn,jobFlow,materialView:window.CareerApplications.snapshot?.(),profileStage:document.querySelector("[data-profile-step][aria-selected=true]")?.dataset.profileStep,edits:[...edits],legacyStates:[...legacyStates],legacyDrafts:[...legacyDrafts],legacyVersions:[...legacyVersions],synced:[...synced],applicationDrafts:[...applicationDrafts],legacyKey,selectedJob,planningJob,detailJobId};
}
function resetProject(){
 document.dispatchEvent(new CustomEvent('career:project-reset'));
 analysisMode=false;$('cv-analysis-banner').hidden=true;
 searchTitleError(false);
 stopRecovery?.();stopRecovery=null;
 window.CareerJobs.closeDetail();window.CareerJobCards?.close();window.CareerJobOverview?.clear();jobFlow=null;searchRunning=false;searchRun++;manualSearch=null;jobsVisible=10;
 generation++;controller?.abort();controller=null;setBusy(false);state=null;selectedJob=null;planningJob=null;detailJobId=null;clearJobSelection();directionBasis='';applicationBasis='';applicationJobVersion='';
 frame?.remove();frame=null;legacyKey='';legacyReady=false;qualificationReturn=null;edits.clear();legacyDrafts.clear();legacyStates.clear();legacyVersions.clear();synced.clear();applicationDrafts.clear();
 document.querySelectorAll('.view form').forEach(n=>n.reset());
 document.querySelectorAll('.view input,.view textarea,.view select').forEach(n=>{if(n.type==='file')n.value='';else if(n.tagName==='SELECT')n.selectedIndex=0;else{n.value=n.defaultValue;n.checked=n.defaultChecked;}});
 for(const id of ['job-results','catalog-results','versions','career-plans','legacy-container','legacy-history','selected-job-match','selected-job-description','selected-job-title','profile-original-items','profile-items','questions','skipped-question-list','standardized-cv-text'])$(id)?.replaceChildren();
 $('application-job').replaceChildren(window.CareerI18n.option(window.CareerI18n.msg("請選擇已分析的職位"),''));
 $('existing-cv').hidden=true;$('profile-onboarding').hidden=false;$('profile-workflow').hidden=true;$('cv-file').value='';$('paste-label').hidden=false;$('file-label').hidden=true;
 if(config){$('salary').value=config.salary.default;}salaryDisplay();note();note('',true);
}
function activateProject(value,ui={}){
 for(const [key,value] of ui.applicationDrafts||[])applicationDrafts.set(key,value);
 jobFlow=ui.jobFlow||null;qualificationReturn=ui.qualificationReturn||null;window.CareerApplications.restore?.(ui.materialView);
 state=value;legacyKey=ui.legacyKey||"";for(const [key,value] of ui.edits||[])edits.set(key,value);for(const [key,value] of ui.legacyDrafts||[])legacyDrafts.set(key,value);for(const [key,value] of ui.legacyStates||[])legacyStates.set(key,value);for(const [key,value] of ui.legacyVersions||[])legacyVersions.set(key,value);for(const key of ui.synced||[])synced.add(key);
 manualSearch=ui.manualSearch||null;if(!state&&manualSearch)renderManualSearch();const preferences=state?.preferences||ui.preferences;if(state)$('cv-text').value=state.document.text;if(preferences){$('salary').value=preferences.minimum_salary;$('target-role').value=preferences.target_role||'';$('preferred-job-type').value=preferences.job_type||'';}
 if(state){selectedJob=ui.selectedJob||null;state.interview_context={...(state.interview_context||{}),job_id:selectedJob,version_id:state.interview_context?.job_id===selectedJob?state.interview_context?.version_id||null:null};planningJob=ui.planningJob||null;detailJobId=ui.detailJobId||null;render();}
 for(const [id,saved] of Object.entries(ui.fields||{})){const n=$(id);if(n&&n.closest('.view')&&n.type!=='file'&&!id.startsWith('pilot-')&&!id.startsWith('cv-supplement-')){n.value=saved.value;if(typeof saved.checked==='boolean')n.checked=saved.checked;}}
 if(state){$('search-salary').value=state.job_search?.query?.minimum_salary??state.preferences.minimum_salary;renderJobs();}
 document.querySelector('[name="cv-mode"][value="text"]').checked=true;$('paste-label').hidden=false;$('file-label').hidden=true;salaryDisplay();document.dispatchEvent(new CustomEvent('career:state'));
 recoverOperation();
}
function targetJob(){return [...(state?.jobs||[]),...(state?.catalog_jobs||[])].find(j=>j.id===selectedJob)||null;}
function selectTarget(id){
 rememberApplication();
 const job=[...(state?.jobs||[]),...(state?.catalog_jobs||[])].find(j=>j.id===id);selectedJob=job?.id||null;
 if(state)state.interview_context={...(state.interview_context||{}),job_id:selectedJob,version_id:state.interview_context?.job_id===selectedJob?state.interview_context?.version_id||null:null};
 if(jobFlow&&jobFlow.jobId!==selectedJob)jobFlow=null;
 if($('pilot-job'))$('pilot-job').value=selectedJob||'';
 if(page==='planning'){planningJob=selectedJob;if(job)window.CareerI18n.text($('planning-title'),job.title);else go('roadmap');}
 renderApplications();document.dispatchEvent(new CustomEvent('career:target'));window.CareerProjects?.schedule();
}
window.CareerWorkspace={isAnalyzingCV:()=>analysisMode&&busy,isReanalyzingAll:()=>analysisAll,jobContext,renderJobOverview:()=>CareerJobOverview.render(jobContext()),getConfig:()=>config,hasManualSearch:()=>!!manualSearch,snapshot,reset:resetProject,activate:activateProject,getState:()=>state,restore:value=>{state=value;render();},setOptions:value=>{if(state)state.runtime_options=value;},selectJob:selectTarget,getTargetJob:targetJob,
 openQuestions:id=>{qualificationReturn={project:window.CareerProjects?.id(),jobId:id};go("profile");renderReturn();window.CareerWorkspaceUI.openStage("stage-c");window.CareerProjects?.schedule();},
 renderAnalysis:()=>{const j=targetJob();return j?(j.source==='internal'?catalogCard(j):jobCard(j,true)):null;},
 planTarget:()=>{const j=targetJob();if(j)selectPlanning(j);else go('analysis');},
 openVersion:id=>{const v=state?.tailored.find(v=>v.id===id);if(v){selectTarget(v.job_id);go('applications');window.CareerApplications.selectVersion(id);document.querySelector('[data-version-id="'+CSS.escape(id)+'"]')?.scrollIntoView({block:'start'});}}
};
const payload=(extra={})=>{if(state&&window.CareerPilot)state.runtime_options=window.CareerPilot.options();return {state,expected_revision:state.revision,...extra};};
async function mutate(path,extra={},message,after){if(!state){go("input");note(window.CareerI18n.msg("這個專案還沒有 CV，請先加入。"),true);return null;}const scope=window.CareerProjects?.id();const result=await api(path,payload(extra),message);if(result){state=result;if(after)after();render();if(window.CareerPilot&&!['/extract','/supplement'].includes(path))await window.CareerPilot.sync(state).catch(e=>{if(e.name!=="AbortError"&&scope===window.CareerProjects?.id())note(e.message,true);});}return scope===window.CareerProjects?.id()?result:null;}
function go(next){
 next=window.CareerProjects?.guard(next)||next;independent=false;page=next==="interview-entry"?"interview":next;
 if(page==='interview'&&!state)page='practice';
 if(page==='planning'){renderPlanningFocus();const j=targetJob();if(!j)page='roadmap';else{planningJob=j.id;window.CareerI18n.text($('planning-title'),j.title);}}
 if(page==='legacy'&&!frame){if(legacyKey&&legacyStates.has(legacyKey)){openLegacy(legacyVersions.get(legacyKey)?.jobId||null,legacyKey);return;}page='roadmap';}
 window.CareerLayout.show(page);
 $("shared-notes").hidden=["interview","practice","home","projects","overview","history"].includes(page);
 $("preferences-input").hidden=independent;$("reuse-interview").hidden=!independent||!state;
 window.CareerI18n.text($("input-heading"),window.CareerI18n.msg("先把你的經歷，放在這裡。"));
 window.CareerI18n.text($("input-lead"),window.CareerI18n.msg("保留原文，整理重點。這份 CV 會連結到你的職位比對、申請與面試。"));
 window.CareerI18n.text($("submit-cv"),state?window.CareerI18n.msg("保存 CV／偏好變更"):window.CareerI18n.msg("保存並整理 CV"));
 $("profile-onboarding").hidden=!!state;$("profile-workflow").hidden=!state;

 if(['jobs','saved-jobs'].includes(page)&&state)renderJobs();
 if(page==="applications"&&!busy){renderApplications();renderVersions();}

 const stage=$('interview-card');if(page==='practice')$('general-voice').append(stage);else $('view-interview').querySelector('.interview-stage').prepend(stage);
 window.CareerProjects?.emptyStates();document.dispatchEvent(new CustomEvent("career:interview",{detail:{visible:page==='practice'||(page==='interview'&&!!state)}}));
}
window.CareerLayout.bind(go);
$("cancel").addEventListener("click",cancel);$("cancel-profile").addEventListener("click",cancel);
$("refresh-catalog").onclick=()=>mutate("/catalog",{},window.CareerI18n.msg("正在核對最低要求…"));
function salaryDisplay(){const v=Number($("salary").value);window.CareerI18n.text($("salary-display"),v?window.CareerI18n.join(["HKD "+new Intl.NumberFormat("zh-HK").format(v),window.CareerI18n.msg("／月")]):window.CareerI18n.msg("不設下限（HKD／月）"));}$("salary").addEventListener("input",salaryDisplay);
window.CareerCVExtraction.bind({$,getState:()=>state,getConfig:()=>config,isBusy:()=>busy,api,mutate,note,
 setState:value=>{state=value;},setBusy,render,go,payload});

function textarea(key,value,rows=4){const t=el("textarea");t.value=edits.has(key)?edits.get(key):value;t.rows=rows;t.maxLength=4000;t.addEventListener("input",()=>edits.set(key,t.value));return t;}
function details(label,text){const d=el("details");d.append(el("summary",label),el("pre",text));return d;}
function link(url){try{const u=new URL(url);if(!["https:","http:"].includes(u.protocol))return null;const a=el("a",window.CareerI18n.msg("查看來源"),"source-link");a.href=u.href;a.target="_blank";a.rel="noopener noreferrer";return a;}catch{return null;}}
function structuredFields(items){return window.CareerProfile.structuredFields(items,{el,config});}
function renderReturn(){const b=$("return-qualification-job"),valid=qualificationReturn&&qualificationReturn.project===window.CareerProjects?.id()&&state?.jobs.some(j=>j.id===qualificationReturn.jobId);b.hidden=!valid;}
$("return-qualification-job").addEventListener("click",()=>{if(!qualificationReturn)return;selectTarget(qualificationReturn.jobId);go("analysis");});
function renderProfile(){renderReturn();window.CareerProfile.render({state,config,$,el,details,btn,textarea,mutate,edits,profileProgress,standardizedText});}
function salaryText(j){const s=j.salary;return s.minimum===null&&s.maximum===null?window.CareerI18n.msg("薪資未公布／面議"):window.CareerI18n.msg("{0} {1}–{2} / {3}",[s.currency||window.CareerI18n.msg("幣別未知"),s.minimum??"?",s.maximum??"?",s.period||window.CareerI18n.msg("週期未知")]);}
function standardizedText(version){return version.entries.map(entry=>entry.title+(entry.needs_confirmation?"（推測，待確認）":"")+"\n"+Object.entries(entry.fields).map(([key,value])=>(/^\d+$/.test(key)?"• ":key+"：")+value).join("\n")).join("\n\n");}
function standardizedJobView(j){const box=el("section",undefined,"standardized-job");box.dataset.standardizedVersion=j.standardized.id;box.append(el("h3",j.standardized.scope==="job_description"?window.CareerI18n.msg("標準化 JD"):window.CareerI18n.msg("標準化職位摘要")));for(const entry of j.standardized.entries){box.append(el("h4",entry.title));if(entry.section==="description"){const text=entry.fields["內容"]||"";box.append(el("p",text.length>600?text.slice(0,600)+"…":text,"job-excerpt"));}else if(["required","preferred","not_required","responsibility"].includes(entry.section)){const list=el("ul");Object.values(entry.fields).forEach(value=>list.append(el("li",value)));box.append(list);}else box.append(structuredFields([entry]));}box.append(details(window.CareerI18n.msg("查看標準化文字版本"),standardizedText(j.standardized)));return box;}
function matchDetails(j){if(state?.matches?.some(m=>m.job_id===j.id&&m.algorithm==='FCDT A_80_20'))return CareerJobWorkflow.card(j,jobContext());
 const box=el("div",undefined,"qualification-results"),m=(j.source==="internal"?state.catalog_matches:state.matches).find(m=>m.job_id===j.id);
 if(!m){box.append(el("p",window.CareerI18n.msg("尚未完成資格比對。"),"hint"));return box;}
 box.append(badge(m.status),el("p",window.CareerI18n.msg("使用目前 CV 資料修訂 {0}；自述支持與外部驗證分開。",[state.revision]),"hint"));
 if(state.normalization_notice)box.append(el("p",window.CareerI18n.msg("部分資格整理尚未完成；以下已知條件保留，未知項目等待更新。"),"sample-note"));
 const exempt=r=>/\b(?:is|are) not (?:required|necessary|mandatory)\b/i.test(r.quote)&&!/preferred|desirable/i.test(r.quote);
 const kind=r=>exempt(r)?"not_required":r.required?"required":"preferred";
 for(const [group,title] of [["required","必要條件"],["preferred","加分條件"],["not_required","不要求"]]){
  const reqs=j.requirements.filter(r=>kind(r)===group);if(!reqs.length)continue;box.append(el("h3",window.CareerI18n.msg(title)));
  reqs.sort((a,b)=>Number(m.conditions.find(c=>c.requirement_id===b.id)?.status==="not_met")-Number(m.conditions.find(c=>c.requirement_id===a.id)?.status==="not_met"));
  for(const r of reqs){const c=m.conditions.find(x=>x.requirement_id===r.id);if(!c)continue;const row=el("section",undefined,"condition");row.dataset.requirementId=r.id;
   row.append(el("strong",r.description),exempt(r)?el("span",window.CareerI18n.msg("不要求"),"chip"):badge(c.status),el("p",c.reason));
   const source=el("details");source.append(el("summary",window.CareerI18n.msg("查看 JD 與資料引用")),el("blockquote",r.quote,"quote"));
   const quotes=[...(c.evidence_item_ids||[]).map(id=>state.items.find(i=>i.id===id)?.text),...c.claim_ids.map(id=>state.claims.find(c=>c.id===id)?.quote)].filter(Boolean);
   [...new Set(quotes)].forEach(q=>source.append(el("blockquote",q,"quote")));row.append(source);box.append(row);
  }
 }
 if(!j.full_description||!j.requirements_complete)box.append(el("p",window.CareerI18n.msg("JD 內容尚有限制；上方已知條件的判定仍有效，不能視為完整招聘資格確認。"),"hint"));
 if(j.source!=="internal")box.append(el("p",salaryLabels[m.salary_status],"muted"));return box;
}
function catalogCard(j){const card=el("article",undefined,"panel catalog-card");card.dataset.baselineId=j.id;card.append(el("h3",j.title),el("p",j.location||"","muted"),matchDetails(j));const m=state.catalog_matches.find(m=>m.job_id===j.id),actions=el("div",undefined,"toolbar left");if(m?.status==="met")actions.append(btn(window.CareerI18n.msg("確認基礎 CV 後進入面試頁"),async()=>{if(await mutate("/base-confirm"))await interview(j.id);}));else if(m?.status==="not_met")actions.append(btn(window.CareerI18n.msg("規劃補足最低要求"),()=>selectPlanning(j)));else if(m?.status==="unknown")actions.append(btn(window.CareerI18n.msg("補充資格資料"),async()=>{if(await mutate("/catalog/questions",{job_id:j.id},window.CareerI18n.msg("正在確認需要補充的具體資格…")))window.CareerWorkspaceUI.openStage("stage-c");}));card.append(actions);return card;}
function jobContext(){return {selectTarget,state,$,el,link,details,standardizedJobView,matchDetails,btn,mutate,fetchJobDetails,selectJobDetails,selectTailoring,interview,selectPlanning,go,
 rematchJob:async j=>mutate('/job/match',{job_id:j.id,retry:true},window.CareerI18n.msg('正在重新比對來源證據…')),
 analyzeJob:async j=>{const result=await mutate('/job',{job_id:j.id},window.CareerI18n.msg('正在分析職位要求…'));if(result){selectTarget(j.id);}},
 clarify:(j,opener)=>{jobFlow={project:CareerProjects.id(),jobId:j.id,version:j.version,requirements:CareerJobAnalysis.diagnostic(j,state).requirements.map(r=>r.requirement.id),type:'evidence'};CareerProjects.schedule();return CareerJobCards.clarify(j,jobContext(),opener);},
 openEvidenceItem:p=>{go('profile');CareerWorkspaceUI.openStage('stage-b');requestAnimationFrame(()=>CareerProfileExperiences.reveal(p));}};}
function jobCard(j,analysis=false){return window.CareerJobs.card(j,{...jobContext(),analysis});}
function renderJobs(){CareerJobWorkflow.render(jobContext());}

$("job-match-filter").addEventListener('change',()=>{if(state)renderJobs();window.CareerProjects?.schedule();});
$("profile-matched-jobs").addEventListener('click',()=>{$('job-match-filter').value='met';go('jobs');window.CareerProjects?.schedule();$('job-match-filter').focus({preventScroll:true});});
function renderManualSearch(){
 if(!manualSearch)return;
 const context={state:manualSearch,el,btn,link,go,selectJobDetails:j=>{go('jobs');$('manual-job-entry').open=true;$('job-url').value=j.url||'';$('job-jd').value=j.jd||'';$('job-jd').focus();},manualAnalyze:async job=>{
  const result=await api('/job/manual',{job},window.CareerI18n.msg('正在整理職位要求…'));
  if(result){manualSearch.jobs=manualSearch.jobs.map(j=>j.id===result.id?result:j);renderManualSearch();window.CareerProjects?.schedule();}
  return result;
 }};
 $('job-results').replaceChildren(...CareerJobAnalysis.filter(manualSearch.jobs,{level:$('search-level').value,minimum:Number($('search-salary').value)}).slice(0,jobsVisible).map(j=>window.CareerJobs.card(j,context)));
 if(manualSearch.jobs.length>jobsVisible)$('job-results').append(btn(window.CareerI18n.msg('更多已取得結果'),()=>{jobsVisible+=10;renderManualSearch();}));
 window.CareerI18n.text($('search-notice'),manualSearch.job_search.message);
}
async function searchJobs(query,message){return CareerJobWorkflow.search(query);}

function searchTitleError(show){
 const input=$('search-title'),error=$('search-title-error');
 error.hidden=!show;
 window.CareerI18n.text(error,show?window.CareerI18n.msg('請先輸入職位名稱，例如 Risk Analyst。'): '');
 if(show){input.setAttribute('aria-invalid','true');input.focus();}else input.removeAttribute('aria-invalid');
}
$('search-title').addEventListener('input',()=>searchTitleError(false));
$('search-by-cv').addEventListener('click',async()=>{
 if(busy||!state?.extracted)return;
 searchTitleError(false);$('job-match-filter').value='all';
 await searchJobs({page:1,keywords:null,use_cv:true,strategy:'titles'},CareerI18n.msg('正在按目前 CV 能力尋找職位，再分析匹配證據…'));
});
$('job-search-form').addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;
 const query=CareerJobs.searchQuery($('search-title').value,state);
 searchTitleError(!query);if(!query)return;
 
 await searchJobs(query,window.CareerI18n.msg('正在搜尋相關香港職缺…'));
});
for(const id of ['search-level','search-salary','search-location','search-work-type','search-contract-type','search-work-place'])$(id).addEventListener('change',()=>{CareerProjects?.schedule();});
$('search-filter-slot').append($('job-match-filter').closest('.job-filter-row'));
$("retry-search").addEventListener("click",()=>{const q=state?.job_search.query;if(q)searchJobs({keywords:q.keywords,location:q.location,page:q.page,use_cv:!!state?.job_search.use_cv,strategy:state?.job_search.use_cv?'titles':'adaptive'},window.CareerI18n.msg("正在重試本次 Techmap 搜尋…"));});
async function fetchJobDetails(j){
 const result=await mutate('/job',{job_id:j.id,url:j.url},window.CareerI18n.msg('正在讀取這筆職位的 JD 並分析資格…'));
 if(!result)return null;
 if(page==='jobs')document.querySelector('#job-results [data-job-id="'+CSS.escape(j.id)+'"]')?.scrollIntoView({block:'start'});
 return result;
}
function selectJobDetails(j){selectTarget(j.id);go("jobs");detailJobId=j.id;$("manual-job-entry").open=true;$("job-update-target").hidden=false;window.CareerI18n.text($("job-update-target"),window.CareerI18n.msg("{0} · {1}：請貼上這筆職位的工作內容、必備資格及加分條件。",[j.company||"",j.title]));$("cancel-job-update").hidden=false;window.CareerI18n.text($("submit-job"),window.CareerI18n.msg("保存 JD 並更新這筆職缺"));$("job-url").value=j.description_source_url||j.url||"";$("job-jd").value=edits.get("jd:"+j.id)||"";$("job-form").scrollIntoView();$("job-jd").focus();}
function clearJobSelection(){detailJobId=null;$("job-update-target").hidden=true;$("cancel-job-update").hidden=true;window.CareerI18n.text($("submit-job"),window.CareerI18n.msg("分析這份 JD"));}
$("cancel-job-update").addEventListener("click",clearJobSelection);
$("job-jd").addEventListener("input",()=>{if(detailJobId)edits.set("jd:"+detailJobId,$("job-jd").value);});
$("job-form").addEventListener("submit",async e=>{e.preventDefault();if(!state){await window.CareerProjects?.flush();go('input');return;}
 if(!$("job-url").value.trim()&&!$("job-jd").value.trim()){$("job-jd").focus();note(window.CareerI18n.msg("請貼上職位 JD 或提供職位網址。"),true);return;}
 const current=detailJobId,originPage=page,result=await mutate("/job",{job_id:detailJobId,url:$("job-url").value.trim()||null,jd:$("job-jd").value.trim()||null},window.CareerI18n.msg("正在取得／標準化 JD；失敗時保留輸入…"),clearJobSelection);
 if(result){selectTarget(current||result.jobs.at(-1)?.id);if(page===originPage)go('analysis');}
});
function renderApplications(){
 const jobs=(state?.jobs||[]).filter(j=>j.full_description||j.jd||j.description_excerpt);
 const job=jobs.find(j=>j.id===selectedJob);

 const placeholder=el("option",jobs.length?window.CareerI18n.msg("請選擇這次申請的職位"):window.CareerI18n.msg("尚無已分析職位，請貼上 JD 或前往搜尋"));placeholder.value="";
 $("application-job").replaceChildren(placeholder,...jobs.map(j=>{const option=el("option",window.CareerI18n.msg("{0} · {1}{2}",[j.company||window.CareerI18n.msg("公司未知"),j.title,j.full_description?"":window.CareerI18n.msg("（摘要，資訊有限）")]));option.value=j.id;return option;}));
 $("application-job").value=job?.id||"";$("application-job").disabled=!jobs.length;
 $("application-add-job").disabled=!state;$("application-jd").disabled=!state;
 const confirmed=(state?.items||[]).filter(i=>i.review==="confirmed"&&i.section!=="personal").length;
 $("application-cv-link").hidden=!!state;$("application-review-link").hidden=!state;
 window.CareerI18n.text($("application-readiness"),!state?window.CareerI18n.msg("提供 CV 後會自動整理，兩項功能沿用同一份資料。"):!confirmed?window.CareerI18n.msg("CV 已保存；請完成自動整理或回答關鍵補充問題。"):window.CareerI18n.msg("可使用 {0} 段 CV 與補充資料。{1}",[confirmed,job?window.CareerI18n.msg("已選好本次職位，查看下方內容後即可生成。"):window.CareerI18n.msg("選擇目標職位後，即可調整 CV 或生成求職信。")]));
 const jobVersion=job?`${job.id}:${job.version}`:"";
 const basis=JSON.stringify([jobVersion,state?.document.id,state?.items.map(i=>[i.id,i.revision,i.review]),state?.claims]);
 if(basis!==applicationBasis){applicationBasis=basis;$("confirm-jd").checked=false;$("allow-partial").checked=false;}
 if(jobVersion!==applicationJobVersion){applicationJobVersion=jobVersion;$("cv-language").value=state?.language||"zh-Hant";$("cover-language").value=job?.language||"en";$("company-url").value="";$("confirm-company").checked=false;
  const saved=applicationDrafts.get(job?.id);if(saved)for(const [id,value] of Object.entries(saved.fields)){if(['confirm-jd','allow-partial'].includes(id)&&saved.basis!==basis)continue;const n=$(id);if(n.type==='checkbox')n.checked=value;else n.value=value;}
 }
 $("tailor-setup").hidden=!job;$("confirm-jd").disabled=!job;
 const limited=!!job&&(!job.full_description||job.analysis_status==='partial');$("allow-partial-row").hidden=!limited;$("allow-partial").required=limited;$("allow-partial").disabled=!limited;
 if(job){window.CareerI18n.text($("selected-job-title"),window.CareerI18n.msg("{0} · {1}",[job.company||window.CareerI18n.msg("公司未知"),job.title]));window.CareerI18n.text($("selected-job-description"),job.jd||job.description_excerpt||window.CareerI18n.msg("此職位未提供原始 JD，請核對下方已知要求。"));$("selected-job-match").replaceChildren(matchDetails(job));window.CareerI18n.text($("confirm-jd-text"),job.full_description?window.CareerI18n.msg("我已核對完整 JD 及目前資格結果"):window.CareerI18n.msg("我已查看職位摘要及初步資格結果"));}
 for(const id of ["generate-cv","generate-cover","generate-both"])$(id).disabled=!job?.normalized||!confirmed;
}
function rememberApplication(){
 if(!selectedJob||!applicationJobVersion.startsWith(selectedJob+':'))return;
 const fields={};for(const id of ['company-url','confirm-company','confirm-jd','allow-partial','cv-language','cover-language']){const n=$(id);fields[id]=n.type==='checkbox'?n.checked:n.value;}
 applicationDrafts.set(selectedJob,{basis:applicationBasis,fields});
}
function selectTailoring(j){selectTarget(j.id);go("applications");}
$("application-job").addEventListener("change",()=>selectTarget($("application-job").value||null));
$("application-job-form").addEventListener("submit",async e=>{
 e.preventDefault();const jd=$("application-jd").value.trim();if(!jd)return;
 const result=await mutate("/job",{jd},window.CareerI18n.msg("正在分析職位內容，成功後可直接準備申請材料…"));
 if(result?.jobs.at(-1)?.normalized){$("application-jd").value="";$("application-new-job").open=false;selectTailoring(result.jobs.at(-1));}
});
$("tailor-form").addEventListener("submit",async e=>{
 e.preventDefault();if(busy)return;
 if(!state||!selectedJob){note(window.CareerI18n.msg("請先提供 CV 並選擇這次申請的職位。"),true);return;}
 const mode=e.submitter?.value||"cv",includeCV=mode==="cv"||mode==="both",includeCover=mode==="cover"||mode==="both";
 if(!includeCV&&!includeCover)return;
 const result=await mutate("/tailor",{job_id:selectedJob,confirmed_job:$("confirm-jd").checked,allow_partial:$("allow-partial").checked,language:$("cv-language").value,cover_language:$("cover-language").value,include_cv:includeCV,include_cover:includeCover,company_url:$("company-url").value.trim()||null,company_identity_confirmed:$("confirm-company").checked},includeCV&&includeCover?window.CareerI18n.msg("正在按職位調整 CV 並撰寫求職信，完成後會檢查內容…"):includeCV?window.CareerI18n.msg("正在按職位選材、調整簡歷重點並檢查內容…"):window.CareerI18n.msg("正在把相關經歷寫成求職信並檢查內容…"));
 if(result&&page==="applications")$("versions").scrollIntoView({block:"start"});
});
function renderVersions(){window.CareerApplications.renderVersions({state,$,el,details,link,textarea,btn,mutate,note,download,interview,edits});}
async function download(id,format,material="all"){if(busy)return;const token=++generation;controller=new AbortController();setBusy(true);try{const blob=await window.CareerAPI.request("/api/career/export",{body:payload({version_id:id,format,material}),signal:controller.signal,responseType:"blob"});if(token!==generation)return;const url=URL.createObjectURL(blob),a=el("a");a.href=url;a.download=`application-${id}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);note(window.CareerI18n.msg("已匯出；UTF-8 回讀檢查通過。版面與 PDF 檢查未執行。"));}catch(e){if(token===generation&&e.name!=="AbortError")note(e.message,true);}finally{if(token===generation)setBusy(false);}}
function planningFocus(){const job=targetJob();return jobFlow?.type==='plan'&&jobFlow.project===CareerProjects.id()&&jobFlow.jobId===job?.id&&jobFlow.version===job?.version?jobFlow.requirements:[];}
function renderPlanningFocus(){const focus=$('planning-gap-context'),j=targetJob();focus.replaceChildren();for(const id of planningFocus()){const r=j.requirements.find(r=>r.id===id);if(r)focus.append(el('p',r.description,'job-plan-focus'));}}
function selectPlanning(j,requirements=[]){selectTarget(j.id);jobFlow={project:CareerProjects.id(),jobId:j.id,version:j.version,requirements,type:'plan'};renderPlanningFocus();if(!planningJob){$('plan-hours').value=state.constraints.hours??'';$('plan-budget').value=state.constraints.budget_hkd??'';$('plan-tools').value=state.tools;}planningJob=j.id;window.CareerI18n.text($('planning-title'),j.title);go('planning');}
const numeric=n=>n.value.trim()===""?null:Number(n.value);$("planning-form").addEventListener("submit",async e=>{e.preventDefault();const r=await mutate("/plan",{job_id:planningJob,consent:true,requirement_ids:planningFocus(),constraints:{hours:numeric($("plan-hours")),budget_hkd:numeric($("plan-budget"))},tools:$("plan-tools").value},window.CareerI18n.msg("正在依缺口與已知限制規劃…"));if(r&&page==="planning")go("roadmap");});
function renderPlans(){window.CareerPlanning.render({state,$,el,link,btn,openLegacy});}
async function interview(jobId=null,versionId=null){selectTarget(jobId);if(await mutate("/interview",{job_id:jobId,version_id:versionId},window.CareerI18n.msg("正在保留 CV 接點…")))go("interview");}$("reuse-interview").addEventListener("click",()=>interview());
function sendLegacy(){if(frame&&legacyReady&&legacyStates.has(legacyKey))frame.contentWindow.postMessage({type:"career-import",state:legacyStates.get(legacyKey),ui:legacyDrafts.get(legacyKey)||{}},location.origin);}
function legacyBasis(jobId){return JSON.stringify([state.document.id,state.items.map(i=>[i.id,i.revision,i.review]),state.evidence_profile?.basis,state.constraints,[...state.jobs,...state.catalog_jobs].find(j=>j.id===jobId)?.version]);}
function renderLegacyHistory(){
 const current=legacyVersions.get(legacyKey); if(!current)return;
 const stale=current.basis!==legacyBasis(current.jobId),box=$("legacy-history");
 box.replaceChildren(el("p",stale?window.CareerI18n.msg("主資料或 JD 已更新：目前顯示舊版工作區，分析與計畫只適用於當時資料。"):window.CareerI18n.msg("目前工作區使用轉接時已核對的主資料。"),"sample-note"));
 if(stale)box.append(btn(window.CareerI18n.msg("以最新主資料另開工作區，保留舊計畫"),()=>openLegacy(current.jobId)));
 for(const [key,version] of legacyVersions){if(version.jobId===current.jobId&&key!==legacyKey)box.append(btn(window.CareerI18n.join([version.label,(version.basis!==legacyBasis(version.jobId)?window.CareerI18n.msg("（舊版）"):window.CareerI18n.msg("（目前主資料）"))]),()=>openLegacy(version.jobId,key)));}
}
async function openLegacy(jobId=null,snapshotKey=null){
 if(!state){go("input");return;}
 if(jobId)selectTarget(jobId);
 const basis=legacyBasis(jobId),key=snapshotKey||JSON.stringify([jobId,basis]);
 if(!legacyStates.has(key)){
   const r=await api("/legacy",payload({job_id:jobId}),window.CareerI18n.msg("正在轉接已核對內容，不重新抽取 CV…"));if(!r)return;
   legacyStates.set(key,r);legacyVersions.set(key,{jobId,basis,label:window.CareerI18n.join([window.CareerI18n.msg("工作區 "),(legacyVersions.size+1)])});
 }
 legacyKey=key;
 if(!frame){frame=el("iframe");window.CareerI18n.prop(frame,"title",window.CareerI18n.msg("原有行動比較與成果工作區"));frame.src=window.CareerURL("/legacy?project=")+encodeURIComponent(window.CareerProjects?.id()||"");$("legacy-container").append(frame);}
 sendLegacy();renderLegacyHistory();go("legacy");
}
$("open-legacy-roadmap").addEventListener("click",()=>openLegacy(targetJob()?.id||null));
window.addEventListener("message",e=>{if(e.origin!==location.origin||e.source!==frame?.contentWindow)return;if(e.data?.type==="career-legacy-ready"){legacyReady=true;sendLegacy();}if(e.data?.type==="career-legacy-height"&&Number.isFinite(e.data.height))frame.style.height=Math.max(500,Math.min(100000,e.data.height))+"px";if(e.data?.type==="career-legacy-scroll"&&Number.isFinite(e.data.top))window.scrollTo({top:frame.getBoundingClientRect().top+window.scrollY+e.data.top-90,behavior:"instant"});if(e.data?.type==="career-legacy-draft"){legacyDrafts.set(legacyKey,e.data.ui);document.dispatchEvent(new CustomEvent("career:draft"));}if(e.data?.type==="career-legacy-state"){legacyStates.set(legacyKey,e.data.state);document.dispatchEvent(new CustomEvent("career:draft"));}});
$("sync-outcomes").addEventListener("click",async()=>{const old=legacyStates.get(legacyKey);if(!old)return;const r=await mutate('/evidence/outcomes',{outcome_state:old},window.CareerI18n.msg('正在更新成果證據…'));if(r)note(window.CareerI18n.msg('成果自述已同步至證據檔案；原始 CV 保持不變。'));});
function render(){if(!state||!config)return;$("profile-onboarding").hidden=true;$("profile-workflow").hidden=false;document.dispatchEvent(new CustomEvent("career:state"));$("existing-cv").hidden=false;window.CareerI18n.text($("existing-cv"),window.CareerI18n.msg("目前 CV 已保留。只改偏好不重解析；替換 CV 會保留舊申請稿並標示過期。"));window.CareerI18n.text($("intake-help"),window.CareerI18n.msg("CV 與分析已保存至這個專案。更換 CV 後，舊結果會標示需要重新核對。"));renderProfile();renderJobs();renderApplications();renderVersions();renderPlans();renderLegacyHistory();}
window.CareerAPI.request("/api/career/config").then(c=>{config=c;window.CareerI18n.text($("search-notice"),c.search_configured?window.CareerI18n.msg("Techmap API key 已設定，連線尚未驗證。"):window.CareerI18n.msg("尚未設定 Techmap API key。仍可輸入職位 URL 或貼上 JD。"));for(const k of ["min","max","step"])$("salary")[k]=c.salary[k];$("salary").value=c.salary.default;salaryDisplay();if(window.CareerProjects)window.CareerProjects.boot();else go(window.CareerLayout.initialPage());}).catch(()=>{go("input");note(window.CareerI18n.msg("無法讀取啟動設定，請確認後端並重新整理。"),true);});
})();
