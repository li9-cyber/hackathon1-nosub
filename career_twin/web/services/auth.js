"use strict";
(() => {
 let csrf='',dialog=null,checking=false;
 const i18n=window.CareerI18n;
 function requestLogin(){
  if(!dialog){dialog=document.createElement('dialog');dialog.className='login-renew';const title=document.createElement('h2'),copy=document.createElement('p'),link=document.createElement('a'),close=document.createElement('button');i18n.text(title,i18n.msg('請重新登入'));i18n.text(copy,i18n.msg('登入已到期。這頁的輸入會保留，請在新分頁登入後返回並重試。'));i18n.text(link,i18n.msg('開啟登入頁'));link.href=window.CareerURL('/login');link.target='_blank';link.rel='noopener';link.className='button-primary';i18n.text(close,i18n.msg('稍後'));close.className='button-quiet';close.onclick=()=>dialog.close();dialog.append(title,copy,link,close);document.body.append(dialog);}
  if(!dialog.open)dialog.showModal();
 }
 async function check(){if(checking)return;checking=true;try{const response=await window.CareerFetch('/auth/status',{cache:'no-store'});if(!response.ok)return;const data=await response.json();csrf=data.csrf;if(data.mode==='beta'){dialog?.close();document.querySelectorAll('[data-sign-out]').forEach(n=>n.hidden=true);return;}if(data.authenticated){dialog?.close();document.querySelectorAll('[data-sign-out]').forEach(n=>n.hidden=false);}else if(document.querySelector('[data-sign-out]:not([hidden])'))requestLogin();}catch{}finally{checking=false;}}
 document.addEventListener('click',async event=>{const button=event.target.closest('[data-sign-out]');if(!button)return;button.disabled=true;try{await window.CareerProjects?.flush();await window.CareerVoice?.leave();await check();const response=await window.CareerFetch('/auth/logout',{method:'POST',headers:{'X-Career-CSRF':csrf}});if(!response.ok)throw new Error();location.replace(window.CareerURL('/login'));}catch{button.disabled=false;requestLogin();}});
 window.CareerAuth={requestLogin};window.addEventListener('focus',check);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});check();
})();
