/* Product areas compose existing controllers. Navigation never starts analysis. */
"use strict";
(() => {
 const $=id=>document.getElementById(id),i18n=window.CareerI18n,m=i18n.msg;
 const node=(tag,copy,cls)=>{const n=document.createElement(tag);if(copy!==undefined)i18n.text(n,copy);if(cls)n.className=cls;return n;};
 const button=(copy,action,primary=false)=>{const n=node('button',copy,primary?'button-primary':'button-secondary');n.type='button';n.onclick=action;return n;};
 const go=page=>window.CareerLayout.navigate(page),link=(copy,page,primary=false)=>button(copy,()=>go(page),primary);
 const jobPages=['jobs','saved-jobs','analysis','applications','roadmap','planning','legacy'];
 const status={met:m('符合已知最低要求'),not_met:m('未符合'),unknown:m('資料待確認')};
 const matchLabel=match=>match?.algorithm==='FCDT A_80_20'?m({high:'高度符合',medium:'中度符合',low:'不符合'}[match.band]||'尚未有可計算要求'):status[match?.status]||m('尚未完成資格比對。');
 let activeProject=null;

 function refresh(){
  const page=document.body.dataset.page,state=window.CareerWorkspace?.getState(),job=window.CareerWorkspace?.getTargetJob();
  $('job-area-shell').hidden=!jobPages.includes(page);
  $('cv-area-nav').hidden=!['profile','input'].includes(page);
  $('practice-project-hint').hidden=!window.CareerProjects?.id();
  $('basic-job-exploration').hidden=!!state;$('personalized-search').hidden=false;
  if(!state){i18n.text($('submit-job'),m('保存 JD 草稿並加入 CV'));}
  else if(!window.CareerWorkspace.snapshot().detailJobId)i18n.text($('submit-job'),m('分析這份 JD'));
  const match=[...(state?.matches||[]),...(state?.catalog_matches||[])].find(match=>match.job_id===job?.id);
  $('search-by-cv').disabled=!state?.extracted||document.body.getAttribute('aria-busy')==='true';
  i18n.text($('search-cv-help'),m(state?.extracted?'根據已確認的 CV 能力搜尋，再按職位要求及證據排序。':'請先加入 CV 並完成經歷整理，再使用 CV 搜尋。'));
  $('plan-target').disabled=!job?.normalized;
  const empty=$('roadmap-empty');if(empty){i18n.text(empty.querySelector('h2'),job?m('目前目標：{0}',[job.title]):m('還沒有職涯規劃'));i18n.text(empty.querySelector('p'),job?m('可查看此職位的資格缺口，或比較已有的行動。硬門檻衝突不能由短期練習補足。'):m('先選擇一個職位，完成資格比對後，即可按個別缺口產生規劃。'));empty.querySelector('button').hidden=!!job;}
  const hasGap=!!match&&window.CareerJobAnalysis.rows(job,state).some(row=>row.category==='required'&&row.status!=='met');
  $('planning-readiness').hidden=hasGap;
  i18n.text($('planning-readiness'),job?m('目前沒有需要規劃的明確或待確認必要條件。'):m('可先探索職位或直接貼上 JD。'));
  $('planning-form').querySelector('[type=submit]').disabled=!hasGap||document.body.getAttribute('aria-busy')==='true';
  if(!state&&!window.CareerWorkspace.hasManualSearch()){const config=window.CareerWorkspace.getConfig();i18n.text($('search-notice'),m(!config?'正在讀取搜尋設定…':config.search_configured?'尚未執行 Techmap 搜尋。':'尚未設定 Techmap API key。仍可輸入職位 URL 或貼上 JD。'));}
  if(page==='analysis'){
   window.CareerWorkspace.renderJobOverview();
   const card=window.CareerWorkspace?.renderAnalysis();
   if(card){const detail=node('details',undefined,'job-focus-detail');detail.append(node('summary',m('目前目標的詳細要求')),card);$('target-analysis').replaceChildren(detail);}
   else{const empty=node('section',undefined,'context-empty');empty.append(node('h2',m('從一份目標 JD 開始')),node('p',m('選擇已保存的職位，或直接貼上 JD。分析會保留在這個專案，不需重新搜尋。'),'muted'),link(m('探索職位／貼上 JD'),'jobs',true));if(!state)empty.append(link(m('加入 CV'),'input'));$('target-analysis').replaceChildren();}
  }
 }

 function overview(project){
  activeProject=project;
  const state=window.CareerWorkspace.getState(),job=window.CareerWorkspace.getTargetJob(),pending=(state?.items||[]).filter(i=>i.review==='pending').length;
  const questions=(state?.questions||[]).filter(q=>q.status==='pending').length;
  const educationOnly=state?.items.length&&state.items.every(i=>i.section==='education');
  const latest=state?.tailored.at(-1),match=[...(state?.matches||[]),...(state?.catalog_matches||[])].find(item=>item.job_id===job?.id);
  let title=m('先加入 CV，建立你的準備起點。'),copy=m('也可以直接探索職位，或開始通用面試練習。'),action=m('加入 CV'),page='input';
  if(state){
   if(!state.extracted){title=m('CV 已保存，準備整理。');copy=m('整理每段經歷的標題、貢獻與成果。');action=m('整理 CV');page='profile';}
   else if(pending){title=m('核對經歷，讓後續分析更準確。');copy=m('有 {0} 項資料等待你確認。',[pending]);action=m('核對個人資料');page='profile';}
   else if(!job){title=educationOnly?m('已加入學歷，其他資料尚未提供。'):m('經歷已就緒，找一個值得準備的方向。');copy=educationOnly?m('可先查看職位要求，或補充項目、技能與經歷。'):m('搜尋機會或帶入現有 JD，隨時開始。');action=m('探索職位');page='jobs';}
   else{title=m('圍繞目前目標，接續你的準備。');copy=i18n.join([job.title,' · ',matchLabel(match)]);action=latest?.job_id===job.id?m('練習面試'):job.normalized?m('準備申請'):m('查看職位分析');page=latest?.job_id===job.id?'interview':job.normalized?'applications':'analysis';}
  }
  const content=node('div');content.append(node('p',m('目前重點'),'eyebrow'),node('h2',title),node('p',copy,'muted'),link(action,page,true));
  const cv=node('div',undefined,'overview-cv-status');cv.append(node('strong',state?m('CV 已載入'):m('尚未載入 CV')),node('p',state?m('{0} 項來源自述 · {1} 項來源待核對 · {2} 題待補充',[state.items.filter(i=>i.review==='confirmed').length,pending,questions]):m('你可以稍後加入 CV。'),'hint'),link(state?m('查看個人資料'):m('先探索職位'),state?'profile':'jobs'));
  $('project-profile').replaceChildren(content,cv);
  const target=node('article',undefined,'overview-target');target.append(node('p',m('目前目標職位'),'eyebrow'),node('h3',job?.title||m('尚未選擇目標')),node('p',job?matchLabel(match):m('可先探索職位或直接貼上 JD。'),'muted'),link(job?m('查看職位分析'):m('探索職位'),job?'analysis':'jobs'));
  const application=node('article',undefined,'overview-application');application.append(node('p',m('最近申請材料'),'eyebrow'));
  if(latest){application.append(node('h3',latest.job_snapshot?.title||state.jobs.find(j=>j.id===latest.job_id)?.title||latest.job_id),node('p',latest.stale?m('資料已更新，請核對舊版內容。'):latest.status==='confirmed'?m('使用者已確認'):m('草稿，待確認'),'muted'),node('small',i18n.date(latest.created_at)),button(m('繼續這份申請'),()=>window.CareerWorkspace.openVersion(latest.id)));}
  else application.append(node('h3',m('還沒有申請版本')),node('p',m('已生成的 CV、求職信與編輯版本會保留在此。'),'muted'),link(m('準備申請'),'applications'));
  $('project-features').replaceChildren(target,application);
 }

 $('plan-target').onclick=()=>window.CareerWorkspace.planTarget();
 for(const event of ['career:view','career:state','career:target'])document.addEventListener(event,()=>queueMicrotask(refresh));
 document.addEventListener('career:target',()=>{if(activeProject?.id===window.CareerProjects.id())overview(activeProject);});
 document.querySelectorAll('.area-tabs').forEach(nav=>nav.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...nav.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].focus();}));
 window.CareerAreas={overview};
})();
