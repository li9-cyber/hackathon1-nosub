/* This optional adapter never calls APIs or touches feature data. */
"use strict";
(() => {
 const reduce=matchMedia("(prefers-reduced-motion: reduce)");
 let leaving=false,exitTimer;
 const clearExit=()=>{clearTimeout(exitTimer);leaving=false;document.body.classList.remove('product-leaving');};
 window.CareerMotion={leaveProduct(done){
  if(leaving)return;
  if(reduce.matches){done();return;}
  leaving=true;document.body.classList.add('product-leaving');
  exitTimer=setTimeout(()=>{clearExit();done();},220);
 }};
 document.addEventListener('career:language',()=>{
  if(reduce.matches||document.body.classList.contains('interview-fullscreen-active'))return;
  document.querySelector('.view:not([hidden])')?.animate?.(
   [{opacity:.45,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],
   {duration:240,easing:'ease-out'});
 });
 const targets=[...document.querySelectorAll("[data-reveal]")];
 let observer;
 if(!reduce.matches && "IntersectionObserver" in window){
  observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
   if(entry.isIntersecting){entry.target.classList.remove("reveal-pending");observer.unobserve(entry.target);}
  }),{threshold:0.08});
  targets.forEach(node=>{node.classList.add("reveal-pending");observer.observe(node);});
 }
 reduce.addEventListener("change",()=>{if(reduce.matches){observer?.disconnect();targets.forEach(n=>n.classList.remove("reveal-pending"));}});
 document.addEventListener("career:view",event=>{
  clearExit();
  const target=document.getElementById("view-"+event.detail.page);
  if(!target||reduce.matches)return;
  target.classList.remove("view-enter");requestAnimationFrame(()=>target.classList.add("view-enter"));
 });
 // User-selected steps remain available without automatic playback or a pause control.
 const journey=document.querySelector(".career-journey");
 if(!journey)return;
 const steps=[...journey.querySelectorAll("[data-flow-step]")],panels=[...journey.querySelectorAll("[data-flow-panel]")];
 function show(index){
  steps.forEach((step,i)=>step.setAttribute("aria-pressed",String(i===index)));
  panels.forEach((panel,i)=>panel.hidden=i!==index);
 }
 steps.forEach((step,index)=>step.addEventListener("click",()=>show(index)));
})();

