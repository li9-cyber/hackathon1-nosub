/* Existing matching results -> conservative presentation. No new match score. */
"use strict";
(() => {
const hasProfile=s=>!!(s?.extracted||s?.career_memory_only||s?.items?.length);
const category=r=>/\b(preferred|desirable|advantage|bonus)\b|加分|優先/i.test(r.quote)?'preferred':/\b(is|are) not (required|necessary|mandatory)\b|\bno .{0,70} (required|necessary)\b|不要求|無需|毋須/i.test(r.quote)?'not_required':r.required?'required':'preferred';
function proofs(c,s=window.CareerWorkspace?.getState()){return [...(c?.citations||[]),...(c?.citation_ids||[]).map(id=>s?.job_citations?.[id]).filter(Boolean)].filter(p=>p.source_id&&p.item_id&&p.text&&p.source_spans?.length&&CareerEvidence.validSpans(p.text,p.source_spans).length===p.source_spans.length);}
function status(c,s){if(!hasProfile(s)||!c)return 'unknown';if(!proofs(c,s).length)return c.status==='unknown'?'missing':'unknown';if(c.status==='met'&&['self_reported','needs_review'].includes(c.evidence_status))return 'missing';return c.status==='unknown'?'missing':c.status;}
function match(job,s){const m=[...(s?.matches||[]),...(s?.catalog_matches||[])].find(m=>m.job_id===job.id);return job.normalized&&m&&!m.stale&&m.job_version===job.version?m:null;}
function rows(job,s){const saved=s?.matches?.find(m=>m.job_id===job.id&&m.algorithm==='FCDT A_80_20');if(saved)return saved.units.map(u=>({requirement:{...u,alternatives:[]},category:u.type==='Required'?'required':'preferred',text:u.description,status:u.status==='high'?'met':'unknown',hard:!['skill','tool'].includes(u.kind)}));if(job.requirements?.some(r=>!r.alternatives))return [];
 const found=match(job,s),standard=new Map();for(const e of job.standardized?.entries||[])for(const [key,id] of Object.entries(e.requirement_ids||{}))standard.set(id,e.fields[key]);
 return (job.requirements||[]).filter(r=>!r.statement_type||r.statement_type==='requirement').map(requirement=>{
  const condition=found?.conditions.find(c=>c.requirement_id===requirement.id),hard=requirement.alternatives.some(g=>g.some(p=>p.kind!=='skill'));
  let value=status(condition,s);const pending=requirement.validation_status&&requirement.validation_status!=='valid';const decisions=pending?[]:found?.evidence_matching?.skills.filter(r=>r.jd_requirement_id===requirement.id)||[];
  if(pending)value='unknown';
  if(!hard&&decisions.length&&value!=='not_met')value=requirement.alternatives.some(g=>g.every(p=>decisions.find(d=>d.predicate_id===p.id)?.evidence_grade==='DIRECT'))?'met':'missing';
  const typed=decisions[0]?.jd_requirement_type;
  return {requirement,condition,category:typed==='Unclear'?'unclear':typed==='Required'?'required':typed==='Preferred'?'preferred':category(requirement),text:standard.get(requirement.id)||requirement.description,status:value,hard};
 });
}
function engine(job,s){return match(job,s)?.evidence_matching||null;}
function isV11(job,s){return engine(job,s)?.algorithm_version==='1.1.0';}
function bucket(job,s){const v=engine(job,s);return isV11(job,s)&&!(v.recommendation_bucket==='UNSUPPORTED'&&!job.role_classification)?v.recommendation_bucket:'UNRANKABLE';}
function label(job,s){const v=engine(job,s);if(!v)return '匹配分析尚未完成';if(v.status==='role_unverified'||(v.recommendation_bucket==='UNSUPPORTED'&&!job.role_classification))return '職位類別待確認';if(v.recommendation_bucket==='UNSUPPORTED')return '不支援的職位類別';if(v.recommendation_bucket==='INELIGIBLE')return '有入職條件差距';if(v.recommendation_bucket==='NEEDS_CONFIRMATION')return '入職資格仍需補充證據';return v.match_level?{high:'高度匹配',good:'匹配良好',partial:'部分匹配',low:'匹配度較低'}[v.match_level]:v.status==='jd_incomplete'?'職位資料不足':'匹配分析尚未完成';}
function alertText(value){let found=/^Preferred 尚有 (\d+)\/(\d+) 項/.exec(value);if(found)return CareerI18n.msg('Preferred 尚有 {0}／{1} 項缺少 CV 證據；請同時查看個別要求。',found.slice(1));found=/^Required 尚有 (\d+)\/(\d+) 項/.exec(value);if(found)return CareerI18n.msg('Required 尚有 {0}／{1} 項未得到完整 CV 證據。',found.slice(1));return CareerI18n.msg(value);}
function sections(jobs,s){if(!jobs.some(j=>isV11(j,s)))return [{label:null,jobs}];return [['ELIGIBLE','正常推薦'],['NEEDS_CONFIRMATION','資格待確認'],['UNRANKABLE','資料待完善'],['INELIGIBLE','已確認資格不符'],['UNSUPPORTED','不支援的職位類別']].map(([key,label])=>({label,jobs:jobs.filter(j=>bucket(j,s)===key)})).filter(g=>g.jobs.length);}
function unitSkills(job,s){return (engine(job,s)?.requirement_units||[]).map(u=>({name:u.name,condition:{citation_ids:u.citation_ids},decision:{...u,evidence_grade:u.evidence_grade},requirement:job.requirements.find(r=>u.requirement_ids.includes(r.id)),category:{Required:'required',Preferred:'preferred',Unclear:'unclear'}[u.type]||'unclear',status:u.evidence_grade==='DIRECT'?'met':'missing',gap:u.gap}));}
function skillGrade(job,s,id){return engine(job,s)?.skills.find(r=>r.predicate_id===id)||null;}
function skills(job,s){if(isV11(job,s))return unitSkills(job,s);const result=new Map();for(const row of rows(job,s)){if(row.category==='not_required')continue;for(const group of row.requirement.alternatives)for(const p of group){if(p.kind!=='skill')continue;const condition=row.condition?.skills?.find(v=>v.predicate_id===p.id);const key=p.skill_id||p.name;const decision=skillGrade(job,s,p.id);const value={name:p.raw_name,condition,decision,requirement:row.requirement,category:row.category,status:status(condition,s)};if(!result.has(key))result.set(key,value);else{const old=result.get(key);if(old.status!==value.status)old.status='missing';if(value.category==='required')old.category='required';}}}return [...result.values()];}
function summary(job,s){const r=rows(job,s).filter(r=>r.category==='required'),counts={met:0,not_met:0,unknown:0};for(const row of r)counts[['met','not_met'].includes(row.status)?row.status:'unknown']++;return {...counts,total:r.length,percent:null,current:!!match(job,s),complete:!!(job.full_description&&job.requirements_complete)};}
function diagnostic(job,s){const saved=s?.matches?.find(m=>m.job_id===job.id&&m.algorithm==='FCDT A_80_20');if(saved)return {type:saved.band==='high'?'met':'missing',label:saved.band==='high'?'高度符合':'目前未找到足夠匹配證據',action:'查看要求證據',requirements:[]};const required=rows(job,s).filter(r=>r.category==='required'),hard=required.filter(r=>r.hard&&r.status==='not_met'),gap=required.filter(r=>!r.hard&&r.status==='not_met'),pending=required.filter(r=>!['met','not_met'].includes(r.status));
 if(!hasProfile(s))return {type:'no_cv',label:'加入 CV 後可比對證據',action:'加入 CV',requirements:[]};
 if(job.analysis_status==='quota')return {type:'budget',label:'分析額度不足；原文已保存，請待額度恢復後再分析。',action:'查看已取得資料',requirements:[]};
 if(['request_budget_exhausted','techmap_quota_exhausted'].includes(job.details_error_code||s.matching_failures?.[engine(job,s)?.basis]))return {type:'budget',label:'分析額度已用完，重試不會提前恢復',action:'查看已取得資料',requirements:[]};
 if(job.analysis_status==='partial')return {type:'partial_analysis',label:'部分職位條件待確認；有效結果已保留，暫不作完整評分。',action:'重新分析職位',requirements:[]};
 if(!match(job,s))return {type:'unanalyzed',label:job.details_error_code?'職位分析失敗，可重試':'職位分析尚未完成',action:job.jd||job.description_excerpt?(job.details_error_code?'重試分析':'分析職位'):'補充完整 JD',requirements:[]};
 if(isV11(job,s)){
  const v=engine(job,s);
  if(v.status==='role_unverified'||(v.recommendation_bucket==='UNSUPPORTED'&&!job.role_classification))return {type:'retry_matching',label:'職位類別待確認；會根據完整職責重新辨識，不會因職稱不典型而排除。',action:'重新辨識職位並匹配',requirements:[]};
  if(v.recommendation_bucket==='UNSUPPORTED')return {type:'unsupported',label:'只支援六類金融職位；不包括保險、精算及承保。',action:'探索其他職位',requirements:[]};
  if(v.recommendation_bucket==='INELIGIBLE')return {type:'barrier',label:'有入職條件差距',action:'查看替代方向',requirements:hard};
  if(v.status==='analysis_incomplete')return {type:'retry_matching',label:'匹配分析尚未完成',action:'重試匹配分析',requirements:[]};
  if(v.recommendation_bucket==='NEEDS_CONFIRMATION'&&!v.gates?.length)return {type:'retry_matching',label:'入職資格仍需補充證據',action:'重試匹配分析',requirements:[]};
  if(v.recommendation_bucket==='NEEDS_CONFIRMATION')return {type:'missing',label:'入職資格仍需補充證據',action:'補充經歷',requirements:pending};
  if(!v.ranking_allowed)return {type:'limited',label:'職位資料不足',action:'補充完整 JD',requirements:[]};
  if(v.requirement_units.some(u=>u.type==='Required'&&u.evidence_grade!=='DIRECT'))return {type:'missing',label:'補充相關經歷，有助理解技能匹配程度',action:'補充經歷',requirements:pending};
  return {type:'met',label:'符合主要入職要求',action:'準備申請',requirements:[]};
 }
 if(engine(job,s)?.status==='analysis_incomplete')return {type:'retry_matching',label:'匹配分析尚未完成',action:'重試匹配分析',requirements:[]};
 if(hard.length)return {type:'barrier',label:'有入職條件差距',action:'查看替代方向',requirements:hard};
 if(gap.length)return {type:'gap',label:'有提升匹配程度的空間',action:'提升匹配程度',requirements:gap};
 if(pending.length)return {type:'missing',label:'補充相關經歷，有助理解技能匹配程度',action:'補充經歷',requirements:pending};
 if(!required.length||!job.full_description||!job.requirements_complete||(match(job,s).status!=='met'&&!engine(job,s)?.skills.length))return {type:'limited',label:'JD 資料不足，整體資格待確認',action:'補充完整 JD',requirements:[]};
 return {type:'met',label:'符合主要入職要求',action:'準備申請',requirements:[]};
}
function order(jobs,s){if(!hasProfile(s))return [...jobs];if(jobs.some(j=>isV11(j,s))){const priorities={ELIGIBLE:0,NEEDS_CONFIRMATION:1,UNRANKABLE:2,INELIGIBLE:3,UNSUPPORTED:4};return jobs.map((j,i)=>({j,i})).sort((a,b)=>priorities[bucket(a.j,s)]-priorities[bucket(b.j,s)]||(bucket(a.j,s)==='ELIGIBLE'?(engine(a.j,s)?.rank??10000)-(engine(b.j,s)?.rank??10000):0)||a.i-b.i).map(v=>v.j);}if(jobs.some(j=>Number.isInteger(engine(j,s)?.rank)))return jobs.map((j,i)=>({j,i})).sort((a,b)=>(engine(a.j,s)?.rank??10000)-(engine(b.j,s)?.rank??10000)||a.i-b.i).map(v=>v.j);const priority={met:0,missing:1,limited:1,unanalyzed:1,retry_matching:1,gap:2,barrier:3,no_cv:1,budget:1};return jobs.map((j,i)=>({j,i,d:diagnostic(j,s),skills:skills(j,s).filter(v=>v.status==='met').length})).sort((a,b)=>priority[a.d.type]-priority[b.d.type]||b.skills-a.skills||a.i-b.i).map(r=>r.j);}
function filter(jobs,{level='',minimum=0}={}){return jobs.filter(j=>{const fields=j.standardized?.entries?.find(e=>e.section==='job')?.fields||{};const explicit=fields['職級']||j.provider_metadata?.careerLevel||(/intern/i.test(j.employment_type||'')?j.employment_type:'');if(level&&explicit&&!new RegExp(level,'i').test(explicit))return false;return !(minimum&&j.salary?.currency==='HKD'&&j.salary.period==='month'&&j.salary.maximum!==null&&j.salary.maximum<minimum);});}
window.CareerJobAnalysis={engine,skillGrade,hasProfile,category,proofs,status,match,rows,skills,summary,diagnostic,order,filter,isV11,bucket,label,sections,alertText};
})();
