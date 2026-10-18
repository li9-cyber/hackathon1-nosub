import {ConversationMic,decode64,microphoneError} from './audio.js';
import {AvatarVoice,readEvents} from './bridge.js';
const $=id=>document.getElementById(id);
const errors={VOICE_NOT_ENABLED:window.CareerI18n.msg("語音聊天尚未啟用。"),VOICE_CONFIGURATION_UNAVAILABLE:window.CareerI18n.msg("語音服務暫時無法連線，請稍後再試。"),GPU_ALLOWANCE_EXHAUSTED:window.CareerI18n.msg("目前的語音額度已用完。"),DEMO_WINDOW_CLOSED:window.CareerI18n.msg("語音聊天目前暫停。"),BUSY:window.CareerI18n.msg("目前有另一個語音對話，請結束後再試。"),CHAT_KEY_MISSING:window.CareerI18n.msg("語音服務尚未設定完成。"),NO_SPEECH_DETECTED:window.CareerI18n.msg("未聽清楚，請再說一次。"),TRANSCRIPTION_FAILED:window.CareerI18n.msg("語音辨識失敗，請再試一次。"),SESSION_EXPIRED:window.CareerI18n.msg("對話已逾時，請重新開始。"),SESSION_NOT_FOUND:window.CareerI18n.msg("對話已結束，請重新開始。"),CHAT_CANCELLED:'',CHAT_NETWORK_ERROR:window.CareerI18n.msg("連線中斷，請重新開始。")};
let view=null;
const ANSWER_SECONDS=150;
let voicePhase='';
function voiceState(phase){
  if(phase===voicePhase)return;voicePhase=phase;
  $('interview-recording').setAttribute('data-state',phase);
  const labels={idle:'麥克風尚未開啟',connecting:'正在連接麥克風',listening:'正在聆聽，請開始回答',recording:'正在錄音，完成後按「停止並送出」',processing:'回答已送出，正在處理',thinking:'面試官正在準備提問',speaking:'面試官說話中；可開口接話',ended:'本次面試已結束',empty:'未錄到語音，請重新錄音',error:'語音暫時無法使用'};
  window.CareerI18n.text($('interview-recording-label'),window.CareerI18n.msg(labels[phase]||labels.idle));
  $('interview-finish-answer').disabled=!['recording','empty'].includes(phase);
  window.CareerI18n.text($('interview-finish-answer'),window.CareerI18n.msg(phase==='empty'?'重新錄音':'停止並送出'));
}
function stopAnswerClock(v){clearInterval(v.answerTimer);v.answerTimer=null;v.answerDeadline=null;}
function finishAnswer(v){
  if(view!==v||!v.running||!v.answerDeadline)return;
  stopAnswerClock(v);
  if(!v.mic?.finish()){v.mic?.pause();voiceState('empty');status(window.CareerI18n.msg('未錄到語音，請重新錄音'));}
}
function beginAnswer(v,interrupted=false){
  if(view!==v||!v.running||v.answerDeadline)return;
  if(!interrupted)v.mic?.pause();
  v.answerDeadline=Date.now()+ANSWER_SECONDS*1000;v.mic?.resume();voiceState('recording');
  status(window.CareerI18n.msg('問題已說完，現在開始計時'));
  const update=()=>{
    if(view!==v||!v.running||!v.answerDeadline){stopAnswerClock(v);return;}
    const left=Math.max(0,Math.ceil((v.answerDeadline-Date.now())/1000));
    $('interview-answer-timer').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;
    $('interview-answer-timer').classList.toggle('is-urgent',left<=30);
    if(!left)finishAnswer(v);
  };
  v.answerTimer=setInterval(update,200);update();
}
function transcript(text){
  const panel=$('interview-transcript');window.CareerI18n.text(panel,text||window.CareerI18n.msg('開始面試後，這裡會顯示面試官正在說的話。'));panel.scrollTop=panel.scrollHeight;
}
const status=text=>{window.CareerI18n.text($('interview-status'),text);};
function error(value){window.CareerI18n.text($('interview-error'),errors[value.message]??value.message);$('interview-error').hidden=!$('interview-error').textContent;}
async function request(v,path,body,signal,keepalive=false){
  const response=await window.CareerFetch('/api/interview'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(v.projectId?{'X-Career-Project':v.projectId}:{'X-Career-General':'1'})},body:body===undefined?undefined:JSON.stringify(body),signal,keepalive});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error?.code||'Voice connection failed');}return response;
}
function controls(v){if(view!==v)return;const button=$('interview-chat');window.CareerI18n.text(button,window.CareerI18n.msg(v.running?'結束面試':'開始面試'));button.disabled=v.ending||(!v.running&&(!v.ready||v.clicking));button.setAttribute('aria-pressed',String(v.running));}
const fullscreenCard=$('interview-card'),fullscreenButton=$('interview-fullscreen');
let fullscreenFallback=false;
let wasFullscreen=false,returnFocus=null,backgroundLocks=[];
const fullscreenElement=()=>document.fullscreenElement||document.webkitFullscreenElement;
function viewportSize(){
  if(fullscreenFallback&&!CSS.supports('height','100dvh'))fullscreenCard.style.setProperty('--interview-viewport-height',`${window.visualViewport?.height||window.innerHeight}px`);
  else fullscreenCard.style.removeProperty('--interview-viewport-height');
}
function backgroundInert(lock){
  if(!lock){backgroundLocks.forEach(([node,inert])=>node.inert=inert);backgroundLocks=[];return;}
  for(let child=fullscreenCard;child?.parentElement&&child!==document.body;child=child.parentElement){
    for(const sibling of child.parentElement.children){
      if(sibling!==child&&sibling instanceof HTMLElement&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)){
        backgroundLocks.push([sibling,sibling.inert]);sibling.inert=true;
      }
    }
  }
}
function fullscreenControls(){
  const active=fullscreenElement()===fullscreenCard||fullscreenFallback;
  fullscreenCard.classList.toggle('is-fullscreen',active);
  document.body.classList.toggle('interview-fullscreen-active',active);
  document.documentElement.classList.toggle('interview-fullscreen-active',active);
  viewportSize();
  if(active!==wasFullscreen){
    if(active){returnFocus=document.activeElement;backgroundInert(true);fullscreenButton.focus({preventScroll:true});}
    else{backgroundInert(false);if(returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus({preventScroll:true});}
    wasFullscreen=active;
    document.dispatchEvent(new CustomEvent('career:fullscreen',{detail:{active}}));
  }
  window.CareerI18n.text(fullscreenButton,active?window.CareerI18n.msg("退出全螢幕"):window.CareerI18n.msg("全螢幕"));
  window.CareerI18n.attr(fullscreenButton,'aria-label',active?window.CareerI18n.msg("退出全螢幕"):window.CareerI18n.msg("進入全螢幕"));
  fullscreenButton.setAttribute('aria-pressed',String(active));
}
function exitFullscreen(){return (document.exitFullscreen||document.webkitExitFullscreen)?.call(document);}
fullscreenButton.addEventListener('click',async()=>{
  if(fullscreenElement()===fullscreenCard||fullscreenFallback){
    fullscreenFallback=false;
    if(fullscreenElement()===fullscreenCard)await Promise.resolve(exitFullscreen()).catch(()=>{});
  }else{
    const enter=fullscreenCard.requestFullscreen||fullscreenCard.webkitRequestFullscreen;
    try{
      if(!enter||document.fullscreenEnabled===false)throw new Error('Fullscreen unavailable');
      await enter.call(fullscreenCard);
    }catch{fullscreenFallback=true;}
  }
  fullscreenControls();
});
document.addEventListener('fullscreenchange',fullscreenControls);
document.addEventListener('webkitfullscreenchange',fullscreenControls);
function fullscreenEscape(event){
  if(event.key==='Escape'&&fullscreenFallback){fullscreenFallback=false;fullscreenControls();}
  if(event.key==='Tab'&&fullscreenFallback){
    const nodes=[...fullscreenCard.querySelectorAll('button:not(:disabled),select:not(:disabled),summary,iframe')].filter(n=>n.getClientRects().length);
    const first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
}
document.addEventListener('keydown',fullscreenEscape);
window.addEventListener('resize',viewportSize);
window.visualViewport?.addEventListener('resize',viewportSize);
function history(v){while(v.history.length>24||v.history.reduce((n,m)=>n+m.content.length,0)>12000)v.history.splice(0,2);}
function cancel(v){
  const active=v.active;v.active=null;
  active?.controller.abort();v.cueController?.abort();v.avatar.stop();
  if(active?.transcript){v.history.push({role:'user',content:active.transcript},{role:'assistant',content:active.spoken||'(Reply interrupted.)'});history(v);}
  if(v.session){const seq=++v.sequence,sid=v.session;v.stopping=v.stopping.catch(()=>{}).then(()=>request(v,`/sessions/${sid}/stop`,{client_sequence:seq}));}
  return v.stopping;
}
function interrupt(v){
  if(!v.running||!v.active)return;
  cancel(v).catch(e=>{if(view===v)error(e);});
  status(window.CareerI18n.msg("Go ahead."));const controller=new AbortController();v.cueController=controller;
  v.cuePlayback=(v.cue?v.avatar.play(v.cue.slice(0),controller.signal):Promise.resolve()).catch(()=>{}).finally(()=>{if(v.cueController===controller)v.cueController=null;});
}
async function send(v,audio,{opening=false}={}){
  if(view!==v||!v.running)return;
  stopAnswerClock(v);
  v.mic?.pause();voiceState(opening?'thinking':'processing');
  const intent=++v.intent;
  if(v.active)await cancel(v);
  await v.stopping;if(view!==v||!v.running||v.intent!==intent)return;
  const turn={controller:new AbortController(),transcript:'',spoken:'',shown:''};v.active=turn;
  let reply='',done=false,pending=0,playback=Promise.resolve(),playError=null;
  status(window.CareerI18n.msg(opening?'面試官正在準備提問':"Understanding your voice…"));
  try{
    if(v.projectId)await window.CareerPilot?.prepareVoice();if(view!==v||!v.running)return;
    const input=opening?{text:'Begin this interview by greeting the candidate and asking one concise opening question. Wait for their spoken answer.'}:{audio_wav:audio};
    const response=await request(v,`/sessions/${v.session}/chat-stream`,{...input,history:v.history,pilot_mode:window.CareerPilot?.mode()||'interview_interviewer',request_id:crypto.randomUUID(),client_sequence:++v.sequence},turn.controller.signal);
    for await(const event of readEvents(response)){
      if(v.active!==turn||turn.controller.signal.aborted)break;
      if(playError)throw playError;
      if(event.type==='transcript')turn.transcript=event.text;
      if(event.type==='context'&&v.projectId)window.CareerPilot?.debug(event);
      if(event.type==='state'&&event.state==='thinking')status(window.CareerI18n.msg("Thinking…"));
      if(event.type==='text')reply+=event.delta;
      if(event.type==='audio'){
        if(pending>=2)await playback;
        const wav=decode64(event.wav);pending++;
        playback=playback.then(async()=>{await v.cuePlayback;if(turn.controller.signal.aborted)return;await v.avatar.play(wav,turn.controller.signal,()=>{if(view===v&&v.active===turn){turn.shown+=(turn.shown?' ':'')+event.text;transcript(turn.shown);}});turn.spoken+=event.text+' ';}).catch(e=>{playError=e;}).finally(()=>pending--);
      }
      if(event.type==='error')throw new Error(event.code);
      if(event.type==='done')done=true;
    }
    await playback;if(playError)throw playError;
    if(v.active!==turn||turn.controller.signal.aborted)return;
    if(!done)throw new Error('Voice connection ended early');
    v.history.push({role:'user',content:turn.transcript},{role:'assistant',content:reply});history(v);
    v.active=null;beginAnswer(v);
    if(v.projectId&&!opening){window.CareerPilot?.voiceFact(turn.transcript);await window.CareerProjects?.recordVoice(v.projectId,v.documentId,turn.transcript,reply).catch(e=>{if(view===v)error(e);});}
  }catch(e){
    if(v.active===turn&&e.name!=='AbortError'){
      if(e.message==='NO_SPEECH_DETECTED')error(e);
      else{error(e);await end(v);}
    }
  }finally{if(v.active===turn){v.active=null;if(v.running&&view===v)beginAnswer(v);}}
}
async function start(v){
  if(!v.ready||v.running||view!==v)return;
  $('interview-answer-timer').textContent='02:30';$('interview-answer-timer').classList.toggle('is-urgent',false);
  v.running=true;controls(v);transcript();voiceState('connecting');$('interview-error').hidden=true;v.avatar.unlock();status(window.CareerI18n.msg("Opening microphone…"));
  const mic=new ConversationMic(audio=>{send(v,audio).catch(e=>{if(view===v)error(e);});},()=>{},
    {detectorOptions:{manual:true,maxSeconds:ANSWER_SECONDS},isInterrupting:()=>!!(v.active||v.cueController),onSpeechStart:()=>{interrupt(v);beginAnswer(v,true);},onEnded:e=>{if(v.running&&view===v){error(e);end(v);}}});
  v.mic=mic;
  try{
    await mic.start();if(view!==v||!v.running){mic.close();return;}
    status(window.CareerI18n.msg("Connecting…"));
    if(v.projectId)await window.CareerPilot?.prepareVoice();if(view!==v||!v.running)return;
    const response=await request(v,'/sessions',{});v.session=(await response.json()).session_id;v.sequence=0;
    if(view!==v||!v.running){await release(v);return;}
    v.cue=await (await request(v,'/cue')).arrayBuffer();
    if(view!==v||!v.running)return;
    await send(v,null,{opening:true});
  }catch(e){if(view===v&&v.running){error(e.name?.endsWith('Error')&&e.name!=='Error'?new Error(microphoneError(e)):e);await end(v);}}
}
async function release(v){
  const sid=v.session;if(!sid)return;v.session=null;
  await v.stopping.catch(()=>{});
  await request(v,`/sessions/${sid}/end`,{client_sequence:++v.sequence},undefined,true).catch(e=>{if(view===v)error(e);});
}
async function end(v){
  if(v.ending)return;
  stopAnswerClock(v);
  if(view===v)window.CareerAttention?.stop();
  v.ending=true;v.running=false;v.intent++;v.mic?.close();v.mic=null;v.active?.controller.abort();v.active=null;v.cueController?.abort();v.avatar.stop();controls(v);
   try{await release(v);}finally{v.ending=false;v.history=[];if(view===v){voiceState('ended');status(window.CareerI18n.msg("Chat ended"));controls(v);}}
}
function leave(){
  transcript();voiceState('idle');
  $('interview-answer-timer').textContent='02:30';$('interview-answer-timer').classList.toggle('is-urgent',false);
  window.CareerAttention?.reset();
  fullscreenFallback=false;fullscreenControls();
  if(fullscreenElement()===fullscreenCard)Promise.resolve(exitFullscreen()).catch(()=>{});
  const old=view;view=null;if(!old)return;
  const stopped=end(old);old.avatar.dispose();old.frame.remove();return stopped;
}
async function mount(){
  if(view)return;
  const frame=document.createElement('iframe');window.CareerI18n.prop(frame,"title",'AI conversation avatar');frame.allow='autoplay';
  frame.addEventListener('load',()=>frame.contentDocument?.addEventListener('keydown',fullscreenEscape));
  const v={projectId:document.body.dataset?.page==='practice'?null:window.CareerProjects?.id(),documentId:window.CareerWorkspace?.getState()?.document.id,frame,ready:false,running:false,ending:false,intent:0,history:[],session:null,sequence:0,active:null,stopping:Promise.resolve(),cuePlayback:Promise.resolve()};
  view=v;transcript();voiceState('idle');status(window.CareerI18n.msg("Loading avatar…"));$('interview-error').hidden=true;
  v.avatar=new AvatarVoice(frame,(state,e)=>{if(view!==v)return;if(state==='error')error(e);if(state==='speaking'){if(!v.cueController){v.mic?.resume();voiceState('speaking');}status(v.cueController?window.CareerI18n.msg("Go ahead."):window.CareerI18n.msg("Speaking…"));}});
  frame.src=new URL('./avatar.html',import.meta.url).href;$('interview-avatar').replaceChildren(frame);controls(v);
  try{
    const config=await (await request(v,'/config')).json();await v.avatar.whenReady();if(view!==v)return;
    v.ready=true;controls(v);status(config.ready?window.CareerI18n.msg("Ready to chat"):errors[config.reason]||window.CareerI18n.msg("語音聊天目前暫停。"));
  }catch(e){if(view===v){error(e);status(window.CareerI18n.msg("Unable to load chat"));}}
}
$('interview-chat').addEventListener('click',async()=>{
  const v=view;if(!v)return;
  if(v.running){await end(v);return;}
  if(v.clicking)return;
  v.clicking=true;controls(v);v.avatar.unlock();
  try{const config=await (await request(v,'/config')).json();if(view!==v)return;if(!config.ready)throw new Error(config.reason);await start(v);}catch(e){if(view===v)error(e);}finally{v.clicking=false;controls(v);}
});
$('interview-finish-answer').addEventListener('click',()=>{if(!view?.running)return;if(voicePhase==='empty')beginAnswer(view);else finishAnswer(view);});
document.addEventListener('career:interview',event=>{if(view&&view.projectId!==(document.body.dataset?.page==='practice'?null:window.CareerProjects?.id()))leave();if(event.detail.visible)mount();else leave();});
window.addEventListener('pagehide',leave);
window.CareerVoice={leave};
document.addEventListener('pilot:revoked',()=>{if(view&&view.projectId){view.history=[];if(view.running)end(view);}});
