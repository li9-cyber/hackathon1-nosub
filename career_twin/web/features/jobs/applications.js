/* One selected saved version; edits are scoped to project/version/material/paragraph. */
"use strict";
(() => {
let selected=null, material="cv", project=null, latest=null, lastArgs=null, feedbackVersion=null;
const m=(...a)=>window.CareerI18n.msg(...a);
function renderVersions(args){
 lastArgs=args;
 const {state,$,el,details,link,textarea,btn,mutate,note,download,interview,edits}=args;
 const scope=window.CareerProjects?.id()||state.id,versions=[...state.tailored].reverse();
 if(project!==scope){project=scope;selected=null;latest=null;}
 if(latest!==versions[0]?.id){latest=versions[0]?.id;selected=latest;}
 if(!versions.some(v=>v.id===selected))selected=latest;
 const root=$("versions");root.replaceChildren();
 if(!versions.length){root.append(el("p",m("選擇職位後，按上方任一功能開始。生成的 CV 和求職信會顯示在這裡。"),"empty-state"));return;}
 const selector=el("select"),label=el("label",m("查看材料版本"));selector.id="material-version";label.htmlFor=selector.id;
 for(const [n,v] of versions.entries())selector.append(window.CareerI18n.option(`${versions.length-n} · ${v.job_snapshot?.title||v.job_id} · ${v.created_at}`,v.id));
 selector.value=selected;selector.addEventListener("change",()=>{selected=selector.value;renderVersions(args);});root.append(label,selector);
 const v=versions.find(v=>v.id===selected),j=v.job_snapshot||state.jobs.find(j=>j.id===v.job_id),research=v.research_snapshot||state.research.find(r=>r.id===v.research_id);
 if(feedbackVersion!==v.id){window.CareerFeedback?.clearScope("material-actions");feedbackVersion=v.id;}
 const box=el("article",undefined,"panel version-card");box.dataset.versionId=v.id;root.append(box);
 box.append(el("h2",j?.title||v.job_id),el("p",m("版本 {0} · {1}",[versions.length-versions.indexOf(v),v.created_at]),"version-meta"));
 box.append(el("p",v.stale?m("資料已更新，這份舊稿僅供查看與下載。"):v.status==="confirmed"?m("已確認申請稿；引用為自述，未獨立驗證。"):m("已保存草稿；可下載不代表已確認可提交。"),"sample-note"));
 const saveState=el("p",undefined,"material-save-state");saveState.setAttribute("role","status");box.append(saveState);
 const review=v.final_review||v.review,issues=review?.issues||[],blockers=issues.filter(i=>i.type!=="style"&&(i.severity==="high"||i.needs_user)),optional=issues.filter(i=>!blockers.includes(i));
 const checks=el("details");checks.className="material-review";checks.id="material-review-list";
 checks.append(el("summary",m("事實／資格待處理 {0} 項 · 文風建議 {1} 項",[blockers.length,optional.length])));
 const blockingLink=btn(m("查看待處理項目（{0}）",[blockers.length]),()=>{checks.open=true;checks.scrollIntoView({block:"start"});});blockingLink.className="button-quiet";box.append(blockingLink,btn(m("前往保存與下載"),()=>toolbar.scrollIntoView({block:"center"})));
 const controls=[],panels={},tabBar=el("div",undefined,"toolbar left material-tabs");tabBar.setAttribute("role","tablist");
 if(!v.final[material]?.length)material=v.final.cv.length?"cv":"cover_letter";
 const show=key=>{material=key;for(const [k,panel] of Object.entries(panels))panel.hidden=k!==key;tabBar.querySelectorAll("button").forEach(b=>{b.setAttribute("aria-selected",String(b.dataset.material===key));b.tabIndex=b.dataset.material===key?0:-1;});};
 box.append(tabBar);
 for(const [key,title] of [["cv","CV"],["cover_letter",m("求職信")]]){
  if(!v.final[key].length)continue;
  const tab=btn(title,()=>show(key));tab.dataset.material=key;tab.setAttribute("role","tab");tab.id="material-tab-"+key;tab.setAttribute("aria-controls","material-panel-"+key);tabBar.append(tab);
  const panel=el("section",undefined,"material-body");panel.id="material-panel-"+key;panel.setAttribute("role","tabpanel");panel.setAttribute("aria-labelledby",tab.id);panels[key]=panel;
  for(const p of v.final[key]){
   const row=el("div",undefined,"draft-paragraph"),editKey=`draft:${scope}:${v.id}:${key}:${p.id}`,input=textarea(editKey,p.text,3);
   // Migrate only this exact old-version edit, never copy it into another version.
   const oldKey=`draft:${v.id}:${p.id}`;if(edits.has(oldKey)&&!edits.has(editKey)){input.value=edits.get(oldKey);edits.set(editKey,input.value);edits.delete(oldKey);}
   input.maxLength=2500;input.disabled=v.stale;input.id="paragraph-"+v.id+"-"+key+"-"+p.id;
   const l=el("label",p.section);l.htmlFor=input.id;row.append(l,input);controls.push({key,id:p.id,input,editKey,saved:p.text});
   const source=el("details");source.append(el("summary",m("查看來源與修改理由")),el("p",p.reason));
   for(const identity of p.item_ids){const item=(v.master_snapshot||state.items).find(i=>i.id===identity);if(item)source.append(el("h4",item.title),el("blockquote",item.text,"quote"));}
   for(const identity of p.requirement_ids){const req=j?.requirements.find(r=>r.id===identity);if(req)source.append(el("p",req.description),el("blockquote",req.quote,"quote"));}
   const before=v.initial[key].find(x=>x.id===p.id);if(before)source.append(details(m("初稿對照"),before.text));
   row.append(source);panel.append(row);
  }
  box.append(panel);
 }
 tabBar.addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const tabs=[...tabBar.children],i=tabs.indexOf(document.activeElement),target=e.key==="Home"?tabs[0]:e.key==="End"?tabs.at(-1):tabs[(i+(e.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length];show(target.dataset.material);target.focus();});
 show(material);
 const dirty=()=>controls.some(c=>c.input.value!==c.saved);
 const updateSave=()=>window.CareerI18n.text(saveState,dirty()?m("有未保存修改；預覽包含修改，下載仍是已保存版本。"):v.checks.final_review==="failed"?m("內容已保存；AI 審稿未完成，請重試審稿。"):m("正文與此版本已保存內容一致。"));
 controls.forEach(c=>c.input.addEventListener("input",updateSave));updateSave();
 const gather=()=>{const d=structuredClone(v.final);controls.forEach(c=>d[c.key].find(p=>p.id===c.id).text=c.input.value);return d;};
 const toolbar=el("div",undefined,"toolbar left material-actions");toolbar.dataset.feedbackScope="material-actions";
 async function save(confirm){
  const result=await mutate("/draft",{version_id:v.id,draft:gather(),confirm},m("正在保存內容並核對審稿狀態…"),()=>controls.forEach(c=>{edits.delete(c.editKey);edits.delete(`draft:${v.id}:${c.id}`);}));
  if(result){const saved=result.tailored.length===state.tailored.length?result.tailored.find(x=>x.id===v.id):result.tailored.at(-1);selected=saved.id;renderVersions({...args,state:result});const message=saved.checks.final_review==="failed"?m("已保存草稿；審稿失敗，內容保留，可重試。 "):saved.status==="confirmed"?m("已保存並確認這份申請稿。"):m("已保存草稿；請處理事實／資格核對後再確認。");window.CareerFeedback?.setScope("material-actions",message,saved.checks.final_review==="failed");}
 }
 if(!v.stale){const primary=btn(v.checks.final_review==="failed"?m("重試審稿"):m("保存編輯為新版本並審稿"),()=>save(false));primary.className="button-primary";toolbar.append(primary,btn(m("確認這份內容並保存"),()=>save(true)));}
 toolbar.append(btn(m("複製所選材料預覽"),async()=>{try{await navigator.clipboard.writeText(controls.filter(c=>c.key===material).map(c=>c.input.value).join("\n\n"));window.CareerFeedback?.setScope("material-actions",m("已複製目前預覽；未保存修改尚未進入下載版本。"));}catch{note(m("瀏覽器未允許剪貼簿，請手動選取文字。"),true);}}));
 for(const fmt of ["txt","html","json"])toolbar.append(btn(m("下載 {0}",[fmt.toUpperCase()]),()=>download(v.id,fmt,fmt==="json"?"all":material)));
 box.append(toolbar,el("p",m("TXT／HTML 下載所選材料的已保存正文；JSON 保留完整版本及初稿對照。"),"hint"));
 for(const [group,title] of [[blockers,m("完成確認前須處理")],[optional,m("可選文風與其他建議")]]){
  if(!group.length)continue;checks.append(el("h3",title));
  for(const issue of group){const control=controls.find(c=>c.id===issue.paragraph_id),p=[...v.final.cv,...v.final.cover_letter].find(p=>p.id===issue.paragraph_id),item=el("article",undefined,"review-issue "+(blockers.includes(issue)?"review-high":"review-low"));
   item.append(el("h4",p?.section||m("整份材料")),el("blockquote",p?.text||"","quote"),el("p",issue.explanation),el("p",issue.suggestion));
   const evidence=(v.master_snapshot||[]).filter(i=>issue.evidence_ids.includes(i.id));if(evidence.length)item.append(details(m("目前引用的主資料"),evidence.map(i=>i.title+"\n"+i.text).join("\n\n")));
   if(control)item.append(btn(m("修改這段文字"),()=>{show(control.key);control.input.focus();control.input.scrollIntoView({block:"center"});}));
   checks.append(item);
  }
 }
 box.append(checks);
 const supporting=el("details");supporting.append(el("summary",m("調整策略、來源及檢查紀錄")));v.final.strategy.forEach(s=>supporting.append(el("p",s)));if(research){supporting.append(el("p",research.note));research.facts.forEach(f=>{supporting.append(el("p",f.text),el("blockquote",f.quote,"quote"));const a=link(f.source_url);if(a)supporting.append(a);});}
 supporting.append(details(m("實際檢查狀態"),Object.entries(v.checks).map(([k,val])=>`${k}: ${val}`).join("\n")),details(m("版本資料"),`${v.id}\n${v.basis}\n${v.job_version}`));box.append(supporting);
 if(v.final.cv.length)box.append(btn(m("使用此 CV 進入面試頁"),()=>interview(v.job_id,v.id)));
}
window.CareerApplications={renderVersions,snapshot:()=>({project,selected,material,latest}),restore:view=>{if(view){({project,selected,material,latest}=view);}else{project=selected=latest=null;material="cv";}},selectVersion(id){selected=id;if(lastArgs)renderVersions(lastArgs);}};
})();
