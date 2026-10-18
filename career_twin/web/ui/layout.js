/* Layout owns navigation chrome, responsive behavior and dialogs. No network calls. */
"use strict";
(() => {
 const $=id=>document.getElementById(id);
 const titles={"saved-jobs":window.CareerI18n.msg("已分析職位"),analysis:window.CareerI18n.msg("職位分析"),home:window.CareerI18n.msg("工作區總覽"),projects:window.CareerI18n.msg("所有專案"),overview:window.CareerI18n.msg("專案總覽"),history:window.CareerI18n.msg("進度與紀錄"),practice:window.CareerI18n.msg("一般語音練習"),product:window.CareerI18n.msg("產品介紹"),input:window.CareerI18n.msg("CV 與偏好"),profile:window.CareerI18n.msg("個人資料與優勢"),jobs:window.CareerI18n.msg("職位搜尋"),applications:window.CareerI18n.msg("申請材料"),roadmap:window.CareerI18n.msg("改善計劃"),planning:window.CareerI18n.msg("規劃下一步"),legacy:window.CareerI18n.msg("行動與成果"),interview:window.CareerI18n.msg("AI 模擬面試")};
 const mobile=matchMedia("(max-width: 800px)");
 let navigate, first=true;
 const sidebar=$("workspace-sidebar"), toggle=$("sidebar-toggle"), backdrop=$("sidebar-backdrop");
 function closeSidebar(){document.body.classList.remove("sidebar-open");backdrop.hidden=true;sidebar.inert=mobile.matches||document.body.classList.contains('interview-fullscreen-active');toggle.setAttribute("aria-expanded",String(!mobile.matches&&!document.body.classList.contains("sidebar-compact")));}
 function adapt(){if(mobile.matches)document.body.classList.remove("sidebar-compact");sidebar.inert=mobile.matches&&!document.body.classList.contains("sidebar-open");closeSidebar();}
 toggle.addEventListener("click",()=>{
  if(mobile.matches){const open=!document.body.classList.contains("sidebar-open");document.body.classList.toggle("sidebar-open",open);sidebar.inert=!open;backdrop.hidden=!open;toggle.setAttribute("aria-expanded",String(open));if(open)sidebar.querySelector("[data-page]").focus();}
  else{document.body.classList.toggle("sidebar-compact");toggle.setAttribute("aria-expanded",String(!document.body.classList.contains("sidebar-compact")));}
 });
 backdrop.addEventListener("click",()=>{closeSidebar();toggle.focus();});
 mobile.addEventListener("change",adapt);adapt();
 document.addEventListener('career:fullscreen',closeSidebar);
 document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&document.body.classList.contains("sidebar-open")){closeSidebar();toggle.focus();}
  if(event.key==="Tab"&&mobile.matches&&document.body.classList.contains("sidebar-open")){
   const nodes=[...sidebar.querySelectorAll("button:not([disabled]):not([hidden]),a[href]")].filter(n=>n.offsetParent!==null);
   const first=nodes[0],last=nodes.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 });
 document.querySelectorAll("[data-open-dialog]").forEach(button=>button.addEventListener("click",()=>{const dialog=$(button.dataset.openDialog);closeSidebar();dialog.showModal();}));
 document.querySelectorAll("[data-close-dialog]").forEach(button=>button.addEventListener("click",()=>button.closest("dialog").close()));
 document.querySelectorAll("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}}));
 const pilot=$("pilot-panel");
 $("open-settings").hidden=false;
 document.addEventListener("pilot:candidate",()=>{$("settings-badge").hidden=false;});
 $("open-settings").addEventListener("click",()=>{$("settings-badge").hidden=true;pilot.open=true;});
 document.addEventListener("career:state",()=>{
  const state=window.CareerWorkspace?.getState();
  window.CareerI18n.text($("workspace-status"),state?window.CareerI18n.msg("CV 已載入"):window.CareerI18n.msg("尚未載入 CV"));
  $("roadmap-empty").hidden=!!state?.plans?.length;
 });
 window.CareerLayout={
  initialPage(){const page=location.hash.slice(1);return titles[page]?page:(new URL(location.href).searchParams.has("project")?"overview":"product");},
  bind(callback){
   navigate=callback;
   document.addEventListener("click",event=>{
    const node=event.target.closest("button[data-page],a[data-page]");
    if(!node)return;
    event.preventDefault();
    if(document.body.dataset.page==='product'&&node.dataset.page==='home'&&window.CareerMotion){
     window.CareerMotion.leaveProduct(()=>navigate(node.dataset.page));
    }else navigate(node.dataset.page);
   });
   document.querySelectorAll('a[href="#workflow"],a[href="#possibilities"],a[href="#versions"]').forEach(node=>node.addEventListener("click",event=>{event.preventDefault();$(node.hash.slice(1)).scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});}));
   window.addEventListener("popstate",()=>{
    const page=location.hash.slice(1);
    const project=new URL(location.href).searchParams.get('project');
    if(project&&project!==window.CareerProjects?.id()){window.CareerProjects.activate(project,titles[page]?page:'overview');return;}
    if(titles[page])navigate(page);
    else if(page.startsWith("stage-")){navigate("profile");window.CareerWorkspaceUI?.openStage(page);}
    else navigate(window.CareerLayout.initialPage());
   });
  },
  navigate(page){navigate(page);},
  show(page){
   if(!titles[page])return;
   document.body.dataset.page=page;
   document.querySelectorAll(".view").forEach(node=>node.hidden=node.id!=="view-"+page);
   document.querySelectorAll("button[data-page],a[data-page]").forEach(node=>{
    const group=["jobs","saved-jobs","analysis","applications","roadmap","planning","legacy"].includes(page)?"analysis":["input","profile"].includes(page)?"profile":page==="history"?"overview":page==="practice"&&window.CareerProjects?.id()?"interview":page;
    const active=node.closest('#project-nav')?node.dataset.page===group:(node.dataset.page==="interview-entry"?"interview":node.dataset.page)===page || (node.dataset.page==="roadmap"&&["planning","legacy"].includes(page));
    node.classList.toggle("nav-active",active);if(active)node.setAttribute("aria-current","page");else node.removeAttribute("aria-current");
   });
   window.CareerI18n.text($("page-title"),titles[page]);window.CareerI18n.prop(document,"title",window.CareerI18n.join([titles[page]," · Finance Career"]));
   closeSidebar();
   if(location.hash!=="#"+page)history[first?"replaceState":"pushState"](null,"","#"+page);
   const heading=$("view-"+page)?.querySelector("h1");
   if(heading&&!first){heading.tabIndex=-1;heading.focus({preventScroll:true});}
   first=false;window.scrollTo({top:0,behavior:"instant"});
   document.dispatchEvent(new CustomEvent("career:view",{detail:{page}}));
  }
 };
})();

