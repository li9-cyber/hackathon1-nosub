/* CV intake and one-pass extraction. State remains owned by CareerWorkspace. */
"use strict";
(() => {
let context;
const m=(text,args)=>window.CareerI18n.msg(text,args);
function bind(ctx){
 context=ctx;
 const {$,getState,getConfig,api,mutate,note,isBusy,setState,render,go}=ctx;
 let parsedFile=null;
 document.addEventListener('career:project-reset',()=>{parsedFile=null;});
 document.querySelectorAll('[name="cv-mode"]').forEach(n=>n.addEventListener('change',()=>{
  $('paste-label').hidden=n.value==='file';$('file-label').hidden=n.value!=='file';
 }));
 $('cv-file').addEventListener('change',()=>{parsedFile=null;});
 async function inputDocument(){
  const state=getState();
  if(document.querySelector('[name="cv-mode"]:checked').value==='file'){
   const file=$('cv-file').files[0];
   if(!file){if(state)return state.document;note(m('請選擇檔案或切換至貼上文字。'),true);return null;}
   if(file.size>getConfig().max_file_bytes){note(m('檔案超過 5 MB，請縮小或改貼文字。'),true);return null;}
   if(!parsedFile)parsedFile=await api('/parse?filename='+encodeURIComponent(file.name),file,m('正在解析 CV 檔案…'),true);
   return parsedFile;
  }
  const text=$('cv-text').value.replace(/\r\n?/g,'\n');
  if(!text.trim()){note(m('請貼上 CV 或選擇檔案。'),true);return null;}
  if(state?.document.text===text)return state.document;
  return {id:'cv_'+crypto.randomUUID(),text,format:'text'};
 }
 async function analyze(){
  if(isBusy()||!getState())return;
  await mutate('/extract',{},m('正在抽取 CV 經歷、技能與原文證據…'));
 }
 $('intake-form').addEventListener('submit',async event=>{
  event.preventDefault();if(isBusy()||!getConfig())return;
  const project=window.CareerProjects?.id(),doc=await inputDocument();
  if(!doc||project!==window.CareerProjects?.id())return;
  const state=getState(),config=getConfig(),preferences={minimum_salary:Number($('salary').value),
   currency:config.salary.currency,period:config.salary.period,target_role:$('target-role').value.trim()||null,
   job_type:$('preferred-job-type').value||null};
  let result;
  if(!state)result=await api('/start',{document:doc,preferences},m('正在保存 CV…'));
  else if(doc.id!==state.document.id)result=await api('/replace',ctx.payload({document:doc,preferences}),m('正在保存新的 CV…'));
  else result=await api('/preferences',ctx.payload({preferences}),m('正在更新偏好，不重新解析 CV…'));
  if(!result||project!==window.CareerProjects?.id())return;
  setState(result);render();go('profile');
  if(!result.extracted)await analyze();
 });
 $('extract-cv').addEventListener('click',analyze);
}
function statusText(state){
 const attempt=state.cv_extraction;
 if(!attempt)return null;
 const messages={idle:'CV 已保存，可以開始抽取。',running:'正在抽取 CV，完成後會自動顯示結果。',
  success:'CV 抽取成功。',failed:'CV 抽取失敗，原文及上次成功結果已保留。',timeout:'CV 抽取已超時，原文及上次成功結果已保留。'};
 const message=m(attempt.message||messages[attempt.status]);
 return attempt.processing_seconds===undefined?message:window.CareerI18n.join([message,' ',m('處理時間：{0} 秒',[attempt.processing_seconds])]);
}
function pending(state){return state?.cv_extraction?.status==='running'||state?.evidence_profile?.supplemental_evidence?.some(r=>r.analysis_status==='running');}
function recover(force=false,background=false){
 const ctx=context,state=ctx.getState();
 if(!state||ctx.isBusy()||(!force&&!pending(state)))return;
 const project=window.CareerProjects.id(),documentId=state.document.id,abort=new AbortController();
 const active=()=>!abort.signal.aborted&&project===window.CareerProjects.id()&&documentId===ctx.getState()?.document.id;
 if(!background)ctx.setBusy(true);
 async function poll(){
  try{
   const result=await window.CareerAPI.request('/api/career/extraction',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(5000)])});
   if(!active())return;
   if(result.revision>=ctx.getState().revision){ctx.setState(result);ctx.render();}
   if(pending(result)){timer=setTimeout(poll,1000);return;}
   ctx.note(statusText(result),['failed','timeout'].includes(result.cv_extraction.status));
  }catch(error){if(active())ctx.note(m('無法讀取抽取結果，請重新開啟專案查看。'),true);}
  if(active()&&!background)ctx.setBusy(false);
 }
 let timer;
 void poll();
 return ()=>{abort.abort();clearTimeout(timer);};
}
window.CareerCVExtraction={bind,statusText,recover};
})();
