/* Owner-level evidence, explicit project permissions. No browser persistence. */
"use strict";
(() => {
 const $=id=>document.getElementById(id),m=(key,args)=>CareerI18n.msg(key,args);
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)CareerI18n.text(n,text);if(cls)n.className=cls;return n;};
 const api=(path='',options={})=>CareerAPI.request('/api/career-memory'+path,options);
 let available=false,project=null,epoch=0,library=[],scope={items:[],version:''},timer=null;
 const drafts=new Map();
 const manager=el('section',undefined,'panel');manager.id='career-memory-manager';manager.hidden=true;
 const heading=el('h3',m('職涯記憶')),note=el('p',m('已確認資料可重用；每個專案由你選擇允許使用的內容。'),'hint'),status=el('p',undefined,'hint');status.setAttribute('role','status');
 const actions=el('div',undefined,'toolbar left'),cards=el('div');manager.append(heading,note,actions,status,cards);
 document.querySelector('#settings-dialog .dialog-content').prepend(manager);
 const modeLabel=el('label'),radio=el('input');radio.type='radio';radio.name='project-start';radio.value='memory';radio.dataset.layout='';modeLabel.hidden=true;
 const copy=el('span');copy.append(el('strong',m('使用職涯記憶')),el('small',m('引用已確認的經歷；更正後各專案使用最新版本。')));modeLabel.append(radio,copy);
 document.querySelector('.creation-options label').after(modeLabel);
 const preview=el('section');preview.id='project-memory-preview';preview.hidden=true;$('project-import').after(preview);
 const sourcePanel=el('section',undefined,'panel');sourcePanel.id='profile-career-memory';sourcePanel.hidden=true;$('stage-a').after(sourcePanel);
 function message(text,bad=false){CareerI18n.text(status,text);status.classList.toggle('error',bad);}
 function button(text,action){const b=el('button',m(text),'button-secondary');b.type='button';b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){message(e.message,true);}finally{b.disabled=false;}};return b;}
 function manage(){const dialog=$('settings-dialog');if(!dialog.open)dialog.showModal();manager.scrollIntoView({block:'start'});}
 function renderProject(){
  const state=window.CareerWorkspace?.getState();
  if(state?.career_memory_only){$('stage-a').hidden=true;$('extract-cv').hidden=true;CareerI18n.text($('profile-summary'),m('本專案使用已授權的職涯記憶。'));}
  else $('stage-a').hidden=false;
  const selected=scope.items.filter(r=>r.enabled&&r.status==='active');sourcePanel.hidden=!available||(!selected.length&&!state?.career_memory_only);
  sourcePanel.replaceChildren();if(sourcePanel.hidden)return;
  const details=el('details');details.append(el('summary',m('此專案可用的職涯記憶（{0}）',[selected.length])));
  for(const row of selected){const block=el('section',undefined,'profile-result');block.append(el('h4',row.title),el('pre',row.text,'cv-source-text'));details.append(block);}
  sourcePanel.append(details,button('管理職涯記憶',manage));
  if(state?.career_memory_notice)sourcePanel.append(el('p',state.career_memory_notice,'hint'));
 }
 async function refresh(){
  if(!available)return;
  const token=epoch,pid=project;
  const result=await api();
  const permissions=pid?await api('/projects/'+pid):{items:[],version:''};
  if(token!==epoch||pid!==project)return;
  library=result.items;scope=permissions;renderManager();renderProject();
  message(result.pending_sync?m('資料已保存；{0} 項記憶等待同步至語意索引。',[result.pending_sync]):m(result.mem0_enabled?'記憶已保存，語意索引已同步。':'記憶已保存；語意索引目前停用。'));
 }
 async function reloadProject(){
  if(project){await CareerProjects.activate(project,document.body.dataset.page||'profile');}
  else await refresh();
 }
 function renderManager(){
  cards.replaceChildren();
  if(!library.length)cards.append(el('p',m('尚無職涯記憶。整理 CV 或確認補充經歷後會自動保存。'),'hint'));
  for(const record of library){
   const detail=el('details',undefined,'profile-result');detail.dataset.memoryId=record.id;
   detail.append(el('summary',record.title),el('p',m('版本 {0}',[record.revision]),'hint'));
   const input=el('textarea');input.rows=4;input.maxLength=20000;input.value=drafts.get(record.id)||record.original_text;input.setAttribute('aria-label',m('記憶內容'));
   input.oninput=()=>drafts.set(record.id,input.value);detail.append(input);
   const controls=el('div',undefined,'toolbar left');
   if(record.status==='pending')controls.append(button('確認保存',async()=>{
    if(!input.value.trim())throw new Error(m('請填寫實際內容。'));await api('/'+record.id+'/confirm',{body:{expected_revision:record.revision,text:input.value}});drafts.delete(record.id);await reloadProject();
   }));
   else controls.append(button('保存更正',async()=>{
    if(!input.value.trim())throw new Error(m('請填寫實際內容。'));
    await CareerProjects.flush();await api('/'+record.id,{method:'PATCH',body:{expected_revision:record.revision,text:input.value}});
    drafts.delete(record.id);await reloadProject();
   }));
   controls.append(button(record.status==='pending'?'略過這項記憶':'刪除記憶',async()=>{
    await CareerProjects.flush();await api('/'+record.id,{method:'DELETE',body:{expected_revision:record.revision}});
    drafts.delete(record.id);await reloadProject();
   }));detail.append(controls);
   if(project&&record.status==='active'){
    const label=el('label',undefined,'check-label'),check=el('input');check.type='checkbox';check.dataset.memoryPermission=record.id;
    check.checked=scope.items.some(r=>r.id===record.id&&r.enabled);label.append(check,el('span',m('允許目前專案使用')));detail.append(label);
    check.onchange=async()=>{
     const selected=new Set(scope.items.filter(r=>r.enabled&&r.status==='active').map(r=>r.id));if(check.checked)selected.add(record.id);else selected.delete(record.id);
     check.disabled=true;try{await CareerProjects.flush();await api('/projects/'+project,{method:'PUT',body:{memory_ids:[...selected],expected_version:scope.version}});await reloadProject();}
     catch(e){check.checked=!check.checked;message(e.message,true);}finally{check.disabled=false;}
    };
   }
   cards.append(detail);
  }
 }
 actions.append(button('整理已保存資料',async()=>{await api('/backfill',{body:{}});await reloadProject();}),
  button('同步記憶',async()=>{await api('/sync',{body:{}});await refresh();}));
 window.CareerMemory={
  async boot(value){available=!!value;manager.hidden=modeLabel.hidden=!available;if(available){try{await refresh();}catch(e){message(e.message,true);}}},
  deactivate(){epoch++;project=null;scope={items:[],version:''};sourcePanel.hidden=true;},
  async activate(pid){project=pid;epoch++;if(available){try{await refresh();}catch(e){message(e.message,true);}}},
  showCreate(mode){preview.hidden=mode!=='memory';if(mode==='memory')this.prepareCreate();},
  async prepareCreate(){preview.replaceChildren(el('p',m('正在載入…')));try{
   const result=await api();const rows=result.items.filter(r=>r.status==='active');
   preview.replaceChildren(el('p',m('只引用勾選的資料，不複製原專案的對話或分析。'),'hint'));
   for(const row of rows){const label=el('label',undefined,'import-item'),input=el('input'),text=el('span');input.type='checkbox';input.value=row.id;input.dataset.careerMemorySelection='';input.dataset.layout='';text.append(el('strong',row.title),el('small',row.text));label.append(input,text);preview.append(label);}
   if(!rows.length)preview.append(el('p',m('目前沒有可引用的職涯記憶。可先整理 CV，或在設定中整理已保存資料。'),'hint'));
  }catch(e){preview.replaceChildren(el('p',e.message,'error'));}},
  selection(){return [...preview.querySelectorAll('input:checked')].map(n=>n.value);},
  async proposeVoice(text){if(!available||!project||!text)return;try{await api('/candidates',{body:{content:text.slice(0,1200)}});await refresh();}catch(e){message(e.message,true);}},
  changed(){if(available){clearTimeout(timer);timer=setTimeout(()=>refresh().catch(e=>message(e.message,true)),500);}},manage
 };
 document.addEventListener('career:profile-render',renderProject);
 document.addEventListener('career:state',()=>CareerMemory.changed());
 document.addEventListener('career:language',()=>{if(available){renderManager();renderProject();}});
})();
