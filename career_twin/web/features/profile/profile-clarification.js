/* One scoped question. Saving precedes AI, using the existing project API. */
"use strict";
(() => {
function supplementForm(item,{state,el,btn,mutate,edits,current}){
 const m=window.CareerI18n.msg,root=el('section',undefined,'cv-clarification');
 const key='supplement:'+state.document.id+':'+item.id;
 let draft=edits.get(key)||{};
 const records=(state.evidence_profile?.supplemental_evidence||[]).filter(r=>r.experience_id===item.id);
 // A persisted source clears a restored draft even if the response was lost.
 if(records.some(r=>r.submission_id===draft.submission_id)){edits.delete(key);draft={};}
 root.append(el('h5',m('補充資訊')));
 for(const record of records){
  const status=el('p',m(record.message||'補充原文已保存。'),'hint cv-supplement-status');
  status.dataset.status=record.analysis_status;root.append(status);
  if(['failed','timeout'].includes(record.analysis_status))root.append(btn(m('重試這段補充'),()=>mutate('/supplement',
   {item_id:item.id,text:record.text,submission_id:record.submission_id,retry:true},m('正在分析已保存的補充資訊…'))));
 }
 const form=el('form'),label=el('label',m('補充實際工作、工具使用或資格資料'),'cv-custom-label'),input=el('textarea');
 input.id='cv-supplement-'+item.id;input.rows=3;input.maxLength=4000;input.required=true;input.value=draft.text||'';label.htmlFor=input.id;
 const remember=()=>{edits.set(key,draft);document.dispatchEvent(new CustomEvent('career:draft'));};
 input.addEventListener('input',()=>{draft={text:input.value};remember();});
 const submit=el('button',m('保存並更新個人資料'),'button-primary');submit.type='submit';
 const status=el('p',undefined,'hint cv-clarification-status');status.setAttribute('role','status');
 form.append(label,input,submit,status);root.append(form);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!current()||!input.value.trim())return;
  draft={text:input.value,submission_id:draft.submission_id||crypto.randomUUID()};remember();
  submit.disabled=true;window.CareerI18n.text(status,m('正在保存補充資訊並更新相關技能…'));
  const result=await mutate('/supplement',{item_id:item.id,text:input.value,submission_id:draft.submission_id},m('正在保存補充資訊並更新相關技能…'),()=>{edits.delete(key);document.dispatchEvent(new CustomEvent('career:draft'));});
  if(!result&&current()){submit.disabled=false;window.CareerI18n.text(status,m('未能確認更新結果；輸入已保留，請重新開啟專案確認或重試。'));}
 });
 return root;
}
function render(item,{state,el,btn,mutate,edits,current}){
 if(state.cv_extraction)return supplementForm(item,{state,el,btn,mutate,edits,current});
 const m=window.CareerI18n.msg,root=el('section',undefined,'cv-clarification');root.id='clarification-'+item.id;
 const record=(state.clarifications||[]).find(q=>q.experience_id===item.id&&q.document_id===state.document.id&&q.source_id===item.source_id&&q.source_revision===item.revision);
 const key='clarification:'+state.document.id+':'+item.id,answer=record?.answers?.at(-1);
 let draft=edits.get(key)||{};
 // Server acknowledgement wins over a workspace draft captured just before
 // save completed. A different unsaved submission remains editable.
 const acknowledged=answer&&(draft.submission_id===answer.submission_id||
  (draft.editing&&(answer.mode==='custom'?draft.text===answer.text:!draft.text?.trim()&&draft.choice===answer.option_index)));
 if(acknowledged){edits.delete(key);draft={};}
 let editing=Boolean(draft.editing);
 function remember(value){draft={...draft,...value};edits.set(key,draft);document.dispatchEvent(new CustomEvent('career:draft'));}
 function message(text,bad=false){const n=document.getElementById(root.id)?.querySelector('.cv-clarification-status');if(n){window.CareerI18n.text(n,m(text));n.classList.toggle('is-error',bad);}}
 async function analyze(saved){
  if(!saved||!current())return;
  const q=saved.clarifications.find(q=>q.id===record.id),version=q?.answers.at(-1)?.version;if(!version)return;
  message('答案已保存，正在更新相關能力…');
  const result=await mutate('/clarifications/analyze',{clarification_id:record.id,answer_version:version},m('正在分析這段補充答案…'));
  if(!result&&current())message('答案已保存；能力分析未完成，可重試。',true);
 }
 function paint(){
  root.replaceChildren(el('h5',m('補充經歷')));
  const status=el('p',undefined,'hint cv-clarification-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  if(!record||record.status==='error'){
   root.append(el('p',m(record?'問題分析未完成，已有資料保留。':'AI 會在工作內容、負責範圍或工具用法不夠清楚時，請你補充。'),'hint'),btn(m('檢查是否需要補充'),async()=>{window.CareerI18n.text(status,m('正在閱讀這段經歷…'));await mutate('/clarifications/prepare',{item_id:item.id},m('正在閱讀這段經歷…'));}),status);return;
  }
  if(record.status==='no_question'){root.append(el('p',m('目前沒有需要補充的資訊。'),'hint'));return;}
  if(record.status==='skipped'){
   root.append(el('p',m('已略過，可隨時回來回答。'),'hint'),btn(m('重新打開問題'),()=>mutate('/clarifications/save',{clarification_id:record.id,operation:'reopen',expected_answer_version:0})));return;
  }
  const question=el('p',record.proposal.question,'cv-clarification-question');question.id=root.id+'-question';root.append(question);
  if(answer&&!editing){
   const labels={pending:'答案已保存；能力分析待完成。',complete:'答案已保存，相關能力資料已更新。',partial:'答案已保存；部分能力仍待判斷。',error:'答案已保存；能力分析未完成，可重試。'};
   const changes=answer.capability_changes;
   const changed=changes&&['added','updated','removed'].some(k=>changes[k]?.length);
   const summary=answer.state==='complete'?(changes?(changed?'答案已保存；能力更新如下。':'答案已保存；本次沒有新增或變更可支持的能力。'):'答案已保存；可重新分析以查看具體變更。'):labels[answer.state];
   window.CareerI18n.text(status,m(summary));
   root.append(el('p',m('補充答案位於左側獨立來源區。'),'hint'),status);
   if(changed){
    const list=el('ul',undefined,'cv-capability-changes');
    for(const [key,label] of [['added','新增能力：{0}'],['updated','已更新證據或工作範圍：{0}'],['removed','不再採用的能力：{0}']])if(changes[key]?.length)list.append(el('li',m(label,[changes[key].map(c=>c.canonical_name).join('、')])));
    root.append(list);
   }
   const controls=el('div',undefined,'cv-clarification-actions');
   controls.append(btn(m('修改補充答案'),()=>{editing=true;remember({editing:true,text:answer.mode==='custom'?answer.text:'',choice:answer.mode==='option'?answer.option_index:null,submission_id:null});paint();}));
   if(answer.state!=='complete'||!changes)controls.append(btn(m('重試能力分析'),()=>analyze(state)));
   root.append(controls);return;
  }
  const form=el('form'),choices=el('fieldset',undefined,'cv-clarification-options');choices.setAttribute('aria-labelledby',question.id);
  record.proposal.options.forEach((option,index)=>{
   const label=el('label',undefined,'cv-clarification-option'),radio=el('input');radio.type='radio';radio.name=root.id+'-choice';radio.value=String(index);radio.checked=draft.choice===index;
   radio.addEventListener('change',()=>remember({choice:index,submission_id:null}));label.append(radio,el('span',option));choices.append(label);
  });
  const customLabel=el('label',m('以上都不符合？請描述實際工作，也可填寫不確定或沒有做過。'),'cv-custom-label'),custom=el('textarea');
  custom.id=root.id+'-custom';custom.rows=3;custom.maxLength=4000;custom.value=draft.text||'';customLabel.htmlFor=custom.id;
  custom.addEventListener('input',()=>remember({text:custom.value,submission_id:null}));
  const controls=el('div',undefined,'cv-clarification-actions'),submit=el('button',m('確認並更新能力'),'button-primary');submit.type='submit';controls.append(submit);
  if(!answer)controls.append(btn(m('略過'),()=>mutate('/clarifications/save',{clarification_id:record.id,operation:'skip',expected_answer_version:0})));
  else controls.append(btn(m('取消修改'),()=>{editing=false;edits.delete(key);document.dispatchEvent(new CustomEvent('career:draft'));paint();}));
  form.append(choices,customLabel,custom,controls,status);root.append(form);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(!current())return;
   // A typed answer always takes precedence, even if a radio remains checked.
   const mode=custom.value.trim()?'custom':'option';
   if(mode==='option'&&!Number.isInteger(draft.choice)){message('請選擇一項或輸入自己的回答。',true);return;}
   const submission=draft.submission_id||crypto.randomUUID();remember({submission_id:submission});
   message('正在保存答案…');
   const result=await mutate('/clarifications/save',{clarification_id:record.id,expected_answer_version:answer?.version||0,
    submission_id:submission,mode,option_index:mode==='option'?draft.choice:null,text:mode==='custom'?custom.value:null},m('正在保存答案…'),()=>{edits.delete(key);document.dispatchEvent(new CustomEvent('career:draft'));});
   if(result&&current())await analyze(result);
   else if(current())message('尚未確認保存；輸入保留，請重試。',true);
  });
 }
 paint();return root;
}
window.CareerProfileClarification={render};
})();
