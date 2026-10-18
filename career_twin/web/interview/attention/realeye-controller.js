import {irisRelativePositions} from './gaze-math.js';
import {normalizeHeadPose,AttentionTracker,InterviewHeadTracker,ATTENTION_THRESHOLDS as T} from './attention-state.js?v=20261012-lower-head';
import {HeadCalibration,normalizeCalibratedPose} from './head-calibration.js';
const byId=id=>document.getElementById(id);
const msg=(source,params=[])=>window.CareerI18n.msg(source,params);
const write=(node,source,params=[])=>window.CareerI18n.text(node,msg(source,params));
const video=byId('gaze-video'),overlay=byId('gaze-eyes'),ctx=overlay.getContext('2d');
const start=byId('gaze-start'),stop=byId('gaze-stop'),center=byId('gaze-center'),camera=byId('gaze-camera');
const status=byId('gaze-state'),metrics=byId('gaze-metrics'),debug=byId('attention-debug'),eventCount=byId('attention-events');
const tracker=new AttentionTracker(),headTracker=new InterviewHeadTracker(),events=[],headEvents=[];
let attentionEventTotal=0,headEventTotal=0;
let stream=null,worker=null,generation=0,active=false,busy=false,timer=null,readyResolve=null,readyReject=null;
let lastVideoTime=-1,lastResultAt=0,frames=0,localDelegate=null,centering=null,lastSample=null;
const keys=['head_yaw','head_pitch','head_roll','eye_x','eye_y'];
const defaultBaseline=()=>({head_yaw:0,head_pitch:0,head_roll:0,eye_x:0,eye_y:T.defaultEyeY});
let baseline=defaultBaseline(),baselineSaved=false;
let calibration=null,calibrated=false,calibrationGains={};
const calibrationPanel=byId('head-calibration'),calibrationText=byId('calibration-instruction');
const calibrationCapture=byId('calibration-capture'),calibrationRestart=byId('calibration-restart');
function showCalibration(){
  calibrationPanel.hidden=!active;
  calibrationRestart.disabled=!active;
  calibrationCapture.hidden=calibrated;
  calibrationCapture.disabled=!active||calibration?.started!==null;
  if(calibrated){
    write(calibrationText,'校準完成，可以開始練習。攝影機或坐姿改變時，請重新校準。');
    write(byId('calibration-progress'),'5 / 5 完成');return;
  }
  if(!calibration)return;
  write(byId('calibration-progress'),'{0} / 5 · {1}',[calibration.index+1,msg(calibration.step.label)]);
  write(calibrationText,calibration.error||calibration.step.hint);
  write(calibrationCapture,calibration.started===null?'保持姿勢並取樣（約 2 秒）':'取樣中，請保持姿勢…');
}
function restartCalibration(){
  if(!active)return;
  calibration=new HeadCalibration();calibrated=false;calibrationGains={};centering=null;
  tracker.reset();headTracker.reset();events.length=headEvents.length=0;attentionEventTotal=headEventTotal=0;
  center.disabled=true;showCalibration();publish(empty());
}
const empty=()=>({state:'unknown',head_yaw:null,head_pitch:null,eye_x:null,eye_y:null,confidence:0,
  head_motion:{state:'unknown',events:[],non_nod_ms:headTracker.nonNodMs,nod_allowed:false,head_roll:null}});
const number=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';
function publish(result){
  const gazeLabels={forward:'面向畫面',left:'視線向左',right:'視線向右',down:'視線向下',away:'視線偏離',unknown:'等待可靠畫面'};
  write(status,!active?'攝影機尚未開啟':!calibrated?'開始前校準 · 尚未記錄練習動作':gazeLabels[result.state]||'等待可靠畫面');
  debug.textContent=['Head yaw: '+number(result.head_motion?.head_yaw??result.head_yaw),
    'Head pitch: '+number(result.head_motion?.head_pitch??result.head_pitch),
    'Head roll: '+number(result.head_motion?.head_roll),
    'Eye X: '+number(result.eye_x,2),'Eye Y: '+number(result.eye_y,2),
    'Confidence: '+number(result.confidence,2)].join('\n');
  document.dispatchEvent(new CustomEvent('digitallife:attention',{detail:{...result,timestamp:performance.now()}}));
  if(result.attention_event){
    attentionEventTotal++;events.push(result.attention_event);if(events.length>100)events.shift();
    document.dispatchEvent(new CustomEvent('digitallife:attention-away',{detail:result.attention_event}));
  }
  for(const event of result.head_motion?.events||[]){
    headEventTotal++;headEvents.push(event);if(headEvents.length>100)headEvents.shift();
    document.dispatchEvent(new CustomEvent('digitallife:head-movement',{detail:event}));
  }
  const headLabels={neutral:'面向前方',nodding:'點頭中（容許）','left-turn':'向左轉頭','right-turn':'向右轉頭',
    'left-tilt':'向左歪頭','right-tilt':'向右歪頭','sustained-down':'持續低頭','sustained-up':'持續抬頭',
    'frequent-head-movement':'頻繁轉頭／歪頭',unknown:'無法可靠判斷'};
  write(byId('head-posture'),'面試姿態：{0}',[msg(headLabels[result.head_motion?.state||'unknown'])]);
  write(byId('attention-duration'),'視線偏離有效時間：{0} / {1} 秒',
    [number((result.away_duration_ms||0)/1000),number(T.awayEventMs/1000)]);
  write(eventCount,'持續視線偏離：{0} 段 · 頭部動作記錄：{1} 次',[attentionEventTotal,headEventTotal]);
  document.body.dataset.gazeProof=JSON.stringify({engine:'realeye-light-open-1.1.0',active,measured_frames:frames,
    local_delegate:localDelegate,camera_uploads:0,cloud_gpu:false,mode:'head-eye-attention',cursor_visible:false,
    baseline_saved:false,head_calibrated:calibrated,calibration_gains:calibrationGains,
    attention_events:attentionEventTotal,head_movement_events:headEventTotal,...result});
}
function shutdown(message='攝影機已關閉'){
  generation++;active=false;clearTimeout(timer);timer=null;
  readyReject?.(new Error('攝影機已關閉'));readyResolve=readyReject=null;
  worker?.terminate();worker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
  ctx.clearRect(0,0,overlay.width,overlay.height);busy=false;centering=null;lastSample=null;tracker.reset();headTracker.reset(true);
  calibration=null;calibrated=false;calibrationGains={};showCalibration();
  start.disabled=false;stop.disabled=true;center.disabled=true;camera.disabled=false;
  publish(empty());window.CareerI18n.text(status,typeof message==='string'?msg(message):message);write(metrics,'開啟攝影機後，先完成正視、低頭、抬頭及左右轉頭五步校準。');
}
async function listCameras(){
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
  const selected=camera.value;camera.replaceChildren(window.CareerI18n.option(msg('預設攝影機'),''));
  devices.forEach((d,i)=>camera.add(window.CareerI18n.option(d.label||msg('攝影機 {0}',[i+1]),d.deviceId)));
  if(devices.some(d=>d.deviceId===selected))camera.value=selected;
  else{const rgb=devices.find(d=>d.label&&!/\bIR\b|infrared/i.test(d.label));if(rgb)camera.value=rgb.deviceId;}
}
function scheduleFrame(run){if(run===generation&&active)timer=setTimeout(()=>capture(run),32);}
async function capture(run){
  if(run!==generation||!active)return;scheduleFrame(run);if(document.hidden)return;
  if(performance.now()-lastResultAt>T.missingGraceMs){
    if(calibration&&calibration.started!==null){calibration.interrupt();showCalibration();}
    lastSample=null;center.disabled=true;const now=performance.now();
    publish({...tracker.update(null,now),head_motion:headTracker.update(null,now)});
  }
  if(busy||video.readyState<2||video.currentTime===lastVideoTime)return;
  lastVideoTime=video.currentTime;busy=true;
  try{
    const timestamp=performance.now(),bitmap=await createImageBitmap(video);
    if(run!==generation||!worker){bitmap.close();return;}
    worker.postMessage({type:'frame',bitmap,timestamp},[bitmap]);
  }catch(error){if(run===generation)shutdown(msg('攝影機處理失敗：{0}',[error.message]));}
}
function drawEyes(points){
  ctx.clearRect(0,0,overlay.width,overlay.height);if(!points)return;ctx.fillStyle='#6fffe9';
  for(const i of [33,133,159,145,362,263,386,374,468,473]){
    const p=points[i];if(!p)continue;ctx.beginPath();ctx.arc(p.x*overlay.width,p.y*overlay.height,i>=468?4:2,0,Math.PI*2);ctx.fill();
  }
}
function loadBaseline(){baseline=defaultBaseline();baselineSaved=false;}
function collectCenter(sample,now){
  if(!centering)return;if(sample)centering.samples.push(sample);if(now-centering.started<1000)return;
  const rows=centering.samples;centering=null;tracker.reset();headTracker.reset(true);
  if(rows.length<5){write(metrics,'正面樣本不足，請保持眼睛張開再試一次。');return;}
  const mean=Object.fromEntries(keys.map(k=>[k,rows.reduce((sum,r)=>sum+r[k],0)/rows.length]));
  const deviation=k=>Math.sqrt(rows.reduce((sum,r)=>sum+(r[k]-mean[k])**2,0)/rows.length);
  if(Math.abs(mean.head_yaw)>30 || Math.abs(mean.head_pitch)>30 || Math.abs(mean.head_roll)>15 || Math.abs(mean.eye_x)>.3 ||
    Math.abs(mean.eye_y)>.3 || deviation('head_yaw')>5 || deviation('head_pitch')>4 ||
    deviation('head_roll')>3 || deviation('eye_x')>.035 || deviation('eye_y')>.035){
    write(metrics,'頭部／眼球移動太大，請面向前方並穩定注視後再設定。');return;
  }
  baseline=mean;baselineSaved=false;
  write(metrics,'已設定正面基準。');
}
function handleResult(data){
  busy=false;if(!active||document.hidden)return;
  const now=performance.now();lastResultAt=now;drawEyes(data.points);
  const pose=normalizeHeadPose(data.poseMatrix),eyes=data.valid?irisRelativePositions(data.points,video.videoWidth/video.videoHeight):null;
  const sample=pose&&eyes?{...pose,eye_x:eyes.eye_x,eye_y:eyes.eye_y}:null;
  const fresh=now-data.timestamp<=T.maxFrameGapMs;
  lastSample=fresh?sample:null;center.disabled=!calibrated||!lastSample||!!centering;frames++;
  if(!calibrated){
    calibration?.update(fresh?pose:null,fresh?sample:null,now);
    if(calibration?.done){
      baseline={...calibration.holds.center};baselineSaved=false;calibrationGains={...calibration.gains};
      calibrated=true;tracker.reset();headTracker.reset();
      center.disabled=!lastSample;
    }
    showCalibration();publish(empty());return;
  }
  const wasCentering=!!centering;collectCenter(sample,now);
  const calibratedPose=normalizeCalibratedPose(pose,baseline,calibrationGains);
  const relative=sample?{...calibratedPose,eye_x:sample.eye_x-baseline.eye_x,eye_y:sample.eye_y-baseline.eye_y}:null;
  // Baseline collection and stale results never count as attention observations.
  if(wasCentering){tracker.reset();headTracker.reset(true);}
  const result=tracker.update(!wasCentering&&now-data.timestamp<=T.maxFrameGapMs?relative:null,now);
  // Head movement remains measurable during a blink/iris failure, using pose
  // alone; missing/stale pose and baseline collection remain excluded.
  const relativePose=calibratedPose;
  const headMotion=headTracker.update(!wasCentering&&now-data.timestamp<=T.maxFrameGapMs?relativePose:null,now);
  const relativeEyes=eyes?Object.fromEntries(['left','right'].map(k=>[k,
    {x:eyes[k].x-baseline.eye_x,y:eyes[k].y-baseline.eye_y}])):null;
  const measuredPose=pose?{head_yaw:pose.head_yaw-baseline.head_yaw,head_pitch:pose.head_pitch-baseline.head_pitch}:null;
  publish({...result,head_motion:headMotion,measured_pose:measuredPose,face_detected:!!data.points,head_pose_available:!!pose,iris_valid:!!eyes},relativeEyes);
  if(!wasCentering)write(metrics,!sample?'請保持臉部及雙眼清楚可見。':'完成五步動作校準後開始追蹤；坐姿或攝影機位置改變請重新校準。');
}
async function begin(){
  shutdown('正在開啟攝影機…');const run=generation;
  start.disabled=true;stop.disabled=false;camera.disabled=true;frames=0;events.length=headEvents.length=0;
  attentionEventTotal=headEventTotal=0;headTracker.reset();
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('請使用 localhost 或 HTTPS 網頁');
    await listCameras();if(run!==generation)return;const chosen=camera.value;
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:480},
      frameRate:{ideal:30,max:30},...(chosen?{deviceId:{exact:chosen}}:{facingMode:'user'})}});
    if(run!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;video.srcObject=stream;await video.play();if(run!==generation)return;
    overlay.width=video.videoWidth;overlay.height=video.videoHeight;await listCameras();if(run!==generation)return;
    const device=stream.getVideoTracks()[0].getSettings().deviceId;if(device)camera.value=device;
    loadBaseline();
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(run===generation)shutdown('攝影機已中斷，請重新開啟');});
    worker=new Worker(new URL('./realeye-worker.js',import.meta.url));
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    worker.onmessage=({data})=>{
      if(run!==generation)return;
      if(data.type==='ready'){localDelegate=data.delegate;readyResolve?.();readyResolve=readyReject=null;}
      else if(data.type==='result')handleResult(data);
      else if(data.type==='error'){
        const reject=readyReject;readyResolve=readyReject=null;reject?.(new Error(data.message));
        if(active)shutdown(msg('攝影機處理失敗：{0}',[data.message]));
      }
    };
    worker.onerror=event=>{readyReject?.(new Error(event.message));readyResolve=readyReject=null;
      if(active)shutdown(msg('攝影機處理失敗：{0}',[event.message]));};
    const timeout=setTimeout(()=>readyReject?.(new Error('RealEye 載入逾時')),30000);
    worker.postMessage({type:'init'});try{await ready;}finally{clearTimeout(timeout);}
    if(run!==generation)return;active=true;lastVideoTime=-1;lastResultAt=performance.now();restartCalibration();scheduleFrame(run);
  }catch(error){if(run===generation)shutdown(error.name==='NotAllowedError'?'請在 Chrome 網站設定允許攝影機後再開啟':
    error.name==='NotReadableError'?'攝影機被其他程式佔用，請關閉後重試':msg('開啟失敗：{0}',[msg(error.message)]));}
}
start.onclick=begin;stop.onclick=()=>shutdown();
calibrationCapture.onclick=()=>{if(active&&!calibrated&&calibration?.started===null){calibration.capture(performance.now());showCalibration();}};
calibrationRestart.onclick=restartCalibration;
center.onclick=()=>{if(active&&lastSample){tracker.reset();headTracker.reset(true);centering={started:performance.now(),samples:[]};
  center.disabled=true;write(metrics,'請面向前方並注視攝影機或面試畫面中央，保持約一秒。');}};
byId('gaze-reset-center').onclick=()=>{
  baseline=defaultBaseline();baselineSaved=false;centering=null;tracker.reset();headTracker.reset(true);publish(empty());
  restartCalibration();
};
document.addEventListener('visibilitychange',()=>{
  if(calibration&&!calibrated){calibration.interrupt();showCalibration();}
  tracker.reset();headTracker.reset(true);centering=null;lastSample=null;center.disabled=true;publish(empty());lastResultAt=performance.now();
});
window.addEventListener('pagehide',()=>shutdown());
publish(empty());

// The career app owns navigation and project identity; camera observations stay
// within this view and are never appended to CVs, model prompts or project history.
export function resetSession(){
  events.length=headEvents.length=0;attentionEventTotal=headEventTotal=0;frames=0;
  shutdown();loadBaseline();
}
export {shutdown as stop};
