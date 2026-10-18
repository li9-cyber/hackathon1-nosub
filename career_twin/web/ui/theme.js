/* Runs before stylesheets: only appearance preferences live in browser storage. */
"use strict";
(() => {
 const media=matchMedia('(prefers-color-scheme: dark)');
 let preference='system';
 function syncButtons(theme){
  document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
   button.setAttribute('aria-pressed',String(theme==='dark'));
   const label=theme==='dark'?'切換至淺色模式':'切換至深色模式';
   if(window.CareerI18n)window.CareerI18n.attr(button,'title',window.CareerI18n.msg(label));
   else button.title=label;
  });
 }
 try{const saved=localStorage.getItem('career.theme');if(['light','dark','system'].includes(saved))preference=saved;}catch{}
 function apply(){
  const theme=preference==='system'?(media.matches?'dark':'light'):preference;
  document.documentElement.dataset.theme=theme;
  document.documentElement.dataset.themePreference=preference;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#20232b':'#f1efeb');
  document.querySelectorAll('[data-theme-choice]').forEach(n=>n.checked=n.value===preference);
  syncButtons(theme);
  document.querySelectorAll('img[src*="/brand/"]:not([data-brand-fixed])').forEach(n=>{if(/(logo|icon)-(light|dark)\.svg/.test(n.src))n.src=n.src.replace(/-(light|dark)\.svg/,'-'+theme+'.svg');});
  document.dispatchEvent(new CustomEvent('career:theme',{detail:{theme,preference}}));
 }
 window.CareerTheme={get:()=>preference,set(value){if(!['light','dark','system'].includes(value))return;preference=value;try{localStorage.setItem('career.theme',value);}catch{}apply();}};
 media.addEventListener('change',()=>{if(preference==='system')apply();});
 window.addEventListener('storage',event=>{if(event.key==='career.theme'){preference=['light','dark','system'].includes(event.newValue)?event.newValue:'system';apply();}});
 apply();
 document.addEventListener('DOMContentLoaded',()=>{
  apply();
  document.querySelectorAll('[data-theme-choice]').forEach(n=>n.addEventListener('change',()=>window.CareerTheme.set(n.value)));
  document.querySelectorAll('[data-theme-toggle]').forEach(n=>n.addEventListener('click',()=>window.CareerTheme.set(document.documentElement.dataset.theme==='dark'?'light':'dark')));
 });
 document.addEventListener('career:language',()=>syncButtons(document.documentElement.dataset.theme));
})();
