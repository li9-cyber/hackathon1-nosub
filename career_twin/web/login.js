"use strict";
(() => {
 const $=id=>document.getElementById(id),copy={
  'zh-Hant':{heading:'為你的下一步，留一個空間。',intro:'輸入網站登入密碼，繼續準備你的下一個方向。','password-label':'登入密碼',submit:'登入工作區',hint:'登入後，各瀏覽器仍保有自己的專案空間。',invalid_credentials:'密碼不正確，請再試一次。',try_later:'嘗試次數較多，請稍候一分鐘再登入。',login_unavailable:'暫時無法登入，請稍後重試。',request_rejected:'驗證已到期，請重新載入頁面再試。'},
  en:{heading:'Make space for your next chapter.',intro:'Enter your website password to continue preparing for your next opportunity.','password-label':'Password',submit:'Sign in',hint:'Each browser keeps its own project workspace after sign-in.',invalid_credentials:'Incorrect password. Please try again.',try_later:'Too many attempts. Please wait one minute.',login_unavailable:'Sign-in is temporarily unavailable. Please try again later.',request_rejected:'Verification expired. Reload this page and try again.'}
 };
 let language='zh-Hant',csrf='',error='';try{if(localStorage.getItem('career.language')==='en')language='en';}catch{}
 function render(){document.documentElement.lang=language;$('language').value=language;for(const id of ['heading','intro','password-label','submit','hint'])$(id).textContent=copy[language][id];$('message').textContent=error?(copy[language][error]||copy[language].login_unavailable):'';}
 function destination(){try{const raw=new URLSearchParams(location.search).get('next')||window.CareerURL('/'),url=new URL(raw,location.origin);if(url.origin===location.origin&&['/','/legacy','/admin/minimum-requirements'].map(window.CareerURL).includes(window.CareerURL(url.pathname))){url.hash=location.hash||url.hash;return window.CareerURL(url.pathname)+url.search+url.hash;}}catch{}return window.CareerURL('/');}
 $('language').onchange=()=>{language=$('language').value;try{localStorage.setItem('career.language',language);}catch{}render();};render();
 async function status(){try{const response=await window.CareerFetch('/auth/status',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error();if(data.authenticated){location.replace(destination());return;}csrf=data.csrf;$('submit').disabled=false;}catch{error='login_unavailable';render();}}
 $('login-form').onsubmit=async event=>{event.preventDefault();$('submit').disabled=true;error='';render();try{const response=await window.CareerFetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Career-CSRF':csrf},body:JSON.stringify({password:$('password').value})}),data=await response.json();if(response.ok){$('password').value='';location.replace(destination());return;}error=data.error?.code||'login_unavailable';if(error==='request_rejected')await status();}catch{error='login_unavailable';}finally{$('submit').disabled=false;render();}};
 status();
})();
