// Session calibration: measured pose remains in degrees; only classification
// uses a directional scale. This is not a physical angle/eye-gaze calibration.
export const CALIBRATION_STEPS = [
  {id:'center',label:'正視畫面中央',hint:'保持平常坐姿，正視面試畫面中央；不要刻意對準攝影機。'},
  {id:'down',label:'低頭',hint:'自然低頭約 20°，保持眼睛可見，不要低到臉部消失。'},
  {id:'up',label:'抬頭',hint:'自然抬頭約 20°，保持眼睛可見。'},
  {id:'left',label:'向左轉頭',hint:'依你本人的方向，向左自然轉頭約 25°；不要歪頭。'},
  {id:'right',label:'向右轉頭',hint:'依你本人的方向，向右自然轉頭約 25°；不要歪頭。'},
];
const keys=['head_yaw','head_pitch','head_roll','eye_x','eye_y'];
const mean=(rows,k)=>rows.reduce((sum,r)=>sum+r[k],0)/rows.length;
export function summarizeHold(rows,needEyes=false){
  const fields=needEyes?keys:keys.slice(0,3);
  if(rows.length<8 || rows.some(r=>fields.some(k=>!Number.isFinite(r[k]))))throw new Error('有效樣本不足，請保持臉部可見後重試。');
  const values=Object.fromEntries(fields.map(k=>[k,mean(rows,k)]));
  for(const k of fields){
    const deviation=Math.sqrt(mean(rows.map(r=>({[k]:(r[k]-values[k])**2})),k));
    if(deviation>(k.startsWith('eye_')?.035:3))throw new Error('動作尚未穩定，請保持姿勢後重試。');
  }
  if(Math.abs(values.head_yaw)>75 || Math.abs(values.head_pitch)>65 || Math.abs(values.head_roll)>25 ||
    (needEyes&&(Math.abs(values.eye_x)>.3||Math.abs(values.eye_y)>.3)))throw new Error('姿勢過大或眼睛不清楚，請調整坐姿／攝影機後重試。');
  return values;
}
export function directionalGain(center,hold,id){
  const vertical=id==='up'||id==='down',axis=vertical?'head_pitch':'head_yaw';
  const sign=id==='up'||id==='left'?-1:1,delta=(hold[axis]-center[axis])*sign;
  if(delta<8)throw new Error('指定方向幅度不足或方向相反，請依提示重試。');
  if(delta>(vertical?40:55) || Math.abs(hold.head_roll-center.head_roll)>12 ||
    Math.abs(hold[vertical?'head_yaw':'head_pitch']-center[vertical?'head_yaw':'head_pitch'])>15)
    throw new Error('請只做指定方向的自然動作，不要歪頭或大幅轉動。');
  return Math.max(.6,Math.min(2,(vertical?20:25)/delta));
}
export function normalizeCalibratedPose(pose,center,gains){
  if(!pose)return null;
  const yaw=pose.head_yaw-center.head_yaw,pitch=pose.head_pitch-center.head_pitch;
  return {head_yaw:yaw*(gains?.[yaw<0?'left':'right']??1),
    head_pitch:pitch*(gains?.[pitch<0?'up':'down']??1),head_roll:pose.head_roll-center.head_roll};
}
export class HeadCalibration {
  constructor(){this.index=0;this.holds={};this.gains={};this.started=null;this.rows=[];this.lastAt=null;this.error='';this.done=false;}
  get step(){return CALIBRATION_STEPS[this.index];}
  capture(now){this.started=now;this.rows=[];this.lastAt=null;this.error='';}
  interrupt(){this.started=null;this.rows=[];this.lastAt=null;this.error='取樣中斷，請保持姿勢後重試此步驟。';}
  update(pose,sample,now){
    if(this.started===null||this.done)return;
    if(now-this.started>6000){this.interrupt();this.error='取樣逾時，請確認臉部可見後重試。';return;}
    // One second to settle, then one continuous second of reliable observations.
    if(now-this.started<1000)return;
    const row=this.step.id==='center'?sample:pose;
    if(!row){this.rows=[];this.lastAt=null;return;}
    if(this.lastAt!==null&&now-this.lastAt>350)this.rows=[];
    this.lastAt=now;this.rows.push({...row,at:now});
    if(now-this.rows[0].at<1000)return;
    try{
      const id=this.step.id,hold=summarizeHold(this.rows,id==='center');
      if(id!=='center')this.gains[id]=directionalGain(this.holds.center,hold,id);
      this.holds[id]=hold;this.index++;this.done=this.index===CALIBRATION_STEPS.length;
      this.error='';
    }catch(error){this.error=error.message;}
    this.started=null;this.rows=[];this.lastAt=null;
  }
}
