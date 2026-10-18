"use strict";
(() => {
const $ = id => document.getElementById(id);
let projectEpoch=0, pending=new Set();
let session=null, revision=0, serial=Promise.resolve(), lastCV=null;
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)window.CareerI18n.text(n,text);return n;};
const message=text=>{window.CareerI18n.text($('pilot-message'),text);};
function debug(value){window.CareerI18n.text($('pilot-debug'),JSON.stringify(value,null,2));}
function options(){return {skills:!!session&&$('pilot-skills').checked,memory:!!session&&$('pilot-memory').checked};}
async function api(path,body,method=body===undefined?'GET':'POST'){
  const token=projectEpoch,projectId=window.CareerProjects?.id(),controller=new AbortController();pending.add(controller);
  try{const result=await window.CareerAPI.request('/api/pilot'+path,{body,method,projectId,signal:controller.signal});if(token!==projectEpoch)throw new DOMException('Project changed','AbortError');return result;}finally{pending.delete(controller);}
}
function changed(){document.dispatchEvent(new CustomEvent('pilot:revoked'));}
function updateJobs(){
  const state=window.CareerWorkspace.getState();
  if(state?.document.id!==lastCV){if(lastCV)changed();lastCV=state?.document.id;}
  const selected=window.CareerWorkspace.getTargetJob()?.id||'';
  const jobs=[...(state?.jobs||[]),...(state?.catalog_jobs||[])];
  const empty=node('option',window.CareerI18n.msg("未選定 JD"));empty.value='';
  $('pilot-job').replaceChildren(empty,...jobs.map(j=>{const n=node('option',j.title);n.value=j.id;return n;}));
  $('pilot-job').value=jobs.some(j=>j.id===selected)?selected:'';
  window.CareerWorkspace.setOptions(options());
}
function sync(state=window.CareerWorkspace.getState()){
  if(!session||!state)return Promise.resolve(null);
  state.runtime_options=options();
  // The endpoint selects saved context; jobs and evidence already live in DB.
  const copy=structuredClone({id:state.id,revision:state.revision,document:state.document,interview_context:state.interview_context}),token=projectEpoch;
  serial=serial.catch(()=>{}).then(async()=>{
    if(token!==projectEpoch)return null;
    // CV/supplement transactions advance the same project revision. Refresh it
    // before selecting interview context; never submit a stale profile snapshot.
    const latest=await api('/snapshot');
    if(token!==projectEpoch)return null;
    revision=latest.revision;
    if(latest.state?.id!==copy.id||latest.state?.revision!==copy.revision){
      if(latest.state)window.CareerWorkspace.restore(latest.state);
      return latest;
    }
    const result=await api('/sync',{state:copy,expected_revision:revision});
    revision=result.revision;debug({...session,...result});return result;
  });
  return serial;
}
async function memories(){
  const result=await api('/memories');debug(result);
  message(window.CareerI18n.msg("{0} · {1}{2}",[result.memory_backend,result.fallback?window.CareerI18n.msg("關鍵字後備檢索"):window.CareerI18n.msg("Mem0 檢索"),result.pending_cleanup?window.CareerI18n.join([' · '+result.pending_cleanup,window.CareerI18n.msg(" 筆外部副本待清除")]):'']));
  $('pilot-memories').replaceChildren(...result.items.map(record=>{
    const card=node('article');card.className='panel';
    const title=node('p',window.CareerI18n.msg("{0} · {1} · {2}",[record.type,record.status==='pending'?window.CareerI18n.msg("待確認"):window.CareerI18n.msg("已確認的自述"),record.support_status]));
    const input=node('textarea');input.value=record.content;input.maxLength=1200;input.rows=3;window.CareerI18n.attr(input,'aria-label',window.CareerI18n.msg("記憶內容"));
    const provenance=node('small',window.CareerI18n.msg("來源：{0} / {1}",[record.source_id||window.CareerI18n.msg("候選補充"),record.source_revision||window.CareerI18n.msg("待確認")]));
    const buttons=node('div');buttons.className='toolbar left';
    const button=(label,fn)=>{const b=node('button',label);b.type='button';b.className='button-secondary';b.onclick=()=>run(fn,b);return b;};
    buttons.append(button(record.status==='pending'?window.CareerI18n.msg("確認這項自述"):window.CareerI18n.msg("保存更正"),async()=>{
      await api(`/memories/${record.id}/${record.status==='pending'?'confirm':'correct'}`,{content:input.value,expected_updated:record.updated_at});changed();await memories();
    }),button(record.status==='pending'?window.CareerI18n.msg("拒絕"):window.CareerI18n.msg("刪除"),async()=>{await api('/memories/'+record.id,undefined,'DELETE');changed();await memories();}));
    card.append(title,input,provenance,buttons);return card;
  }));
}
async function run(work,button){const token=projectEpoch;if(button)button.disabled=true;try{await work();}catch(e){if(token===projectEpoch&&e.name!=="AbortError")message(e.message);}finally{if(button&&token===projectEpoch)button.disabled=false;}}
async function refresh(){
  session=await api('/session');revision=session.revision;
  $('pilot-consent').checked=session.consent;
  $('pilot-skills').disabled=!session.skills_available;
  $('pilot-memory').disabled=!session.memory_available;
  $('pilot-consent').disabled=!session.memory_available;
  $('pilot-panel').hidden=false;$('pilot-interview').hidden=false;
  updateJobs();await memories();
}
function deactivate(){projectEpoch++;document.querySelectorAll('#pilot-panel button,#pilot-interview button').forEach(n=>n.disabled=false);pending.forEach(c=>c.abort());pending.clear();session=null;revision=0;serial=Promise.resolve();lastCV=null;changed();$('pilot-new').value='';window.CareerI18n.text($('pilot-message'),'');$('pilot-memories').replaceChildren();$('pilot-panel').hidden=true;$('pilot-interview').hidden=true;$('pilot-job').value='';$('pilot-mode').value='interview_interviewer';$('pilot-skills').checked=false;$('pilot-memory').checked=false;}
window.CareerPilot={deactivate,activate:async()=>{try{const opts=structuredClone(window.CareerWorkspace.getState()?.runtime_options||{});await refresh();if(opts){$('pilot-skills').checked=opts.skills;$('pilot-memory').checked=opts.memory;}await sync();}catch(e){if(e.name!=='AbortError')message(window.CareerI18n.msg("此專案的專業面試服務目前未啟用。"));}},options,sync,mode:()=>$('pilot-mode').value,debug,
  prepareVoice:async()=>{if(session){window.CareerWorkspace.selectJob($('pilot-job').value);await sync();}},
  voiceFact:text=>{window.CareerMemory?.proposeVoice(text);if(session&&options().memory&&text){$('pilot-new').value=text.slice(0,1200);message(window.CareerI18n.msg("本輪語音回答已放入補充欄；可編輯後建立待確認卡，不會自動保存為事實。"));}}
};
document.addEventListener('career:state',updateJobs);
document.addEventListener('career:interview',e=>{if(e.detail.visible)updateJobs();});
for(const id of ['pilot-skills','pilot-memory'])$(id).onchange=()=>run(async()=>{window.CareerWorkspace.setOptions(options());changed();await sync();});
$('pilot-job').onchange=()=>run(async()=>{window.CareerWorkspace.selectJob($('pilot-job').value);changed();await sync();});
$('pilot-mode').onchange=()=>document.dispatchEvent(new CustomEvent('pilot:mode'));
$('pilot-consent').onchange=()=>run(async()=>{
  const wanted=$('pilot-consent').checked;
  try{const result=await api('/consent',{persist:wanted});revision=result.revision;session.consent=result.consent;changed();await memories();}
  finally{$('pilot-consent').checked=session.consent;}
});
$('pilot-refresh').onclick=()=>run(refresh,$('pilot-refresh'));
$('pilot-restore').onclick=()=>run(async()=>{
  const saved=await api('/snapshot');
  if(!saved.state)throw new Error(window.CareerI18n.msg("目前沒有可還原的試點快照。"));
  revision=saved.revision;window.CareerWorkspace.restore(saved.state);changed();
  message(window.CareerI18n.msg("已還原精簡 CV／JD；申請稿、完整工作頁與對話不在此快照中。"));
},$('pilot-restore'));
$('pilot-cleanup').onclick=()=>run(async()=>{await api('/cleanup',{});await memories();},$('pilot-cleanup'));
$('pilot-clear').onclick=()=>run(async()=>{
  const result=await api('/memories',undefined,'DELETE');revision=result.revision;changed();await memories();
},$('pilot-clear'));
$('pilot-add').onclick=()=>run(async()=>{await api('/memories/candidate',{content:$('pilot-new').value,type:$('pilot-type').value});$('pilot-new').value='';await memories();},$('pilot-add'));
if(!window.CareerProjects)refresh().catch(()=>{});
$('pilot-restore').hidden=!!window.CareerProjects;
})();
