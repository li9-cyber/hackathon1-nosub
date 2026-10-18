/* Compatibility facade: the jobs feature owns saved cards and interactions. */
"use strict";
(() => {
function searchQuery(value,state){const title=String(value||state?.preferences?.target_role||'').trim();return title?{keywords:title}:null;}
window.CareerJobs={searchQuery,card:(job,context)=>CareerJobWorkflow.card(job,context),openDetail:(job,context)=>CareerJobWorkflow.open(job,context),closeDetail:()=>window.CareerJobWorkflow?.close()};
})();
