/* Transport only. Controllers own cancellation, revisions and state. */
"use strict";
(() => {
const requests=new WeakMap();
window.CareerAPI=Object.freeze({
 bindOperation(signal,id){requests.set(signal,id);},
 async operation(projectId,signal){
  const response=await window.CareerFetch('/api/operations/status',{headers:{'X-Career-Project':projectId},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),cache:'no-store'});
  if(response.status===404)return null;
  if(!response.ok)throw new Error('operation_status_unavailable');
  return response.json();
 },
 async progress(signal){
  const id=signal&&requests.get(signal);if(!id||signal.aborted)return null;
  const response=await window.CareerFetch('/api/operations/status',{headers:{'X-Career-Request-ID':id},signal:AbortSignal.any([signal,AbortSignal.timeout(4000)]),cache:'no-store'});
  if(!response.ok)return null;
  return response.json();
 },
 async cancel(signal){
  let requestId=signal&&requests.get(signal);
  if(!requestId&&window.CareerProjects?.id()){
   const status=await window.CareerAPI.operation(window.CareerProjects.id(),new AbortController().signal);
   if(status&&!status.pending)return {pending:false};
   requestId=status?.operation?.request_id;
  }
  if(!requestId)return {pending:false,unsupported:true};
  for(let attempt=0;attempt<3;attempt++){
   const response=await window.CareerFetch('/api/operations/cancel',{method:'POST',headers:{'X-Career-Request-ID':requestId},signal:AbortSignal.timeout(10000)});
   if(response.status===404)return {pending:false,unsupported:true};
   if(!response.ok)throw new Error('cancel_unconfirmed');
   const result=await response.json();if(result.pending===false)return result;
  }
  throw new Error('cancel_unconfirmed');
 },
 async request(path,{body,method=body===undefined?"GET":"POST",signal,binary=false,responseType="json",headers={},cache,projectId=window.CareerProjects?.id()}={}){
  if(signal&&method==='POST'){
   const requestId=crypto.randomUUID();requests.set(signal,requestId);headers={...headers,'X-Career-Request-ID':requestId};
  }
  if(projectId&&/^\/api\/(career|pilot|career-memory)(\/|$)/.test(path))headers={...headers,"X-Career-Project":projectId};
  const response=await window.CareerFetch(path,{method,signal,cache,
   headers:body===undefined?headers:{"Content-Type":binary?"application/octet-stream":"application/json",...headers},
   body:body===undefined?undefined:binary?body:JSON.stringify(body)});
  if(responseType==="blob"&&response.ok)return response.blob();
  let data;
  try{data=await response.json();}catch{throw new Error(window.CareerI18n.msg("服務回應格式不正確，已有資料保留。"));}
  if(response.status===401&&data.error?.code==='login_required'){window.CareerAuth?.requestLogin();throw new Error(window.CareerI18n.msg('登入已到期，請重新登入後重試。'));}
  if(!response.ok){const error=new Error(data.error?.message||window.CareerI18n.msg("操作未完成，請重試。"));error.code=data.error?.code;error.status=response.status;error.retryAt=data.error?.retry_at||null;error.retryable=!error.retryAt&&(response.status===429||response.status>=500);window.dispatchEvent(new CustomEvent('career:api-error',{detail:{path,code:error.code,message:error.message,retryAt:error.retryAt}}));throw error;}
  return data;
 }
});
})();

