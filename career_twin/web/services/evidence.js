/* Shared source-offset rendering. The server remains the evidence authority. */
"use strict";
(() => {
function validSpans(text,spans){
 const chars=Array.from(text);
 return (spans||[]).filter(s=>Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.start>=0&&s.start<s.end&&s.end<=chars.length&&chars.slice(s.start,s.end).join('')===s.quote);
}
function segments(text,spans){
 const chars=Array.from(text),ranges=validSpans(text,spans).map(s=>[s.start,s.end]).sort((a,b)=>a[0]-b[0]),merged=[];
 for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
 const result=[];let cursor=0;
 for(const [start,end] of merged){if(start>cursor)result.push({text:chars.slice(cursor,start).join(''),highlight:false});result.push({text:chars.slice(start,end).join(''),highlight:true});cursor=end;}
 if(cursor<chars.length)result.push({text:chars.slice(cursor).join(''),highlight:false});
 return result;
}

function skills(state,{experienceId,skillId,sourceTexts}){
 const item=(state.items||[]).find(i=>i.id===experienceId);if(!item)return [];
 const profile=state.evidence_profile;
 const records=item.section==='skill'||!profile?state.skill_evidence||[]:profile.status==='legacy_needs_analysis'
  ?[...(state.skill_evidence||[]),...(profile.capability_links||[]).filter(r=>r.evidence_origin==='user_provided')]:profile.capability_links||[];
 return records.filter(r=>r.experience_id===experienceId&&(!skillId||r.skill_id===skillId)&&sourceTexts.has(r.source_id)&&r.source_spans?.length
  &&validSpans(sourceTexts.get(r.source_id),r.source_spans).length===r.source_spans.length);
}
function profileSkills(state){
 const grouped=new Map(),sources=new Map((state.sources||[]).map(s=>[s.id,s.text]));
 for(const record of state.evidence_profile?.supplemental_evidence||[])sources.set(record.source_id,record.text);
 for(const item of state.items||[]){
  const texts=new Map(sources);texts.set(item.source_id,item.text);
  for(const record of skills(state,{experienceId:item.id,sourceTexts:texts}).filter(r=>r.display!==false)){
   if(!grouped.has(record.skill_id))grouped.set(record.skill_id,{id:record.skill_id,name:record.canonical_name||record.original_names?.[0]||record.skill_id,citations:[]});
   grouped.get(record.skill_id).citations.push({item_id:item.id,source_id:record.source_id,text:texts.get(record.source_id),source_spans:record.source_spans,title:item.title||item.role,source_kind:record.evidence_origin==='user_provided'?'user_supplied':'cv'});
  }
 }
 return [...grouped.values()];
}
window.CareerEvidence={validSpans,segments,skills,profileSkills};
})();
