/* Persistent feedback at the initiating form/action group, including after rerender. */
"use strict";
(() => {
 let active=null,project=null;const messages=new Map();
 const scopeFor=node=>node?.closest("[data-feedback-scope],form,.career-item,.job-card,.version-card,.view");
 const keyFor=node=>node?.dataset.feedbackScope||node?.id||node?.dataset.versionId||node?.dataset.jobId||node?.dataset.itemId||null;
 function restore(){
  const current=window.CareerProjects?.id()||"standalone";
  if(project!==current){project=current;messages.clear();active=null;}
  for(const [key,value] of messages){
   const n=[...document.querySelectorAll("[data-feedback-scope],form,.career-item,.job-card,.version-card,.view")].find(n=>keyFor(n)===key);if(!n)continue;
   let box=[...n.children].find(c=>c.classList.contains("action-feedback"));
   if(!box){box=document.createElement("p");box.className="action-feedback";box.setAttribute("role","status");box.setAttribute("aria-live","polite");n.append(box);}
   if(box._feedbackValue!==value){box._feedbackValue=value;if(window.CareerI18n)window.CareerI18n.text(box,value.text);else box.textContent=String(value.text);}
   box.classList.toggle("error",value.bad);box.hidden=!box.textContent;
  }
 }
 function capture(event){const n=scopeFor(event.target);const k=keyFor(n);if(k)active=k;}
 document.addEventListener("click",capture,true);document.addEventListener("submit",capture,true);
 window.CareerFeedback={clearScope(key){messages.delete(key);for(const n of document.querySelectorAll('[data-feedback-scope]'))if(keyFor(n)===key)for(const child of [...n.children])if(child.classList.contains('action-feedback'))child.remove();},set(text,bad=false){restore();if(active){messages.set(active,{text,bad});restore();}},setScope(key,text,bad=false){restore();active=key;messages.set(key,{text,bad});restore();},restore};
 new MutationObserver(restore).observe(document.documentElement,{childList:true,subtree:true});
})();
