/* Plans and their contextual actions. No network or animation code. */
"use strict";
window.CareerPlanning={render({state,$,el,link,btn,openLegacy}){
function renderPlans(){$("career-plans").replaceChildren(...state.plans.map(p=>{const j=[...state.jobs,...state.catalog_jobs].find(j=>j.id===p.job_id),box=el("article",undefined,"plan-card");box.append(el("h3",j?.title||p.job_id),el("p",p.stale?window.CareerI18n.msg("資料已更新，舊規劃僅供參考。"):window.CareerI18n.msg("依目前資料的可選方向。"),"hint"));p.actions.forEach(a=>box.append(el("h4",a.action),el("p",window.CareerI18n.msg("缺口 {0} · {1}",[j?.requirements.find(r=>r.id===a.requirement_id)?.description||window.CareerI18n.msg("待確認條件"),a.kind==="evidence"?window.CareerI18n.msg("補充已有能力的證據"):a.kind==="formal_qualification"?window.CareerI18n.msg("正式資格門檻"):window.CareerI18n.msg("培養新能力")])),el("p",window.CareerI18n.join([window.CareerI18n.msg("資源："),(a.resource_ids.join("、")||window.CareerI18n.msg("一般方向，尚未對應具體資源"))])),el("p",window.CareerI18n.join([window.CareerI18n.msg("預期產出："),a.output])),el("p",window.CareerI18n.join([window.CareerI18n.msg("完成判準："),a.completion]))));for(const r of p.resources||[]){box.append(el("h4",r.name),el("p",r.description));const a=link(r.url);if(a)box.append(a);}box.append(btn(window.CareerI18n.msg("以既有行動比較／成果流程繼續"),()=>openLegacy(p.job_id)));return box;}));}

renderPlans();
}};
