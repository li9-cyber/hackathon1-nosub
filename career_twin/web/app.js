"use strict";
(() => {
 const $=id=>document.getElementById(id),uid=p=>p+"_"+crypto.randomUUID(),num=v=>v.trim()===""?null:Number(v);
 const EXAMPLE={cv:"我用 Excel 整理 200 筆模擬銷售資料，製作樞紐分析表及兩張圖表。\n我與四人團隊分析上市公司，個人貢獻需要補充。\n曾任學會活動義工，協助登記及整理問卷。",jd:"使用 Excel 整理及核對金融資料。\n使用 SQL 擷取資料，並以 Python 進行基本分析。\n以英文撰寫簡短分析摘要。",
 actions:[{name:"SQL 金融資料練習作品",description:"虛構自主練習：用模擬交易資料寫 SQL 查詢，核對結果並保留摘要。",hours:12,cost_hkd:0,availability:"可以"},{name:"財務報表工作坊",description:"虛構工作坊：小組討論財務報表，個人作品安排待確認。",hours:6,cost_hkd:300,availability:"未知"},{name:"英文摘要專案",description:"虛構自主專案：整理模擬金融資料及英文摘要。",hours:20,cost_hkd:null,availability:"可以"}]};
 const labels={pending:"待核對／待確認",confirmed:"已核對",excluded:"已排除",draft:"草稿",selected:"已選擇",in_progress:"進行中",partial:"部分完成",completed:"已完成"};
 let current=null,generation=0,controller=null,busy=false,busyControls=[],chatId="",reanswerId="",planId="",actionsDirty=true,jdDirty=false,limitsDirty=false;
 const latest=e=>e.versions.at(-1),source=id=>current.sources.find(s=>s.id===id),exp=id=>current.experiences.find(e=>e.id===id);
 function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(cls)n.className=cls;return n;}
 function button(text,fn,secondary=true){const b=el("button",text,secondary?"button-secondary":"");b.type="button";b.addEventListener("click",fn);return b;}
 function list(parent,title,items){parent.append(el("h4",title));const ul=el("ul");items.forEach(x=>ul.append(el("li",x)));parent.append(ul);}
 function quote(parent,text,label){parent.append(el("p",label,"source-label"),el("blockquote",text,"quote"));}
 function notice(t=""){$("notice").textContent=t;$("notice").hidden=!t;window.CareerFeedback?.set(t);}
 function error(t=""){$("error").textContent=t;$("error").hidden=!t;window.CareerFeedback?.set(t,true);}
 function setBusy(value){busy=value;document.body.setAttribute("aria-busy",String(value));$("cancel-request").hidden=!value;
 if(value){busyControls=[...document.querySelectorAll("button,input,textarea,select")].filter(n=>!n.hasAttribute("data-keep-enabled")).map(n=>[n,n.disabled]);busyControls.forEach(([n])=>n.disabled=true);}
 else{busyControls.forEach(([n,disabled])=>n.disabled=disabled);busyControls=[];}}
 function cancelRequest(){generation++;controller?.abort();controller=null;setBusy(false);}
 async function request(path,payload,message,onSuccess){
 if(busy)return;const requestGeneration=++generation,revision=current?.revision;controller=new AbortController();error();notice(message);setBusy(true);
 try{const response=await window.CareerFetch(path,{method:"POST",headers:{"Content-Type":"application/json",...(new URL(location.href).searchParams.get("project")?{"X-Career-Project":new URL(location.href).searchParams.get("project")}:{})},body:JSON.stringify(payload),signal:controller.signal});
 let result;try{result=await response.json();}catch{throw new Error("服務回應格式不正確；草稿與最後成功結果仍保留。");}
 if(!response.ok)throw new Error(result.error?.message||"請求未完成；草稿仍保留。");
 if(requestGeneration !== generation || current?.revision!==revision)return;
 setBusy(false);onSuccess(result);
 }catch(e){if(requestGeneration !== generation || e.name==="AbortError")return;notice();error(e instanceof TypeError?"無法連接後端；草稿仍保留。":e.message);}
 finally{if(requestGeneration===generation){setBusy(false);controller=null;}}}
 function mutate(path,data,message,after,profile=true){if(!current)return;request(path,{state:current,expected_revision:current.revision,...data},message,s=>{current=s;if(after)after(s);render(profile);notice(parent!==window?"已套用行動工作區資料，正在保存至目前專案；成果仍需明確同步才加入主資料。":"已套用；獨立頁面資料只保留在本頁。");publishDraft();});}
 function badge(s){return el("span",s,"status status-"+({"已有材料支持":"supported","支持有限":"limited","未找到證據":"missing"}[s]||"missing"));}
 function amount(v,suffix=""){return v===null?"待確認":new Intl.NumberFormat("zh-HK",{maximumFractionDigits:2}).format(v)+suffix;}
 function openDraft(){return Boolean(document.querySelector(".experience-editor:not([hidden])"));}
 function allowComparison(){return current?.analysis&&!current.analysis_stale&&!jdDirty&&!limitsDirty&&!openDraft();}
 function updateButtons(){$("match-button").disabled=openDraft()||!current.experiences.some(e=>latest(e).review!=="pending");$("compare-button").disabled=!allowComparison();document.querySelectorAll(".select-action").forEach(b=>b.disabled=!allowComparison()||actionsDirty||current.comparison_stale);}
 function fields(v){return {title:v.title,work:v.work,contribution:v.contribution,materials:v.materials,capabilities:v.capabilities};}
 function renderProfile(){
 $("profile-count").textContent=current.experiences.length+" 項經歷／成果";
 $("experience-cards").replaceChildren(...current.experiences.map(e=>{
 const v=latest(e),original=source(e.original_source_id),active=source(v.source_id),card=el("article",null,"evidence-card");card.dataset.experienceId=e.id;
 card.append(badge(labels[v.review]),el("h3",v.title),el("p","版本 "+v.version+" · "+(v.nature==="ai_interpretation"?"整理描述：AI 推斷":v.nature==="student_revision"?"整理描述：學生修正自述":"整理描述：學生自述"),"small"));
 const sourceDetails=el("details");sourceDetails.append(el("summary","查看原文來源"));card.append(sourceDetails);
 quote(sourceDetails,original.text,original.kind==="chat_fact"?"面試練習中的學生補充自述・原回答（未核實）":original.kind==="outcome"?"最初成果自述／材料摘錄（未獨立核實）":"CV 逐字原文・學生自述");
 if(original.kind==="chat_fact")card.append(el("p","對話 "+original.conversation_id+" ／回答 "+original.answer_id,"small"));
 if(active.id!==original.id)quote(sourceDetails,active.text,"目前有效修正／成果版本；不是原始引用");
 list(card,"整理內容",["做了甚麼："+(v.work||"待補充"),"個人負責："+(v.contribution||"此來源未另列個人分工，可查看原文核對"),"成果／材料："+(v.materials||"待補充")]);card.append(el("p","可能相關能力（僅假設）："+(v.capabilities.join("、")||"待釐清"),"small"));
 const toolbar=el("div",null,"toolbar"),review=value=>mutate("/api/profile/review",{experience_id:e.id,expected_version:v.version,review:value},"正在保存核對狀態…");
 toolbar.append(button("確認這項自述",()=>review("confirmed")),button(v.review==="excluded"?"恢復為待核對":"排除／撤回這項",()=>review(v.review==="excluded"?"pending":"excluded")));
 const linkedOutcome=current.outcomes.find(o=>o.experience_id===e.id),isOutcome=Boolean(linkedOutcome),editor=el("form",null,"experience-editor");editor.hidden=true;
 if(linkedOutcome&&latest(linkedOutcome).withdrawn){toolbar.querySelectorAll("button").forEach(b=>b.disabled=true);card.append(el("p","這份成果已撤回；若要恢復，請使用修改成果，核對後取消撤回。","hint"));}
 if(!isOutcome){const controls={};for(const [key,label] of [["title","標題"],["work","學生做了甚麼"],["contribution","個人負責部分"],["materials","成果／材料（沒有可留空）"]]){
 const l=el("label",label),input=el(key==="title"?"input":"textarea");input.value=v[key];input.maxLength=key==="title"?160:4000;input.required=key==="title";l.append(input);editor.append(l);controls[key]=input;}
 editor.append(el("p","保存後是學生修正自述；原文與舊版本保留。能力標籤只是推斷。","hint"));const save=el("button","保存修正並核對");save.type="submit";
 editor.append(save,button("取消編輯",()=>{editor.hidden=true;updateButtons();}));
 editor.addEventListener("submit",event=>{event.preventDefault();mutate("/api/profile/review",{experience_id:e.id,expected_version:v.version,review:"confirmed",fields:{...fields(v),...Object.fromEntries(Object.entries(controls).map(([k,n])=>[k,n.value.trim()]))}},"正在保存這項修正…");});
 toolbar.append(button("修改這項",()=>{editor.hidden=false;updateButtons();controls.work.focus();}));
 }else toolbar.append(button("修改成果",()=>{const o=current.outcomes.find(o=>o.experience_id===e.id);$("outcome-editor").value=o.id;loadOutcome();$("update-section").scrollIntoView();}));
 // Interview now lives in the main workspace as a title-only placeholder.
 card.append(toolbar,editor);
 if(e.versions.length>1){const d=el("details");d.append(el("summary","查看 "+(e.versions.length-1)+" 個舊版本（不作目前支持）"));e.versions.slice(0,-1).forEach(old=>quote(d,source(old.source_id).text,"v"+old.version+" · "+labels[old.review]));card.append(d);}return card;}));}
 function evidenceCard(req){const a=current.analysis.assessments.find(a=>a.requirement_id===req.id),card=el("article",null,"evidence-card");card.append(badge(a.status),el("h3",req.description));quote(card,req.jd_quote,"JD 原文");
 a.evidence_ids.forEach(id=>{const ev=current.analysis.evidence.find(e=>e.id===id),s=source(ev.source_id),e=current.experiences.find(e=>e.versions.some(v=>v.source_id===s.id));card.append(el("h4",ev.description));quote(card,ev.quote,(e?latest(e).title+" · ":"")+s.kind+"・自述／材料未獨立核實");});
 if(!a.evidence_ids.length&&a.status!=="不要求")card.append(el("p","目前未找到可引用材料，不等於沒有能力。"));card.append(el("p",a.reason,"reason"));return card;}
 function renderEvidence(){
 $("analysis-status").textContent=jdDirty?"JD 草稿尚未套用；仍顯示最後成功版本，請對照或取消草稿。":!current.analysis?"尚未對照 JD。先核對要使用的經歷；JD 可稍後補。":current.analysis_stale?"對照已過期：來源／JD 已改變，以下舊結果僅供查看，不能用來確認新計畫。":"對照版本 "+current.analysis_version+" · 使用已核對、未排除來源。";
 const groups=[];if(current.analysis)for(const [status,title] of [["明確不符","必要門檻明確不符"],["不要求","不要求的條件（不計缺口）"],["已有材料支持","目前有材料支持的優勢"],["支持有限","支持有限，仍需補充"],["未找到證據","尚未找到證據的要求"]]){
 const section=el("section");section.append(el("h3",title));const ids=new Set(current.analysis.assessments.filter(a=>a.status===status).map(a=>a.requirement_id)),reqs=current.analysis.requirements.filter(r=>ids.has(r.id)),grid=el("div",null,"evidence-grid");grid.append(...reqs.map(evidenceCard));section.append(reqs.length?grid:el("p","目前無此類要求。","hint"));groups.push(section);}
 $("analysis-groups").replaceChildren(...groups);}
 function readActions(){return [...$("action-editors").children].map(card=>{const get=k=>card.querySelector('[data-field="'+k+'"]').value,a={id:card.dataset.actionId,name:get("name").trim(),description:get("description").trim(),hours:num(get("hours")),cost_hkd:num(get("cost_hkd")),availability:get("availability")},old=current?.action_archive.find(x=>x.id===a.id);
 if(old&&JSON.stringify(old)!==JSON.stringify(a))a.id=uid("action");return a;});}
 function refreshActionControls(){const n=$("action-editors").children.length;$("add-action").disabled=n>=3;document.querySelectorAll(".remove-action").forEach(b=>b.disabled=n<=2);}
 function addAction(a={}){const n=$("action-template").content.firstElementChild.cloneNode(true);n.dataset.actionId=a.id||uid("action");n.querySelector("h3").textContent="候選行動";n.querySelectorAll("[data-field]").forEach(input=>input.value=a[input.dataset.field]??(input.dataset.field==="availability"?"未知":""));
 n.addEventListener("input",()=>{actionsDirty=true;if(current)renderComparisons();});n.querySelector(".remove-action").addEventListener("click",()=>{if($("action-editors").children.length>2){n.remove();actionsDirty=true;refreshActionControls();if(current)renderComparisons();}});$("action-editors").append(n);refreshActionControls();}
 function fillActions(actions){$("action-editors").replaceChildren();actions.forEach(addAction);refreshActionControls();}
 function renderComparisons(){$("comparison-status").textContent=!current.comparisons.length?"尚未比較；請先完成 JD 對照。":current.comparison_stale||actionsDirty?"比較已過期或候選草稿已修改；舊卡片僅供查看，請重新比較。":"有效比較，保持輸入順序；沒有排名。";
 $("comparisons").replaceChildren(...current.comparisons.map(c=>{const a=current.actions.find(a=>a.id===c.action_id),card=el("article",null,"comparison-card");card.append(el("h3",a.name),el("p",c.completed?"自述已完成；不代表能力已證實":"預期證據機會","small"),el("p","時間："+amount(c.hours," 小時")+" · "+c.time_limit),el("p","成本："+amount(c.cost_hkd," HKD")+" · "+c.budget_limit),el("p","參加狀態："+c.availability));
 list(card,"可能對應缺口",c.gap_requirement_ids.map(id=>current.analysis.requirements.find(r=>r.id===id)?.description||id));card.append(el("p",c.expected_outcome));list(card,"成立條件",c.conditions);list(card,"不確定性",c.uncertainties);list(card,"取捨",c.tradeoffs);list(card,"應保留材料",c.materials);
 const blocked=c.availability==="不可以"||c.time_limit==="超出限制"||c.budget_limit==="超出限制";if(blocked)card.append(el("p","不可直接確認：先修正限制或另選。","limit-warning"));const b=button(blocked?"查看／保存受限計畫草稿":"選擇並核對計畫",()=>selectAction(a,c),false);b.classList.add("select-action");card.append(b);return card;}));updateButtons();}
 function selectAction(a,c){if(!allowComparison()||actionsDirty||current.comparison_stale)return;mutate("/api/plan",{action_id:a.id,reason:"",start_step:c.start_step,materials:c.materials,operation:"draft"},"正在保存計畫初稿（不呼叫 AI）…",s=>{planId=s.plans.at(-1).id;loadPlan();requestAnimationFrame(()=>locate("choice-section"));},false);}
 function planBlocked(p){const a=p.action,c=current.constraints;return a.availability==="不可以"||(a.hours!==null&&c.hours!==null&&a.hours>c.hours)||(a.cost_hkd!==null&&c.budget_hkd!==null&&a.cost_hkd>c.budget_hkd);}
 function loadPlan(){const p=current.plans.find(p=>p.id===planId);$("choice-section").hidden=!p;if(!p)return;$("plan-draft-label").textContent=p.action.name+" · "+(p.status==="confirmed"?"已確認計畫":labels[p.status]);$("choice-reason").value=p.reason;$("plan-step").value=p.start_step;$("plan-materials").value=p.materials.join("\n");const invalid=planBlocked(p)||p.basis!==current.comparison_basis||current.comparison_stale;$("plan-form").querySelector('[type="submit"]').disabled=invalid;
 if(invalid)$("plan-draft-label").textContent+=" · 不可確認：條件超限／不可參加，或依據已過期；請調整後從最新卡片重新選擇。";
 $("choice-section").scrollIntoView({block:"center"});}
 function savePlan(operation){const p=current.plans.find(p=>p.id===planId);if(!p)return;if(!allowComparison()||actionsDirty){error("請先套用或取消相關草稿，並重新比較。");return;}if(operation==="confirm"&&planBlocked(p)){error("此行動不可參加或超出限制，不能確認為可執行計畫。");return;}if(!$("plan-form").reportValidity())return;
 mutate("/api/plan",{action_id:p.action.id,plan_id:p.id,reason:$("choice-reason").value.trim(),start_step:$("plan-step").value.trim(),materials:$("plan-materials").value.split("\n").map(x=>x.trim()).filter(Boolean),operation},"正在驗證並保存計畫…",s=>{if(s.plans.find(p=>p.id===planId).status==="confirmed"){$("choice-section").hidden=true;planId="";}else loadPlan();},false);}
 function renderPlans(){$("plan-list").replaceChildren(...current.plans.map(p=>{const card=el("article",null,"evidence-card");card.append(el("h4",p.action.name),el("p",(p.status==="confirmed"?"已確認計畫":labels[p.status])+" · 自述進度："+labels[p.progress]),el("p",p.reason||"未填選擇原因"),el("p","開始："+p.start_step));list(card,"打算提交",p.materials);
 if(p.status!=="confirmed")card.append(button("查看／修改草稿",()=>{planId=p.id;loadPlan();}));else{const label=el("label","更新自述進度（不改能力證據）"),select=el("select");["selected","in_progress","partial","completed"].forEach(value=>{const o=el("option",labels[value]);o.value=value;select.append(o);});select.value=p.progress;label.append(select);card.append(label,button("保存進度",()=>mutate("/api/plan/progress",{plan_id:p.id,progress:select.value},"正在保存自述進度…",null,false)));}return card;}));}
 function selectOptions(node,options,selected=node.value){node.replaceChildren(...options.map(([value,text])=>{const o=el("option",text);o.value=value;return o;}));node.value=options.some(([v])=>v===selected)?selected:options[0]?.[0]||"";}
 function renderOutcomeOptions(){selectOptions($("outcome-editor"),[["","新增／補充其他既有成果"],...current.outcomes.map(o=>[o.id,latest(o).work_done.slice(0,45)+" · v"+o.versions.length])]);selectOptions($("outcome-plan"),[["","其他既有成果（不屬計畫）"],...current.plans.filter(p=>p.status==="confirmed").map(p=>[p.id,p.action.name+" · "+labels[p.progress]])]);$("outcome-list").replaceChildren(...current.outcomes.map(o=>el("p",latest(o).work_done+" · "+labels[latest(o).progress]+(latest(o).withdrawn?" · 已撤回":"")+" · "+o.versions.length+" 個版本（保留原計畫引用）","hint")));}
 function loadOutcome(){const o=current.outcomes.find(x=>x.id===$("outcome-editor").value),v=o?latest(o):null;$("work-done").value=v?.work_done||"";$("contribution").value=v?.contribution||"";$("materials-excerpt").value=v?.materials_excerpt||"";$("outcome-plan").value=v?.plan_id||"";$("outcome-plan").disabled=Boolean(o);$("outcome-progress").value=v?.progress||"partial";$("outcome-withdrawn").checked=v?.withdrawn||false;}
 function renderChanges(){const snap=current.last_change;$("changes-section").hidden=!snap;if(!snap)return;$("changes-context").textContent=snap.comparison_reason+(current.analysis_stale?" 此比較屬最後成功分析，目前來源已變更。":"");$("changes").replaceChildren(...snap.changes.map(c=>{const card=el("article",null,"change-card"),req=snap.after.requirements.find(r=>r.id===c.requirement_id);card.append(el("h4",req.description+" · "+(c.changed?"有變更":"未改變")));const columns=el("div",null,"change-statuses");for(const [label,analysis,ids,status] of [["更新前",snap.before,c.before_evidence_ids,c.before_status],["更新後",snap.after,c.after_evidence_ids,c.after_status]]){const column=el("div");column.append(el("p",label),badge(status));ids.forEach(id=>quote(column,analysis.evidence.find(e=>e.id===id).quote,"引用"));if(!ids.length)column.append(el("p","沒有相關引用"));columns.append(column);}card.append(columns,el("p",c.reason));return card;}));}
 function startChat(id){mutate("/api/chat",{operation:"start",experience_id:id},"正在依這段 CV 出一題…",s=>{chatId=s.conversations.at(-1).id;$("chat-experience").value=id;reanswerId="";$("chat-answer").value="";$("chat-section").scrollIntoView();},false);}
 function renderChat(){
 const entries=current.experiences.filter(e=>source(e.original_source_id).kind==="cv_excerpt"&&latest(e).review!=="excluded");selectOptions($("chat-experience"),entries.map(e=>[e.id,latest(e).title]));$("start-chat").disabled=!entries.length;
 selectOptions($("chat-history"),[["","選擇本頁練習紀錄"],...current.conversations.map((c,i)=>[c.id,"練習 "+(i+1)+" · "+latest(exp(c.experience_id)).title+" · v"+c.experience_version])],chatId);
 const conv=current.conversations.find(c=>c.id===chatId);$("chat-content").hidden=!conv;if(!conv)return;
 const stale=latest(exp(conv.experience_id)).version!==conv.experience_version||latest(exp(conv.experience_id)).review==="excluded";
 $("chat-version").textContent="經歷 v"+conv.experience_version+" · "+conv.turns.length+"/8 題 · "+(stale?"舊版本只供查看；請從目前經歷開始新練習。":"此對話的回答／回饋不改動證據。");$("chat-original").textContent=source(conv.original_source_id).text;
 $("chat-turns").replaceChildren(...conv.turns.map(t=>{const card=el("article",null,"chat-turn"+(t.superseded?" superseded":""));card.append(el("h4","第 "+t.number+" 題"+(t.superseded?"（已被重答分支取代）":"")),el("p",t.question.question));t.answers.forEach((a,i)=>quote(card,a.text,"學生回答 "+(i+1)+(i<t.answers.length-1?"（舊回答）":"")));
 if(t.answers.length&&!t.superseded){const b=button("重新回答第 "+t.number+" 題",()=>{reanswerId=t.id;$("chat-answer").value=t.answers.at(-1).text;renderChat();$("chat-answer").focus();});b.disabled=stale||t.answers.length>=3;card.append(b);}return card;}));
 const target=reanswerId?conv.turns.find(t=>t.id===reanswerId):conv.turns.find(t=>!t.superseded&&!t.answers.length);$("chat-form").hidden=stale||!target||(!reanswerId&&conv.ended);$("answer-label").textContent=reanswerId?"重新回答原題："+target?.question.question:"回答目前問題："+(target?.question.question||"");$("cancel-reanswer").hidden=!reanswerId;
 const activeIds=conv.turns.filter(t=>!t.superseded&&t.answers.length).map(t=>t.answers.at(-1).id);$("chat-feedback").disabled=stale||!activeIds.length||JSON.stringify(conv.feedback.at(-1)?.answer_ids)===JSON.stringify(activeIds);$("chat-limit").textContent=conv.turns.length>=8?"已達八題上限；可查看回饋、重答原題（不再新增題目）或開始新練習。":"每段最多八題，每題最多三次回答。切換經歷會建立獨立對話。";
 $("feedback-list").replaceChildren(...conv.feedback.map((f,i)=>{const box=el("section");list(box,"回饋 "+(i+1)+"（不是能力評分）",f.feedback);return box;}));
 $("fact-cards").replaceChildren(...conv.facts.map(f=>{const card=el("article",null,"evidence-card");card.append(el("h4","待確認補充・"+({pending:"待處理",accepted:"已加入待核對檔案",rejected:"已拒絕",obsolete:"舊回答已過期"}[f.status])));quote(card,f.quote,"學生原回答；未獨立核實");const label=el("label","準備加入的自述內容"),input=el("textarea");input.value=f.text;input.maxLength=1200;input.disabled=f.status!=="pending"||stale;label.append(input);card.append(label);
 if(f.status==="pending"){const accept=button("接受／修改後加入待核對",()=>mutate("/api/chat/fact",{conversation_id:conv.id,fact_id:f.id,operation:"accept",edited_text:input.value!==f.text?input.value:null},"正在驗證回答引用並加入待核對項目…"));accept.disabled=stale;card.append(accept,button("拒絕這項補充",()=>mutate("/api/chat/fact",{conversation_id:conv.id,fact_id:f.id,operation:"reject"},"正在記錄拒絕…",null,false)));}return card;}));}
 function render(profile=true){$("input-view").hidden=Boolean(current);$("workspace").hidden=!current;if(!current)return;if(profile)renderProfile();if(!jdDirty)$("jd-review").value=current.jd_source_id?source(current.jd_source_id).text:"";if(!limitsDirty){$("current-hours").value=current.constraints.hours??"";$("current-budget").value=current.constraints.budget_hkd??"";}renderEvidence();renderComparisons();renderPlans();renderOutcomeOptions();renderChanges();updateButtons();if(parent!==window)parent.postMessage({type:"career-legacy-state",state:current},location.origin);}
 $("analyze-form").addEventListener("submit",e=>{e.preventDefault();request("/api/analyze",{cv:$("cv").value.trim(),jd:$("jd").value.trim()||null,constraints:{hours:num($("hours").value),budget_hkd:num($("budget").value)}},"正在整理整份 CV，尚未進行職位判斷…",s=>{current=s;render();notice("請逐項確認、修正或排除；JD 與練習均可稍後進行。");});});
 $("fill-example").addEventListener("click",()=>{$("cv").value=EXAMPLE.cv;$("jd").value=EXAMPLE.jd;$("hours").value=16;$("budget").value=200;$("example-note").hidden=false;fillActions(EXAMPLE.actions);actionsDirty=true;});
 $("jd-review").addEventListener("input",()=>{jdDirty=true;renderEvidence();updateButtons();});
 $("cancel-jd").addEventListener("click",()=>{jdDirty=false;$("jd-review").value=current.jd_source_id?source(current.jd_source_id).text:"";renderEvidence();updateButtons();});
 $("match-form").addEventListener("submit",e=>{e.preventDefault();mutate("/api/match",{jd:$("jd-review").value.trim()},"正在以已核對內容對照 JD；有候選行動時也會重新比較…",()=>{jdDirty=false;},false);});
 $("settings-form").addEventListener("submit",e=>{e.preventDefault();mutate("/api/settings",{constraints:{hours:num($("current-hours").value),budget_hkd:num($("current-budget").value)}},"正在保存限制；舊比較將標示過期…",()=>{limitsDirty=false;},false);});
 $("settings-form").addEventListener("input",()=>{limitsDirty=true;updateButtons();$("comparison-status").textContent="限制草稿尚未保存，請保存或取消後再比較。";});
 $("cancel-limits").addEventListener("click",()=>{limitsDirty=false;$("current-hours").value=current.constraints.hours??"";$("current-budget").value=current.constraints.budget_hkd??"";renderComparisons();});
 $("compare-form").addEventListener("submit",e=>{e.preventDefault();if(!allowComparison())return;mutate("/api/compare",{actions:readActions(),confirmed:true,constraints:current.constraints},"正在比較候選行動…",s=>{actionsDirty=false;fillActions(s.actions);},false);});
 $("action-examples").addEventListener("click",()=>{fillActions(EXAMPLE.actions);actionsDirty=true;if(current)renderComparisons();});
 $("add-action").addEventListener("click",()=>{if($("action-editors").children.length<3){addAction();actionsDirty=true;if(current)renderComparisons();}});
 $("next-round").addEventListener("click",()=>{fillActions([{},{}]);actionsDirty=true;planId="";$("choice-section").hidden=true;renderComparisons();notice("已開始下一輪候選草稿；原計畫、成果與最近一次差異仍保留。");});
 $("choose-none").addEventListener("click",()=>{planId="";$("choice-section").hidden=true;$("settings-form").scrollIntoView();notice("可調整行動、時間或預算；已核對經歷、計畫與成果仍保留。");});
 $("plan-form").addEventListener("submit",e=>{e.preventDefault();savePlan("confirm");});$("save-plan-draft").addEventListener("click",()=>savePlan("draft"));
 $("outcome-editor").addEventListener("change",loadOutcome);
 $("update-form").addEventListener("submit",e=>{e.preventDefault();const id=$("outcome-editor").value;mutate("/api/update",{outcome_id:id||null,outcome:{work_done:$("work-done").value.trim(),contribution:$("contribution").value.trim(),materials_excerpt:$("materials-excerpt").value.trim(),plan_id:$("outcome-plan").value||null,progress:$("outcome-progress").value,withdrawn:$("outcome-withdrawn").checked}},"正在保存成果、更新 JD 對照與目前候選比較；全部成功才套用…",s=>{renderOutcomeOptions();$("outcome-editor").value=id||s.outcomes.at(-1).id;loadOutcome();});});
 $("start-chat").addEventListener("click",()=>{if($("chat-experience").value)startChat($("chat-experience").value);});
 $("chat-history").addEventListener("change",()=>{chatId=$("chat-history").value;reanswerId="";$("chat-answer").value="";renderChat();});
 $("chat-form").addEventListener("submit",e=>{e.preventDefault();const c=current.conversations.find(c=>c.id===chatId),t=reanswerId?c.turns.find(t=>t.id===reanswerId):c.turns.find(t=>!t.superseded&&!t.answers.length);if(!t)return;mutate("/api/chat",{operation:reanswerId?"reanswer":"answer",conversation_id:chatId,turn_id:t.id,answer:$("chat-answer").value.trim()},"正在根據你的回答繼續深入追問…",()=>{reanswerId="";$("chat-answer").value="";},false);});
 $("cancel-reanswer").addEventListener("click",()=>{reanswerId="";$("chat-answer").value="";renderChat();});
 $("chat-feedback").addEventListener("click",()=>mutate("/api/chat",{operation:"feedback",conversation_id:chatId},"正在整理本段回饋；不會改動證據支持程度…",null,false));
 $("cancel-request").addEventListener("click",()=>{cancelRequest();notice("已取消等待；草稿及最後成功結果保留。已發出的供應商請求不保證能撤回。");});
 $("clear-all").addEventListener("click",()=>{cancelRequest();current=null;chatId=reanswerId=planId="";actionsDirty=true;jdDirty=false;limitsDirty=false;$("analyze-form").reset();$("update-form").reset();$("outcome-plan").disabled=false;$("example-note").hidden=true;$("chat-form").reset();$("choice-section").hidden=true;fillActions([{},{}]);render();error();notice("已清除本頁資料；先前回應不會回填。");window.scrollTo({top:0});});
 fillActions([{},{}]);window.CareerFetch("/api/health").then(r=>{if(!r.ok)throw new Error();return r.json();}).then(h=>{$("health").textContent=h.api_key_configured?"服務已啟動 · Key 已設定，連線尚未驗證":"服務已啟動 · 尚未設定 DeepSeek key";}).catch(()=>{$("health").textContent="未能確認服務，請檢查後端";});

 function locate(id){const target=$(id);if(!target)return;if(id==="profile-section")$("legacy-profile-details").open=true;if(parent!==window)parent.postMessage({type:"career-legacy-scroll",top:target.getBoundingClientRect().top+window.scrollY},location.origin);else target.scrollIntoView({block:"start"});}
 const draftForms="#match-form,#settings-form,#compare-form,#plan-form,#update-form";
 function draftSnapshot(){const fields={};document.querySelectorAll(draftForms).forEach(form=>form.querySelectorAll("input[id],textarea[id],select[id]").forEach(n=>fields[n.id]={value:n.value,checked:n.checked}));return {fields,actions:readActions(),actionsDirty,jdDirty,limitsDirty,planId};}
 function publishDraft(){if(parent!==window&&current)parent.postMessage({type:"career-legacy-draft",ui:draftSnapshot()},location.origin);}
 function restoreDraft(ui){if(!ui)return;if(ui.actions?.length){fillActions(ui.actions);actionsDirty=!!ui.actionsDirty;}jdDirty=!!ui.jdDirty;limitsDirty=!!ui.limitsDirty;planId=ui.planId||"";if(planId)loadPlan();for(const [id,field] of Object.entries(ui.fields||{})){const n=$(id);if(n&&n.closest(draftForms)){n.value=field.value;if(typeof field.checked==="boolean")n.checked=field.checked;}}renderEvidence();updateButtons();}
 document.addEventListener("input",e=>{if(e.target.closest(draftForms))publishDraft();});document.addEventListener("change",e=>{if(e.target.closest(draftForms))publishDraft();});
 document.querySelectorAll('.steps a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();locate(a.hash.slice(1));}));
 if(parent!==window){document.body.classList.add("embedded-actions");$("legacy-storage-note").textContent="經歷、行動比較、計畫、進度及這些表單草稿會保存至目前專案。請等外層保存完成再關閉；新增成果需要明確同步才加入主資料。";let lastHeight=0;new ResizeObserver(()=>{const height=Math.ceil(document.querySelector('main').getBoundingClientRect().height+48);if(height!==lastHeight){lastHeight=height;parent.postMessage({type:"career-legacy-height",height},location.origin);}}).observe(document.querySelector('main'));}

 window.addEventListener("message",event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.type!=="career-import")return;cancelRequest();current=event.data.state;chatId=reanswerId=planId="";jdDirty=limitsDirty=false;actionsDirty=!current.actions.length;fillActions(current.actions.length?current.actions:[{},{}]);render();restoreDraft(event.data.ui);requestAnimationFrame(()=>locate(current.analysis?"actions-section":"evidence-section"));});
 if(parent!==window)parent.postMessage({type:"career-legacy-ready"},location.origin);
})();




