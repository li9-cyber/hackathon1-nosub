/* One public-path resolver for pages, API requests and embedded workspaces. */
"use strict";
(() => {
 const scriptPath=new URL(document.currentScript.src,location.href).pathname;
 const suffix='/static/services/base-path.js';
 const prefix=scriptPath.endsWith(suffix)?scriptPath.slice(0,-suffix.length):'';
 function url(path){
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//'))return path;
  if(prefix&&(path===prefix||path.startsWith(prefix+'/')))return path;
  return prefix+path;
 }
 window.CareerURL=url;
 window.CareerFetch=(input,options)=>fetch(url(input),options);
 window.CareerPublicPath=prefix;
})();
