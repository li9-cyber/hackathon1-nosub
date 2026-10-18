/* UI messages are explicit; user and model content never goes through a dictionary. */
"use strict";
(() => {
 const catalog=window.CareerEnglish||{}, key='career.language', valid=['zh-Hant','en'];
 let locale='zh-Hant';try{const saved=localStorage.getItem(key);if(valid.includes(saved))locale=saved;}catch{}
 const marker=Symbol('ui-message'), bindings=new Set(), owned=new WeakMap();
 const isMessage=value=>!!value&&value[marker]===true;
 const resolve=value=>isMessage(value)?value.render(locale):String(value??'');
 function message(render){return {[marker]:true,render,toString(){return this.render(locale);},toJSON(){return this.render('zh-Hant');},[Symbol.toPrimitive](){return this.render(locale);}};}
 const chineseCopy=source=>source.replace(/\bJD\b/g,'職位說明').replace(/\bAI\b/g,'人工智能').replace(/\bHKD\b/g,'港元').replace(/\bURL\b/g,'網址').replace(/\bRequired\b/g,'必要條件').replace(/\bPreferred\b/g,'加分條件').replace(/API key/gi,'服務金鑰');
 function msg(source,params=[]){source=window.CareerLanguageAliases?.[source]??source;return message(language=>{const copy=language==='en'?(catalog[source]??source):chineseCopy(source);return copy.replace(/\{(\d+)\}/g,(_,i)=>{const value=params[Number(i)];return isMessage(value)?value.render(language):String(value??'');});});}
 function join(parts){return message(language=>parts.map(value=>isMessage(value)?value.render(language):String(value??'')).join(''));}
 function date(value){return message(language=>new Intl.DateTimeFormat(language==='en'?'en-HK':'zh-HK',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)));}
 function bind(node,slot,value,write){let slots=owned.get(node);if(!slots){slots=new Map();owned.set(node,slots);}const previous=slots.get(slot);if(previous)bindings.delete(previous);slots.delete(slot);write(resolve(value));if(isMessage(value)){const entry={node,slot,value,write};slots.set(slot,entry);bindings.add(entry);}return value;}
 function text(node,value){return bind(node,'text',value,v=>node.textContent=v);}
 function appendText(node,value){const original=owned.get(node)?.get('text')?.value??node.textContent;return text(node,join([original,value]));}
 function attr(node,name,value){return bind(node,'attr:'+name,value,v=>node.setAttribute(name,v));}
 function prop(node,name,value){return bind(node,'prop:'+name,value,v=>node[name]=v);}
 function option(label,value,defaultSelected=false,selected=false){const n=new Option('',value,defaultSelected,selected);text(n,label);return n;}
 function apply(){
  document.documentElement.lang=locale;
  for(const entry of bindings){if(!entry.node.isConnected){bindings.delete(entry);continue;}entry.write(resolve(entry.value));}
  document.querySelectorAll('[data-language-choice]').forEach(n=>n.value=locale);
  document.querySelectorAll('[data-language-toggle]').forEach(n=>{n.textContent=locale==='zh-Hant'?'EN':'繁';n.lang=locale==='zh-Hant'?'en':'zh-Hant';const label=locale==='zh-Hant'?'Switch to English':'切換至繁體中文';n.setAttribute('aria-label',label);n.title=label;});
 }
 function set(value){if(!valid.includes(value)||value===locale)return;locale=value;try{localStorage.setItem(key,value);}catch{}apply();document.dispatchEvent(new CustomEvent('career:language',{detail:{language:locale}}));}
 // Drop bindings for replaced cards after each controller render.
 let cleanupPending=false;
 function cleanAfterRender(){if(cleanupPending)return;cleanupPending=true;queueMicrotask(()=>{cleanupPending=false;for(const entry of bindings)if(!entry.node.isConnected)bindings.delete(entry);});}
 document.addEventListener('career:state',cleanAfterRender);
 document.addEventListener('career:view',cleanAfterRender);
 window.CareerI18n={get:()=>locale,msg,join,date,text,appendText,attr,prop,option,resolve,set};
 // Capture authored markup before controllers add any user content. Preserve nodes and form values.
 const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT), nodes=[];
 while(walker.nextNode())nodes.push(walker.currentNode);
 for(const n of nodes){if(n.parentElement?.closest('script,style,textarea,[data-language-choice],[data-no-i18n]'))continue;const source=n.data.trim();if((Object.hasOwn(catalog,source)||Object.hasOwn(window.CareerLanguageAliases||{},source))){const leading=n.data.slice(0,n.data.indexOf(source)),trailing=n.data.slice(n.data.indexOf(source)+source.length);bind(n,'text',join([leading,msg(source),trailing]),v=>n.data=v);}}
 document.querySelectorAll('[aria-label],[title],[placeholder],[data-tooltip]').forEach(n=>{for(const name of ['aria-label','title','placeholder','data-tooltip']){const source=n.getAttribute(name);if(source&&(Object.hasOwn(catalog,source)||Object.hasOwn(window.CareerLanguageAliases||{},source)))attr(n,name,msg(source));}});
 document.addEventListener('change',event=>{if(event.target.matches('[data-language-choice]'))set(event.target.value);});
 document.addEventListener('click',event=>{if(event.target.closest('[data-language-toggle]'))set(locale==='zh-Hant'?'en':'zh-Hant');});
 window.addEventListener('storage',event=>{if(event.key===key){const next=valid.includes(event.newValue)?event.newValue:'zh-Hant';if(next!==locale){locale=next;apply();document.dispatchEvent(new CustomEvent('career:language',{detail:{language:locale}}));}}});
 apply();
})();
