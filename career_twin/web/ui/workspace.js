/* Direct profile sections; qualification deep links remain available. */
"use strict";
(() => {
 const $=id=>document.getElementById(id),m=window.CareerI18n.msg;
 const catalog=$('profile-catalog'),catalogToggle=$('profile-catalog-toggle');
 function showCatalog(open){catalog.hidden=!open;catalogToggle.setAttribute('aria-expanded',String(open));}
 catalogToggle.addEventListener('click',()=>showCatalog(catalog.hidden));
 function update(){
  const state=window.CareerWorkspace?.getState();
  const count=state?.items?.filter(i=>i.review!=="excluded").length||0;
  window.CareerI18n.text($("profile-summary"),state?.extracted?m("已整理 {0} 項經歷與資料。",[count]):m("CV 已保存，整理後會在這裡顯示經歷與優勢。"));
 }
 window.CareerWorkspaceUI={openStage(stage){
  if(stage==='stage-d')showCatalog(true);
  const target=$(stage);if(!target||target.hidden)return false;
  const details=target.closest('details');if(details)details.open=true;
  target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'instant'});return true;
 }};
 document.addEventListener('career:profile-render',update);
 document.addEventListener('career:language',update);
 // Selecting or dropping a file only updates the native input. Submission stays explicit.
 const dropzone=$('file-label'),fileInput=$('cv-file'),fileStatus=$('cv-file-selection');
 const fileButton=$('cv-file-button');
 fileButton.addEventListener('click',()=>{if(!fileInput.disabled)fileInput.click();});
 let dragDepth=0;
 function fileSelection(){
  const file=fileInput.files[0];
  fileStatus.hidden=!file||dropzone.hidden;
  fileStatus.classList.remove('error');
  dropzone.classList.toggle('has-file',!!file);
  window.CareerI18n.text(fileButton,m(file?'更換檔案':'選擇檔案'));
  window.CareerI18n.text($('cv-drop-hint'),m(file?'檔案已就緒，保存後開始分析。':'或拖動檔案到此'));
  window.CareerI18n.text(fileStatus,file?m('已選擇：{0}',[file.name]):'');
 }
 function dropError(message){fileStatus.hidden=false;fileStatus.classList.add('error');window.CareerI18n.text(fileStatus,m(message));}
 const clearDrag=()=>{dragDepth=0;dropzone.classList.remove('is-dragging');};
 fileInput.addEventListener('change',fileSelection);
 document.querySelectorAll('[name="cv-mode"]').forEach(n=>n.addEventListener('change',()=>queueMicrotask(fileSelection)));
 document.addEventListener('career:state',fileSelection);
 dropzone.addEventListener('dragenter',event=>{event.preventDefault();if(!fileInput.disabled){dragDepth++;dropzone.classList.add('is-dragging');}});
 dropzone.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=fileInput.disabled?'none':'copy';});
 dropzone.addEventListener('dragleave',()=>{if(--dragDepth<=0)clearDrag();});
 dropzone.addEventListener('drop',event=>{
  event.preventDefault();event.stopPropagation();clearDrag();if(fileInput.disabled)return;
  const files=event.dataTransfer?.files;
  if(files?.length!==1||!/\.(pdf|docx|txt)$/i.test(files[0].name)){dropError('請一次選擇一個 PDF、DOCX 或 TXT 檔案。');return;}
  try{fileInput.files=files;fileInput.dispatchEvent(new Event('change',{bubbles:true}));}
  catch{dropError('此瀏覽器無法拖放檔案，請使用選擇檔案按鈕。');}
 });
})();
