/* One editor for factual records; capability cards only navigate to their sources. */
"use strict";
(() => {
const KEY='profile-editor';
function render(ctx){
 const {state,config,$,el,btn,mutate,edits}=ctx,m=window.CareerI18n.msg;
 const editable=config.profile_editing_enabled===true;
 const host=$('profile-editor-host'),capHost=$('profile-capabilities');
 const draft=()=>edits.get(KEY),saveDraft=d=>{edits.set(KEY,d);window.CareerProjects?.schedule();};
 const active=()=>window.CareerWorkspace.getState()?.id===state.id;
 function open(item,section='project',skill=''){
  if(!editable)return;
  const d=draft();if(d?.dirty){message(m('尚有未儲存修改，請先儲存或取消編輯。'));host.scrollIntoView({block:'center'});return;}
  saveDraft({item_id:item?.id||null,item_revision:item?.revision||null,section:item?.section||section,
   title:item?.title||skill,text:item?.text||(section==='skill'?skill:''),fields:Object.fromEntries(Object.entries(item?.fields||{}).filter(([,value])=>value.trim()!==item.text.trim())),dirty:false,
   field:'text',instruction:'',supportSkill:skill,feedback:''});
  draw();host.scrollIntoView({block:'center'});host.querySelector('input')?.focus({preventScroll:true});
 }
 function message(text,error=false){const n=$('profile-editor-message');if(n){n.textContent=text;n.className=error?'profile-editor-message error':'profile-editor-message';}}
 async function analyze(result,id){
  if(!active()||!result)return;
  const item=result.items.find(i=>i.id===id&&i.review!=='excluded');if(!item||item.section==='personal')return;
  const updated=await mutate('/profile/analyze',{item_id:id,item_revision:item.revision},m('資料已保存，正在更新這項資料的能力與匹配…'));
  if(updated&&active())message(m(updated.normalization_notice?'資料已保存；分析失敗，可重試。':'已保存，能力與匹配已更新。'),!!updated.normalization_notice);
 }
 function clear(){edits.delete(KEY);draw();window.CareerProjects?.schedule();}
 function input(label,value,key,options={}){
  const box=el('label',m(label)),n=el(options.long?'textarea':'input');n.value=value||'';n.dataset.editorField=key;n.maxLength=options.max||4000;
  if(options.long)n.rows=options.rows||4;
  n.addEventListener('input',()=>{const d=draft();if(key.startsWith('fields.'))d.fields[key.slice(7)]=n.value;else d[key]=n.value;d.dirty=true;saveDraft(d);message(m('尚未儲存修改'));});box.append(n);return box;
 }
 function draw(){
  host.replaceChildren();if(!editable){host.hidden=true;return;}const d=draft();host.hidden=!d;if(!d)return;
  const form=el('form',undefined,'profile-editor panel');form.dataset.editingItem=d.item_id||'new';
  form.append(el('p',m('編輯個人經歷'),'eyebrow'),el('h3',m(d.item_id?'修改這項資料':'新增 Profile 資料')),
   el('p',m('你控制事實內容；AI 只整理能力及提出待確認的修改。'),'hint'));
  const status=el('p',m(d.feedback||(d.dirty?'尚未儲存修改':'已載入目前資料')),'profile-editor-message');status.id='profile-editor-message';status.setAttribute('role','status');form.append(status);
  if(!d.item_id){const label=el('label',m('資料類型')),select=el('select');select.dataset.editorField='section';for(const [key,name] of Object.entries(config.sections)){const o=el('option',m(name));o.value=key;o.selected=key===d.section;select.append(o);}select.onchange=()=>{d.section=select.value;d.dirty=true;saveDraft(d);};label.append(select);form.append(label);}
  form.append(input('標題',d.title,'title',{max:160}),input('經歷內容',d.text,'text',{long:true,rows:5}));
  const fields=el('div',undefined,'profile-edit-fields');
  for(const [key,value] of Object.entries(d.fields)){
   const row=el('div',undefined,'profile-field-row'),remove=btn(m('移除此欄位'),()=>{delete d.fields[key];d.dirty=true;saveDraft(d);draw();});remove.className='button-quiet';row.append(input(key,value,'fields.'+key,{long:true,rows:2}),remove);fields.append(row);
  }
  form.append(fields);
  const addFields=el('details',undefined,'profile-add-field');addFields.append(el('summary',m('新增日期、工具或成果欄位')));
  const newKey=el('input');newKey.placeholder=m('欄位名稱，例如工具');newKey.maxLength=160;newKey.setAttribute('aria-label',m('新欄位名稱'));
  addFields.append(newKey,btn(m('加入欄位'),()=>{const key=newKey.value.trim();if(!key||Object.keys(d.fields).length>=18||Object.hasOwn(d.fields,key))return;d.fields[key]='';d.dirty=true;saveDraft(d);draw();}));form.append(addFields);
  const actions=el('div',undefined,'toolbar left'),save=el('button',m('保存修正'),'button-primary');save.type='submit';
  actions.append(save,btn(m('取消編輯'),clear));form.append(actions);
  form.onsubmit=async event=>{event.preventDefault();if(!d.title.trim()||!d.text.trim()){message(m('請填寫標題和經歷內容。'),true);return;}
   const beforeIds=new Set(state.items.map(i=>i.id));
   const result=await mutate('/profile/edit',{item_id:d.item_id,item_revision:d.item_revision,section:d.section,title:d.title,text:d.text,fields:d.fields},m('正在保存修正…'),()=>edits.delete(KEY));
   if(!result||!active()){if(active())message(m('未能保存；你的修改仍保留。'),true);return;}
   const id=d.item_id||result.items.find(i=>!beforeIds.has(i.id))?.id;await analyze(result,id);
  };
  if(d.item_id){
   const ai=el('details',undefined,'profile-ai');ai.append(el('summary',m('AI 協助修改')));
   const label=el('label',m('只修改這個欄位')),target=el('select');target.dataset.aiField='true';
   const item=state.items.find(i=>i.id===d.item_id);
   for(const [key,name] of [['text','經歷內容'],['title','標題'],...Object.keys(item?.fields||{}).map(k=>['fields.'+k,k])]){const option=el('option',m(name));option.value=key;target.append(option);}target.value=d.field;target.onchange=()=>{d.field=target.value;saveDraft(d);};label.append(target);
   const instructions=el('label',m('你希望怎樣修改？')),area=el('textarea');area.rows=3;area.maxLength=1200;area.value=d.instruction;area.dataset.aiInstruction='true';area.oninput=()=>{d.instruction=area.value;saveDraft(d);};instructions.append(area);
   ai.append(label,instructions,btn(m('產生修改提案'),async()=>{
    if(d.dirty){message(m('請先儲存手動修改，再請 AI 提出建議。'),true);return;}
    if(!d.instruction.trim()){message(m('請描述你希望修改的內容。'),true);return;}
    const result=await mutate('/profile/propose',{item_id:d.item_id,item_revision:d.item_revision,field:d.field,instruction:d.instruction},m('AI 正在提出修改建議，正式資料保持不變…'));
    if(!result&&active())message(m('AI 提案失敗；正式資料與草稿均已保留。'),true);
   }));form.append(ai);
   const patches=state.profile_patches?.filter(p=>p.item_id===d.item_id&&p.status==='pending')||[];
   for(const patch of patches){
    const review=el('section',undefined,'profile-patch');review.dataset.patchId=patch.id;
    review.append(el('h4',m('AI 修改提案 · 尚未套用')),el('p',m('變更欄位：{0}',[m(patch.field==='text'?'經歷內容':patch.field==='title'?'標題':patch.field.slice(7))]),'hint'),el('p',patch.reason));
    if(patch.clarification){review.append(el('p',patch.clarification,'sample-note'));}
    else{
     const diff=el('div',undefined,'profile-diff');for(const [label,value,kind] of [['修改前',patch.expected_value,'before'],['修改後',patch.proposed_value,'after']]){const col=el('div',undefined,'diff-'+kind);col.append(el('strong',m(label)),el('pre',value));diff.append(col);}review.append(diff);
     review.append(el('p',m('可能影響的能力：{0}',[patch.affected_skills.join('、')||m('待重新分析')]),'hint'));
    }
    const buttons=el('div',undefined,'toolbar left');
    if(!patch.clarification)buttons.append(btn(m('確認修改'),async()=>{
     if(d.dirty){message(m('請先儲存或取消目前的手動修改。'),true);return;}
     const result=await mutate('/profile/decision',{patch_id:patch.id,operation:'accept',approved:true},m('正在套用已確認的修改…'),()=>edits.delete(KEY));await analyze(result,patch.item_id);
    }),btn(m('繼續手動調整'),async()=>{
     const result=await mutate('/profile/decision',{patch_id:patch.id,operation:'cancel'},m('正在轉為手動草稿…'));
     if(!result||!active())return;const item=result.items.find(i=>i.id===patch.item_id);
     const next={...d,item_revision:item.revision,fields:{...item.fields},title:item.title,text:item.text,dirty:true};
     if(patch.field.startsWith('fields.'))next.fields[patch.field.slice(7)]=patch.proposed_value;else next[patch.field]=patch.proposed_value;
     saveDraft(next);draw();
    }));
    if(!patch.clarification&&buttons.firstElementChild)buttons.firstElementChild.className='button-primary';
    buttons.append(btn(m('取消修改'),()=>mutate('/profile/decision',{patch_id:patch.id,operation:'cancel'},m('正在取消提案，正式資料保持不變…'))));review.append(buttons);form.append(review);
   }
   const more=el('details',undefined,'profile-edit-more');more.append(el('summary',m('來源與其他操作')));
   if(item){const original=state.sources.find(s=>s.id===state.document.id);if(item.quote&&original?.text.includes(item.quote))more.append(el('p',m('原始 CV 段落')),el('blockquote',item.quote,'quote'));more.append(el('p',m('原始檔案與來源文字會保留；資料未經第三方查證。'),'hint'));}
   more.append(btn(m('重新分析這項能力關聯'),()=>analyze(state,d.item_id)));
   const remove=el('details');remove.append(el('summary',m('移除這項資料')),el('p',m('移除後會更新能力與匹配，可在修改歷史還原。')),
    btn(m('確認移除'),()=>mutate('/profile/edit',{item_id:d.item_id,item_revision:d.item_revision,operation:'delete'},m('正在移除並更新能力與匹配…'),()=>edits.delete(KEY))));more.append(remove);form.append(more);
  }
  host.append(form);
 }
 const add=$('profile-add-record');add.hidden=!editable;add.onclick=editable?()=>open(null):null;
 const addSkill=$('profile-add-skill');addSkill.hidden=!editable;addSkill.onclick=editable?()=>open(null,'skill'):null;
 capHost.replaceChildren();
 const statusNames={evidence_supported:'經歷支持',self_reported:'自述能力',needs_review:'待確認'};
 for(const capability of state.capabilities||[]){
  const card=el('article',undefined,'capability-card');card.dataset.capability=capability.name;card.dataset.evidenceStatus=capability.status;
  const displayName={excel:'Excel',sql:'SQL',python:'Python','power bi':'Power BI','financial modelling':'Financial Modelling'}[capability.name]||capability.name;
  const heading=el('div',undefined,'capability-heading');heading.append(el('h3',displayName),el('span',m(statusNames[capability.status]),'chip evidence-'+capability.status));card.append(heading,el('p',m(capability.reason),'hint'));
  const details=el('details');details.append(el('summary',m(editable?'查看及補充來源':'查看來源')));
  const sources=capability.item_ids.map(id=>state.items.find(i=>i.id===id&&i.review!=='excluded')).filter(Boolean);
  for(const item of sources){const row=el('div',undefined,'capability-source');row.append(el('strong',item.title),el('p',item.text));
   for(const quote of [...new Set(state.claims.filter(c=>c.item_id===item.id&&capability.claim_ids.includes(c.id)).map(c=>c.quote))])if(quote!==item.text)row.append(el('blockquote',quote,'quote'));
   if(editable)row.append(btn(m('更正來源／AI 協助'),()=>open(item)));details.append(row);}
  if(editable&&capability.status!=='evidence_supported')details.append(el('p',m('你曾在哪項實習、課程或項目中使用 {0}？',[capability.name])));
  const existing=el('select');existing.setAttribute('aria-label',m('選擇支持經歷'));const placeholder=el('option',m('選擇既有經歷'));placeholder.value='';existing.append(placeholder);
  for(const item of state.items.filter(i=>i.review!=='excluded'&&['project','experience','education','credential'].includes(i.section))){const option=el('option',item.title);option.value=item.id;existing.append(option);}
  existing.onchange=()=>{const item=state.items.find(i=>i.id===existing.value);if(item)open(item,'project',capability.name);};
  if(editable)details.append(existing,el('p',m('選擇來源後，請補充實際使用方式；選取本身不會提升證據狀態。'),'hint'),btn(m('新增支持經歷'),()=>open(null,'project',capability.name)));card.append(details);capHost.append(card);
 }
 if(!capHost.children.length)capHost.append(el('p',m(editable?'保存經歷後會整理能力；也可以先新增自述能力。':'完成 CV 整理後，這裡會顯示能力及來源。'),'hint'));
 draw();return {open};
}
window.CareerProfileEditor={render};
})();
