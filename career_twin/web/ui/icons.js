/* Original, small line icons. No remote icon dependency. */
"use strict";
(() => {
 const paths={
  grid:["M3 3h7v7H3z","M14 3h7v7h-7z","M3 14h7v7H3z","M14 14h7v7h-7z"],
  file:["M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8z","M14 2v6h6","M8 12h8M8 16h6"],
  check:["M9 5H5v15h14V5h-4","M9 3h6v4H9z","m8 13 3 3 5-6"],
  search:["M20 20l-5-5","M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0"],
  layers:["m12 3 9 5-9 5-9-5z","m3 12 9 5 9-5","m3 16 9 5 9-5"],
  path:["M5 5h10a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h10","M3 3h4v4H3z","m16 18 3 3-3 3"],
  mic:["M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z","M5 10v2a7 7 0 0 0 14 0v-2","M12 19v3M8 22h8"],
  settings:["M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0","M10 3h4l.6 2.2 1.6.9 2.2-.6 2 3.5-1.6 1.6v1.8l1.6 1.6-2 3.5-2.2-.6-1.6.9L14 21h-4l-.6-2.2-1.6-.9-2.2.6-2-3.5 1.6-1.6v-1.8L3.6 10l2-3.5 2.2.6 1.6-.9z"],
  arrow:["M4 12h16","m14 6 6 6-6 6"],
  sun:["M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0","M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"],
  moon:["M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11z"],
  panel:["M3 4h18v16H3z","M9 4v16"],
  close:["m6 6 12 12M6 18 18 6"],
  shield:["m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z","m8 12 3 3 5-5"],
  chevron:["m9 5 7 7-7 7"],
  book:["M4 3h6l2 2 2-2h6v17h-6l-2 2-2-2H4z","M12 5v17"]
 };
 function render(root=document){
  root.querySelectorAll("[data-icon]").forEach(node=>{
   const drawing=paths[node.dataset.icon];if(!drawing)return;
   const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
   svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("class","icon");svg.setAttribute("aria-hidden","true");
   drawing.forEach(d=>{const path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("d",d);svg.append(path);});
   node.replaceChildren(svg);
  });
 }
 render();window.CareerIcons={render};
})();

