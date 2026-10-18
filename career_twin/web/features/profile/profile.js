/* CV presentation and contextual actions. State/transport are injected. */
"use strict";
(() => {
function structuredFields(items,{el,config}){
 const dl=el("dl",undefined,"field-list profile-fields"),values=new Map();
 for(const i of items){const sourceField=i.fields["已提供的技能與程度"]||i.fields["語言與程度"];const fields=Object.entries(sourceField?{[config.sections[i.section]||"內容"]:sourceField}:i.fields).filter(([,v])=>v&&v.trim());
 if(!fields.length)fields.push([config.sections[i.section],i.text]);
 for(const [key,value] of fields){if(!values.has(key))values.set(key,new Set());values.get(key).add(value);}}
 for(const [key,parts] of values)dl.append(el("dt",CareerI18n.msg(key)),el("dd",[...parts].join("\n")));
 return dl;
}

function render({state,config,$,el,btn,textarea,mutate,edits,profileProgress}) {
 const m=window.CareerI18n.msg,fields=items=>structuredFields(items,{el,config});
 const project=window.CareerProjects?.id(),doc=state.document;
 const current=()=>window.CareerProjects?.id()===project&&window.CareerWorkspace?.getState()?.document.id===doc.id;
 const editor=window.CareerProfileEditor.render({state,config,$,el,btn,mutate,edits});
 const unfinished=item=>['experience','project','skill'].includes(item.section)&&
  (state.evidence_profile?.analysis_status?.[item.id]?state.evidence_profile.analysis_status[item.id]!=='complete':!item.capability_basis);
 const pendingItems=state.items.filter(i=>i.review==='confirmed'&&unfinished(i));
 $('profile-capabilities').closest('.profile-capability-section').hidden=true;
 function editAction(card,items){
  if(!config.profile_editing_enabled)return;
  const actions=el('div',undefined,'toolbar left profile-edit');
  const seen=new Set();for(const item of items){const label=item.user_locked?'使用者補充／修正':item.origin==='ai_inferred'?'AI 推導 · 待確認':'CV 抽取';if(!seen.has(label)){actions.append(el('span',m(label),'chip'));seen.add(label);}actions.append(btn(items.length>1?m('編輯：{0}',[item.title]):m('編輯'),()=>editor.open(item)));}
  card.append(actions);
 }
 function results(){
  const sections=[],personal=[],supporting=[];
  for(const name of ['experience','project','education','credential','personal','skill','language']){
   const entries=state.standardized_cv?.entries.filter(i=>i.section===name&&i.source_item_ids.some(id=>state.items.some(item=>item.id===id&&item.review!=='excluded')))||[];if(!entries.length)continue;
   const section=el('section',undefined,'profile-result-section');section.dataset.profileSection=name;
   const support=['personal','skill','language'].includes(name);
   const heading=el('div',undefined,'profile-group-heading');heading.append(el('h3',m(config.sections[name])));
   if(!support)heading.append(el('span',String(entries.length),'profile-group-count'));
   section.append(heading);
   const grid=el('div',undefined,'profile-experience-grid');
   for(const entry of entries){
    const card=el('article',undefined,'profile-result profile-experience');card.dataset.itemId=entry.source_item_ids[0];
    const items=state.items.filter(i=>entry.source_item_ids.includes(i.id)&&i.review!=='excluded');
    if(['experience','project','skill'].includes(name)||(state.cv_extraction&&['education','credential'].includes(name))||items.some(item=>state.skill_evidence?.some(s=>s.experience_id===item.id))){for(const item of items)grid.append(window.CareerProfileExperiences.card(item,{...entry,title:name==='skill'?item.title:entry.title},{state,el,btn,mutate,edits,current}));continue;}

    const titleKeys={experience:['機構','公司','角色'],project:['項目','專案','作品'],education:['學校','學位'],credential:['證照','證書','機構']}[name];
    const namedTitle=titleKeys&&entry.title===config.sections[name]?[...new Set(titleKeys.map(key=>entry.fields[key]).filter(Boolean))].join(' · '):'';
    const title=namedTitle||entry.title;
    if(!support)card.append(el('h4',title));
    if(support){
     const info=fields([entry]);
     if(info.children.length===2&&[m(config.sections[name]),entry.title].includes(info.firstElementChild.textContent)){info.firstElementChild.hidden=true;info.classList.add('profile-fields-single');}
     card.append(info);
    }
    else {
     const all=Object.entries(entry.fields).filter(([,value])=>value?.trim());
     const context=/^(機構|公司|學校|角色|職位|日期|起訖日期|時長|經歷類型|項目|學位|主修|在讀狀態)$/;
     const normalizedTitle=title.toLocaleLowerCase().replace(/\s+/g,' ');
     const meta=all.filter(([key,value])=>context.test(key)&&!normalizedTitle.includes(value.toLocaleLowerCase().replace(/\s+/g,' '))),points=all.filter(([key])=>!context.test(key));
     if(meta.length)card.append(el('p',[...new Set(meta.map(([,value])=>value))].join(' · '),'profile-experience-context'));
     const list=el('ul',undefined,'profile-strength-list'),seen=new Set();
     for(const [key,value] of points){if(seen.has(value)||value===entry.title)continue;seen.add(value);const li=el('li');if(!['內容','description'].includes(key))li.append(el('span',m(key),'profile-strength-label'));li.append(el('span',value));list.append(li);}
     if(list.children.length)card.append(list);
    }
    if(entry.needs_confirmation)card.append(el('p',m(config.profile_editing_enabled?'這項資料仍有待釐清的內容，可補充或修改。':'這項資料仍有待釐清的內容，暫以待確認資料保留。'),'hint'));
    editAction(card,items);grid.append(card);
   }
   section.append(grid);if(name==='personal')personal.push(section);else if(support)supporting.push(section);else sections.push(section);
  }
  $('profile-personal').replaceChildren(...personal);$('profile-personal').hidden=!personal.length;
  $('profile-supporting').replaceChildren(...supporting);$('profile-supporting').hidden=!supporting.length;
  const supplements=(state.evidence_profile?.supplemental_evidence||[]).filter(r=>!r.clarification_id);
  if(supplements.length){
   const group=el('section',undefined,'profile-result-section');group.append(el('h3',m('新增成果證據')));
   for(const record of supplements){const detail=el('details',undefined,'profile-result');detail.append(el('summary',record.work_done||m('既有補充來源')),el('p',m('成果自述，非第三方驗證；不屬於原始 CV。'),'hint'),el('pre',record.text,'cv-source-text'));group.append(detail);}
   sections.push(group);
  }
  const update=state.evidence_updates?.at(-1);
  if(update){
   const group=el('section',undefined,'profile-result-section');group.append(el('h3',m('證據更新前後')));
   if(!update.changes?.length)group.append(el('p',m('已保存成果來源；目前 JD 相關性沒有變化。'),'hint'));
   const labels={directly_relevant:'直接相關',partially_relevant:'部分相關',no_supporting_evidence:'未找到支持證據'};
   for(const change of update.changes||[]){const detail=el('details',undefined,'profile-result');detail.append(el('summary',change.quote),el('p',m(labels[change.before])+' → '+m(labels[change.after])),el('p',m('相關不等於符合最低資格。'),'hint'));group.append(detail);}
   sections.push(group);
  }
  return sections;
 }
 async function downloadFile(){
  const button=$('download-profile-cv');button.disabled=true;
  try{
   const blob=project?await window.CareerAPI.request('/api/projects/'+encodeURIComponent(project)+'/cv?document_id='+encodeURIComponent(doc.id),{responseType:'blob'}):new Blob([doc.text],{type:'text/plain;charset=utf-8'});
   if(!current())return;
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=doc.file_name||'CV-text.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   window.CareerFeedback?.setScope('profile-file',m('下載已開始。'));
  }catch(e){if(current())window.CareerFeedback?.setScope('profile-file',e.message,true);}
  finally{if(button.isConnected)button.disabled=false;}
 }
 window.CareerI18n.text($('profile-file-name'),doc.file_name||m('CV 文字版'));
 window.CareerI18n.text($('profile-file-status'),doc.file_name?m('{0} · {1} KB · 原檔已保存在此專案',[doc.format.toUpperCase(),Math.max(1,Math.ceil(doc.file_size/1024))]):m('此份資料只有文字；可下載文字版，或重新上傳以保留原檔。'));
 const download=btn(m(doc.file_name?'下載原始 CV':'下載文字版'),downloadFile);download.id='download-profile-cv';
 const upload=btn(m('重新上傳'),()=>window.CareerLayout.navigate('input'));$('profile-file-actions').replaceChildren($('extract-cv'),download,upload);
 window.CareerI18n.text($('profile-status'),pendingItems.length?m('已顯示經歷原文；有 {0} 項能力分析待完成，可按「重新分析能力」重試。',[pendingItems.length]):state.extracted?'':m('CV 已保存，可按「重新分析能力」開始整理。'));$('profile-status').hidden=state.extracted&&!pendingItems.length;
 const needsCapabilityAnalysis=state.extracted&&(['legacy_needs_analysis','partial'].includes(state.evidence_profile?.status)||state.items.some(i=>i.review==='confirmed'&&i.section!=='personal'&&(!i.capability_basis||state.cv_skill_version!==config.skill_analysis_version)));
 $('extract-cv').hidden=false;window.CareerI18n.text($('extract-cv'),m('重新分析能力'));
 $('extract-cv').dataset.retryOnly=String(!!state.normalization_notice||needsCapabilityAnalysis);
 if(state.cv_extraction){
  window.CareerI18n.text($('profile-status'),window.CareerCVExtraction.statusText(state));$('profile-status').hidden=false;
  window.CareerI18n.text($('extract-cv'),m(state.extracted?'重新抽取 CV':'抽取 CV'));
  $('profile-status').dataset.extractionStatus=state.cv_extraction.status;
 }
 const notices=[state.normalization_notice,state.skill_analysis_notice].filter(Boolean);
 function noticeMessage(text){for(const template of ['已保留 {0} 項待判定能力；不作已支持能力顯示。','已保留 {0} 項待標準化或未通過證據驗證的候選能力，未列為已支持技能。']){const [before,after]=template.split('{0}');if(text.startsWith(before)&&text.endsWith(after)){const count=text.slice(before.length,-after.length);if(/^\d+$/.test(count))return m(template,[count]);}}return m(text);}
 const analysisNotice=CareerI18n.join(notices.flatMap((text,index)=>index?[' ',noticeMessage(text)]:[noticeMessage(text)]));window.CareerI18n.text($('normalization-notice'),analysisNotice);$('normalization-notice').hidden=!notices.length;
 $('profile-items').replaceChildren(...results());$('stage-b').hidden=!$('profile-items').children.length;
 if(config.cv_diagnostics_enabled&&state.cv_diagnostics?.document_id===state.document.id){
  // Development-only, page-memory trace. No console output or telemetry of CV data.
  window.CareerCVDiagnostics={...state.cv_diagnostics,frontend_received:{
   document_id:state.document.id,skill_evidence:structuredClone(state.skill_evidence||[]),activity_evidence:structuredClone(state.activity_evidence||[]),
   rendered:[...document.querySelectorAll('.cv-evidence-card')].map(card=>({experience_id:card.dataset.itemId,
    source_text:card.querySelector('.cv-source-text')?.textContent,skill_ids:[...card.querySelectorAll('[data-skill-id]')].map(tag=>tag.dataset.skillId)}))}};
 }else delete window.CareerCVDiagnostics;
 const relevant=(config.profile_editing_enabled?state.questions:[]).filter(q=>q.status!=='answered'&&(!q.item_id||state.items.some(i=>i.id===q.item_id&&i.review!=='excluded'))),pending=relevant.filter(q=>q.status==='pending').slice(0,3),skipped=relevant.filter(q=>q.status==='skipped');
 $('stage-c').hidden=!pending.length&&!skipped.length;$('profile-questions').hidden=$('stage-c').hidden;
 $('profile-questions').closest('.profile-secondary').hidden=$('stage-c').hidden;
 window.CareerI18n.text($('questions-link'),pending.length?m('補充關鍵資料（{0}）',[pending.length]):m('已略過的補充資料'));
 $('questions').replaceChildren(...pending.map(questionCard));$('skipped-questions').hidden=!skipped.length;
 $('skipped-question-list').replaceChildren(...skipped.map(q=>{const p=el('div',undefined,'skipped-question');p.append(el('p',q.text),btn(m('補充這項資料'),()=>p.replaceWith(questionCard(q))));return p;}));
 function questionCard(q){
  const card=el('article',undefined,'career-item profile-question'),key='answer:'+q.id,input=textarea(key,'',3),label=el('label',q.text);input.id='answer-'+q.id;label.htmlFor=input.id;if(q.context)card.append(el('h3',q.context));
  card.append(label,input);const actions=el('div',undefined,'toolbar left');actions.append(btn(m('保存補充並更新整理結果'),()=>mutate('/answer',{question_id:q.id,text:input.value},m('正在更新這項資料與整理結果…'),()=>edits.delete(key))),btn(m('暫時略過／無法提供'),()=>mutate('/answer',{question_id:q.id,skip:true})));card.append(actions);return card;
 }
 profileProgress();document.dispatchEvent(new CustomEvent('career:profile-render'));
}
window.CareerProfile={render,structuredFields};
document.addEventListener('career:state',()=>{if(window.CareerCVDiagnostics?.document_id!==window.CareerWorkspace?.getState()?.document.id)delete window.CareerCVDiagnostics;});
})();
