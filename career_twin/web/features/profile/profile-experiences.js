/* Experience evidence: source offsets are supplied and validated by the backend. */
"use strict";
(() => {
const {validSpans,segments}=window.CareerEvidence;
function previewSkill(skillId){
 for(const card of document.querySelectorAll('.cv-evidence-card'))card.dispatchEvent(new CustomEvent('career:preview-skill',{detail:{skillId}}));
}
function card(item,entry,{state,el,btn,mutate,edits,current}){
 const m=window.CareerI18n.msg,article=el('article',undefined,'profile-result profile-experience cv-evidence-card');article.dataset.itemId=item.id;
 const header=el('header',undefined,'cv-experience-heading');header.append(el('h4',item.role||entry.title));
 const typeNames={internship:'實習',academic_project:'學術項目',part_time:'兼職',full_time:'全職',volunteer:'義工',campus_activity:'校園活動',unknown:'背景未明'};
 const metadata=[item.organization,item.date_range,item.experience_type!=='unknown'?m(typeNames[item.experience_type]):null].filter(Boolean);
 if(metadata.length)header.append(el('p',CareerI18n.join(metadata.flatMap((v,i)=>i?[' · ',v]:[v])),'profile-experience-context'));
 article.append(header);
 const columns=el('div',undefined,'cv-evidence-columns'),left=el('section',undefined,'cv-original-column'),right=el('section',undefined,'cv-capability-column');
 left.append(el('h5',m(item.origin==='user_supplied'?'既有補充來源':'原始 CV')));right.append(el('h5',m('已抽取能力')));
 const source=el('pre',undefined,'cv-source-text');source.id='cv-source-'+item.id;window.CareerI18n.attr(source,'aria-label',m('原始 CV'));left.append(source);
 const long=Array.from(item.text).length>600||item.text.split('\n').length>9;
 let expanded=!long,pinned=null;
 const panes=new Map([[item.source_id,{text:item.text,node:source}]]);
 for(const record of state.evidence_profile?.supplemental_evidence||[]){
  if(record.experience_id!==item.id||!record.clarification_id)continue;
  const section=el('section',undefined,'cv-answer-source'),node=el('pre',record.text,'cv-source-text');node.id='cv-answer-'+record.source_id;
  section.append(el('h5',m('你的補充答案')),el('p',m('使用者補充，非 CV 原文或第三方驗證。'),'hint'),node);left.append(section);panes.set(record.source_id,{text:record.text,node});
 }
 const tags=new Map(),profile=state.evidence_profile;
 const grounded=r=>{const pane=panes.get(r.source_id);return r.experience_id===item.id&&pane&&r.source_spans?.length&&validSpans(pane.text,r.source_spans).length===r.source_spans.length;};
 const records=window.CareerEvidence.skills(state,{experienceId:item.id,sourceTexts:new Map([...panes].map(([id,pane])=>[id,pane.text]))}),activities=(profile?.activities||state.activity_evidence||[]).filter(grounded);
 const identity=r=>r?.chip_id||r?.activity_id||r?.id||r?.skill_id;
 let toggle=null;
 function draw(record){
  for(const [sid,pane] of panes){
   pane.node.replaceChildren();
   const spans=record?(record.evidence_sources||[record]).filter(r=>r.source_id===sid).flatMap(r=>r.source_spans):[];
   for(const part of segments(pane.text,spans))pane.node.append(part.highlight?el('mark',part.text,record?'cv-evidence-highlight':'cv-evidence-available'):document.createTextNode(part.text));
  }
  for(const [id,button] of tags){button.classList.toggle('is-highlighted',id===identity(record));button.setAttribute('aria-pressed',String(id===identity(pinned)));}
 }
 if(records.some(r=>r.display!==false)){
  const guide=el('p',m('選擇技能，查看並鎖定對應原文。'),'cv-evidence-guide');
  guide.id='cv-evidence-guide-'+item.id;article.append(guide);source.setAttribute('aria-describedby',guide.id);
 }
 function expand(){expanded=true;source.classList.add('is-expanded');if(toggle){window.CareerI18n.text(toggle,m('收起原文'));toggle.setAttribute('aria-expanded','true');}}
 article.addEventListener('career:reveal-evidence',event=>{
  const citation=event.detail,pane=panes.get(citation.source_id);
  if(!pane||pane.text!==citation.text||!citation.source_spans?.length||validSpans(pane.text,citation.source_spans).length!==citation.source_spans.length)return;
  pinned={id:'job-source',source_id:citation.source_id,source_spans:citation.source_spans};expand();draw(pinned);
  pane.node.tabIndex=-1;pane.node.focus({preventScroll:true});pane.node.querySelector('mark')?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 });
 if(long){source.classList.add('is-collapsed');toggle=btn(m('展開完整原文'),()=>{expanded=!expanded;source.classList.toggle('is-expanded',expanded);window.CareerI18n.text(toggle,m(expanded?'收起原文':'展開完整原文'));toggle.setAttribute('aria-expanded',String(expanded));});toggle.className='button-quiet cv-source-toggle';toggle.setAttribute('aria-controls',source.id);toggle.setAttribute('aria-expanded','false');source.after(toggle);}
 function evidenceButton(record,label){
   const tag=btn(label,()=>{
    pinned=identity(pinned)===identity(record)?null:record;draw(pinned);
    if(pinned){expand();panes.get(record.source_id)?.node.querySelector('mark')?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
   });tag.className='cv-skill-tag evidence-'+record.evidence_type;
   tag.dataset.skillId=record.skill_id;tag.dataset.evidenceType=record.evidence_type;
   tag.dataset.sourceId=record.source_id;
   tag.setAttribute('aria-pressed','false');tag.setAttribute('aria-controls',[...new Set((record.evidence_sources||[record]).map(r=>panes.get(r.source_id)?.node.id).filter(Boolean))].join(' ')||source.id);
   tag.setAttribute('aria-label',label);
   function preview(scroll=false){previewSkill(record.skill_id);expand();if(scroll)panes.get(record.source_id)?.node.querySelector('mark')?.scrollIntoView({block:'nearest',behavior:'auto'});}
   tag.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')preview();});tag.addEventListener('pointerleave',()=>previewSkill(null));
   // Touch focus precedes click. Expanding/scrolling at that point moves the
   // button away from the finger and cancels the tap on a collapsed card.
   let pointerFocusing=false;
   tag.addEventListener('pointerdown',()=>{pointerFocusing=true;});
   // Mobile browsers synthesize focus after pointerup, before click.
   tag.addEventListener('click',()=>{pointerFocusing=false;});tag.addEventListener('pointercancel',()=>{pointerFocusing=false;});
   tag.addEventListener('focus',()=>{if(!pointerFocusing)preview(true);});tag.addEventListener('blur',()=>{pointerFocusing=false;previewSkill(null);});
   tag.addEventListener('keydown',()=>{pointerFocusing=false;});
   tag.addEventListener('keydown',event=>{if(event.key==='Escape'){pinned=null;previewSkill(null);event.preventDefault();}});
   tags.set(identity(record),tag);return tag;
 }
 const grouped=new Map();
 article.addEventListener('career:preview-skill',event=>{
  const record=event.detail.skillId?grouped.get(event.detail.skillId):pinned;
  draw(record||null);if(record)expand();
 });
 // One canonical chip, all independently grounded sources. Recent answer
 // evidence comes first so updates remain visible at the start of the rail.
 for(const record of records.filter(r=>r.display!==false).sort((a,b)=>Number(b.evidence_origin==='user_provided')-Number(a.evidence_origin==='user_provided'))){
  const key=record.skill_id;
  if(!grouped.has(key))grouped.set(key,{...record,chip_id:key,source_spans:[],activity_ids:[],evidence_sources:[]});
  const group=grouped.get(key);group.source_spans.push(...record.source_spans);group.activity_ids.push(...record.activity_ids||[]);
  group.evidence_sources.push({source_id:record.source_id,source_spans:record.source_spans});
  const scope=record.scope_evidence,pane=scope&&panes.get(scope.source_id);
  if(pane&&validSpans(pane.text,scope.source_spans).length===scope.source_spans.length)group.evidence_sources.push(scope);
  if(record.assessment==='partial')group.assessment='partial';
 }
 if(grouped.size){
  const shell=el('div',undefined,'cv-skill-scroll'),rail=el('div',undefined,'cv-skill-rail');rail.id='cv-skills-'+item.id;window.CareerI18n.attr(rail,'aria-label',m('已抽取能力'));rail.tabIndex=0;
  for(const record of grouped.values())rail.append(evidenceButton(record,record.canonical_name));
  const move=direction=>rail.scrollBy({left:direction*Math.max(160,rail.clientWidth*.7),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  const previous=btn('‹',()=>move(-1)),next=btn('›',()=>move(1));
  for(const [button,label] of [[previous,'向左查看技能'],[next,'向右查看技能']]){button.className='cv-skill-scroll-arrow';window.CareerI18n.attr(button,'aria-label',m(label));button.setAttribute('aria-controls',rail.id);}
  rail.addEventListener('keydown',event=>{if(event.target===rail&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}});
  shell.append(previous,rail,next);right.append(shell);
 }
 if(!activities.length){
  if(records.length&&item.section!=='skill'&&state.evidence_profile?.status==='legacy_needs_analysis')right.append(el('p',m('舊版技能證據已保留；請重新分析以建立活動證據。'),'hint cv-legacy-notice'));
 }
 const processing=state.evidence_profile?.analysis_status?.[item.id];
 const pending=processing?processing!=='complete':!item.capability_basis;
 const status=el('p',undefined,'hint cv-analysis-item'+(!grouped.size?' cv-skill-empty':''));status.dataset.pending=String(pending);status.dataset.empty=String(!grouped.size);
 right.prepend(status);updateStatus(status,window.CareerWorkspace?.isAnalyzingCV?.(),window.CareerWorkspace?.isReanalyzingAll?.());
 const context=el('section',undefined,'cv-skill-group cv-experience-context'),list=el('dl');context.append(el('h6',m('經驗背景')));
 const participation={assisted:'協助參與',contributed:'參與完成',led:'帶領',unknown:null};
 for(const [key,value] of [['經歷類型',item.experience_type!=='unknown'?m(typeNames[item.experience_type]):null],['參與程度',!activities.length&&participation[item.participation]?m(participation[item.participation]):null],['角色',item.role]])if(value)list.append(el('dt',m(key)),el('dd',value));
 if(!activities.length&&list.children.length){context.append(list);right.append(context);}
 if(state.cv_extraction){
  const facts=el('dl',undefined,'field-list profile-fields');
  for(const [key,value] of Object.entries(item.fields||{}))if(value)facts.append(el('dt',m(key)),el('dd',value));
  if(facts.children.length)right.append(facts);
  for(const record of state.evidence_profile?.supplemental_evidence||[]){
   if(record.experience_id!==item.id||!record.fields?.length)continue;
   const facts=el('section',undefined,'cv-supplement-fields');facts.append(el('h6',m('補充資訊')));
   for(const fields of record.fields){const list=el('dl',undefined,'field-list profile-fields');for(const [key,value] of Object.entries(fields))list.append(el('dt',m(key)),el('dd',value));facts.append(list);}right.append(facts);
  }
 }
 if((state.cv_extraction?['experience','project','skill','education','credential']:['experience','project']).includes(item.section)&&mutate)right.append(window.CareerProfileClarification.render(item,{state,el,btn,mutate,edits,current}));
 draw(null);columns.append(left,right);article.append(columns);return article;
}
function updateStatus(node,active,all=false){
 const pending=node.dataset.pending==='true',empty=node.dataset.empty==='true';active=active&&(pending||all);
 node.hidden=!active&&!pending&&!empty;node.classList.toggle('is-analyzing',!!active);
 window.CareerI18n.text(node,window.CareerI18n.msg(active?'能力分析中，原文已可先查看。':pending?'此項能力分析尚未完成；原文已保留，可重新分析。':empty?'分析已完成；目前沒有足夠的具體行為證據支持能力判斷。':''));
}
function updateProcessing(active,all=false){document.querySelectorAll('.cv-analysis-item').forEach(node=>updateStatus(node,active,all));}
function canReveal(citation){
 const article=[...document.querySelectorAll('.cv-evidence-card')].find(n=>n.dataset.itemId===citation.item_id);
 if(!article)return false;
 const source=[...article.querySelectorAll('.cv-source-text')].find(n=>n.textContent===citation.text);
 return !!(source&&citation.source_spans?.length&&validSpans(citation.text,citation.source_spans).length===citation.source_spans.length);
}
function reveal(citation){
 if(!canReveal(citation))return false;
 const article=[...document.querySelectorAll('.cv-evidence-card')].find(n=>n.dataset.itemId===citation.item_id);
 article.dispatchEvent(new CustomEvent('career:reveal-evidence',{detail:citation}));return true;
}
window.CareerProfileExperiences={card,segments,validSpans,reveal,canReveal,updateProcessing};
})();
