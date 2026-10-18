/* Recover durable project operations. This module never starts AI work. */
"use strict";
(() => {
const stages={jd_role_classification_v11:'正在根據完整職責辨識職位類別',normalize_job:'正在分析職位要求',jd_evidence_matching_v11:'正在比對職位要求與 CV 證據',starting:'正在開始處理',memory_lookup:'正在查找相關職涯記憶',cv_structure:'正在拆解 CV 經歷與行為',normalize_profile:'正在判斷能力與標準化',clarify_question:'正在判斷是否需要補充',clarify_answer:'正在分析補充答案',source_validation:'正在驗證原文與證據位置',saving_profile:'正在保存分析結果'};
function describe(progress){
 const m=window.CareerI18n.msg;
 return window.CareerI18n.join([m(stages[progress?.stage]||'正在開始處理'),' · ',m('已等待 {0} 秒',[progress?.elapsed_seconds||0]),' · ',progress?.stage_limit_seconds?m('本步上限 {0} 秒；剩餘時間無法準確預估。',[progress.stage_limit_seconds]):m('剩餘時間無法準確預估。')]);
}
function watch(project,signal,{current,progress,load,complete,error}){
 let stopped=false,timer=null,observed=false;
 const active=()=>!stopped&&!signal.aborted&&current();
 async function poll(){
  if(!active())return;
  try{
   const result=await window.CareerAPI.operation(project,signal);if(!active())return;
   const operation=result?.operation;
   if(result?.pending&&operation){
    observed=true;window.CareerAPI.bindOperation(signal,operation.request_id);
    progress(result.progress,operation);timer=setTimeout(poll,3000);return;
   }
   if(operation||observed){
    const latest=await window.CareerAPI.request('/api/projects/'+project,{projectId:null,signal});
    if(!active())return;
    load(latest.state);
   }
   complete(operation,observed);
  }catch(cause){
   if(active()){error(cause);timer=setTimeout(poll,5000);}
  }
 }
 void poll();
 return ()=>{stopped=true;clearTimeout(timer);};
}
window.CareerOperations=Object.freeze({describe,watch});
})();
