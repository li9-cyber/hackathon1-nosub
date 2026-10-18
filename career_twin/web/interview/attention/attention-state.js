// Explainable interview attention heuristics. These are not gaze angles or
// calibrated screen coordinates. All directions are from the person's view.
export const ATTENTION_THRESHOLDS=Object.freeze({
  headYawNeutral:15,headPitchNeutral:12,eyeNeutral:.10,
  eyeYawGain:100,eyePitchGain:90,horizontal:16,down:14,up:14,
  extremeYaw:55,extremePitch:45,smoothingAlpha:.35,
  debounceMs:700,awayEventMs:2200,missingGraceMs:350,maxFrameGapMs:350,
  awayReturnGraceMs:450,awayMissingGraceMs:350,
  defaultEyeY:.035,
});
const awayStates=new Set(['left','right','down','away']);
const finite=Number.isFinite;
export const INTERVIEW_HEAD_THRESHOLDS=Object.freeze({
  yaw:12,roll:12,pitch:10,nodYaw:10,nodRoll:8,nodPitch:25,nodReturnPitch:8,
  nodMaxMs:1200,motionDebounceMs:400,neutralResetMs:300,
  movementWindowMs:3000,yawTravel:45,rollTravel:35,minYawRange:12,minRollRange:10,
  travelNoise:2,smoothingAlpha:.35,maxFrameGapMs:350,
});

// Reuse RealEye's existing MediaPipe pose matrix, without another estimator.
// RealEye 1.1.0 groups MediaPipe's column-major data into rows and misnames
// Euler axes. Its row 2 is the camera-space forward axis of the actual matrix.
// Reading that axis directly also avoids roll being treated as yaw.
// MediaPipe metric Y points up; camera image X points to the person's left.
export function normalizeHeadPose(matrix) {
  if(!Array.isArray(matrix) || matrix.length!==4 ||
    matrix.some(row=>!Array.isArray(row) || row.length!==4 || !row.every(finite)))return null;
  const [x,y,z]=matrix[2],length=Math.hypot(x,y,z);
  if(length<.5 || length>2)return null;
  const degrees=180/Math.PI;
  return {head_yaw:-Math.atan2(x,z)*degrees,
    head_pitch:-Math.atan2(y,Math.hypot(x,z))*degrees,
    head_roll:Math.atan2(matrix[0][1],matrix[0][0])*degrees};
}

export function calculate_attention_state(head_yaw,head_pitch,eye_x,eye_y,thresholds=ATTENTION_THRESHOLDS) {
  const values={head_yaw,head_pitch,eye_x,eye_y};
  const result=(state,confidence)=>({state,...Object.fromEntries(Object.entries(values)
    .map(([k,v])=>[k,finite(v)?v:null])),confidence});
  if(!Object.values(values).every(finite) || Math.abs(head_yaw)>180 ||
    Math.abs(head_pitch)>90 || Math.abs(eye_x)>.5 || Math.abs(eye_y)>.5)return result('unknown',0);
  const t=thresholds,x=head_yaw+eye_x*t.eyeYawGain,y=head_pitch+eye_y*t.eyePitchGain;
  // Very large rotations cannot be reliably cancelled by a small visible iris.
  if(Math.abs(head_yaw)>=t.extremeYaw || Math.abs(head_pitch)>=t.extremePitch)return result('away',.65);
  const horizontal=Math.abs(x)>=t.horizontal &&
    (Math.abs(head_yaw)>t.headYawNeutral || Math.abs(eye_x)>t.eyeNeutral);
  const vertical=y>=t.down && (head_pitch>t.headPitchNeutral || eye_y>t.eyeNeutral);
  const upward=y<=-t.up && (head_pitch<-t.headPitchNeutral || eye_y<-t.eyeNeutral);
  let state='forward';
  if(upward || (horizontal && vertical))state='away';
  else if(vertical)state='down';
  else if(horizontal)state=x>0?'right':'left';
  // A modest quality indicator, not a probability or an attention score.
  const agrees=state==='down'?head_pitch>t.headPitchNeutral && eye_y>t.eyeNeutral:
    horizontal && Math.sign(head_yaw)===Math.sign(eye_x) && Math.abs(eye_x)>t.eyeNeutral;
  return result(state,state==='forward'?.8:agrees?.85:.7);
}

export class AttentionTracker {
  constructor(thresholds=ATTENTION_THRESHOLDS){this.thresholds=thresholds;this.reset();}
  reset(){
    this.smooth=null;this.state='unknown';this.pending=null;this.pendingAt=0;
    this.lastAt=null;this.lastValidAt=null;this.awayAt=null;this.awayRecorded=false;
    this.awayEvidenceMs=0;this.awayBreakAt=null;this.awayBreakKind=null;this.previousAway=false;
  }
  clearAway(){
    this.awayAt=null;this.awayRecorded=false;this.awayEvidenceMs=0;
    this.awayBreakAt=null;this.awayBreakKind=null;this.previousAway=false;
  }
  trackAway(rawState,timestamp,elapsed){
    const t=this.thresholds,isAway=awayStates.has(rawState);
    const grace=this.awayBreakKind==='unknown'?t.awayMissingGraceMs:t.awayReturnGraceMs;
    if(this.awayBreakAt!==null && timestamp-this.awayBreakAt>=grace)this.clearAway();
    if(isAway){
      if(this.awayAt===null)this.awayAt=timestamp;
      // Only intervals bounded by two reliable away observations add time.
      // A blink or brief forward reading pauses, without erasing prior evidence.
      if(this.previousAway)this.awayEvidenceMs+=elapsed;
      this.awayBreakAt=null;this.awayBreakKind=null;this.previousAway=true;
    }else{
      if(rawState==='forward' && this.awayEvidenceMs<t.debounceMs)this.clearAway();
      if(this.awayAt!==null && this.awayBreakAt===null){this.awayBreakAt=timestamp;this.awayBreakKind=rawState;}
      this.previousAway=false;
    }
    return {away_duration_ms:this.awayEvidenceMs,away_recorded:this.awayRecorded,
      away_status:this.awayAt===null?(rawState==='unknown'?'unknown':'forward'):isAway?'tracking':'paused'};
  }
  update(sample,timestamp) {
    const t=this.thresholds;
    if(!finite(timestamp))return {...calculate_attention_state(null,null,null,null),attention_event:null};
    if(this.lastAt!==null && (timestamp<this.lastAt || timestamp-this.lastAt>t.maxFrameGapMs))this.reset();
    const elapsed=this.lastAt===null?0:timestamp-this.lastAt;
    this.lastAt=timestamp;
    const raw=calculate_attention_state(sample?.head_yaw,sample?.head_pitch,sample?.eye_x,sample?.eye_y,t);
    const episode=this.trackAway(raw.state,timestamp,elapsed);
    if(raw.state==='unknown'){
      // Unknown observations never add evidence or trigger a new event.
      this.pending=null;
      if(this.lastValidAt===null || timestamp-this.lastValidAt>=t.missingGraceMs){this.state='unknown';this.smooth=null;}
      return {...raw,...episode,state:this.state,raw_state:'unknown',attention_event:null};
    }
    this.lastValidAt=timestamp;
    this.smooth=Object.fromEntries(['head_yaw','head_pitch','eye_x','eye_y'].map(k=>
      [k,this.smooth?this.smooth[k]*(1-t.smoothingAlpha)+sample[k]*t.smoothingAlpha:sample[k]]));
    const classified=calculate_attention_state(this.smooth.head_yaw,this.smooth.head_pitch,this.smooth.eye_x,this.smooth.eye_y,t);
    if(classified.state===this.state)this.pending=null;
    else if(this.pending!==classified.state){this.pending=classified.state;this.pendingAt=timestamp;}
    else if(timestamp-this.pendingAt>=t.debounceMs){this.state=this.pending;this.pending=null;}
    let attention_event=null;
    // Direction changes must not block a reliable, sustained away episode.
    // Still require a current away observation, excluding a smoothed glance tail.
    if(!this.awayRecorded && awayStates.has(raw.state) && this.awayEvidenceMs>=t.awayEventMs){
      attention_event={type:'attention-away',state:awayStates.has(this.state)?this.state:raw.state,started_at:this.awayAt,
        timestamp,duration_ms:this.awayEvidenceMs,elapsed_ms:timestamp-this.awayAt};this.awayRecorded=true;
    }
    return {...classified,...episode,away_recorded:this.awayRecorded,state:this.state,
      confidence:this.state===classified.state?classified.confidence:0,
      raw_state:raw.state,attention_event};
  }
}

// Interview practice posture is independent of gaze: eye compensation may
// preserve forward gaze while head turns are still recorded as head movement.
export class InterviewHeadTracker {
  constructor(thresholds=INTERVIEW_HEAD_THRESHOLDS){this.thresholds=thresholds;this.reset();}
  reset(keepTotals=false){
    this.nonNodMs=keepTotals?this.nonNodMs||0:0;
    this.lastAt=null;this.smooth=null;this.history=[];this.pitchAt=null;
    this.pending=null;this.pendingAt=0;this.recorded=null;this.neutralAt=null;this.lastFrequentAt=null;
  }
  update(pose,timestamp){
    const t=this.thresholds;
    const unknown=()=>({state:'unknown',events:[],non_nod_ms:this.nonNodMs,nod_allowed:false,
      head_yaw:null,head_pitch:null,head_roll:null,yaw_travel:0,roll_travel:0});
    if(!finite(timestamp))return unknown();
    if(!pose || !['head_yaw','head_pitch','head_roll'].every(k=>finite(pose[k])) ||
      Math.abs(pose.head_yaw)>180 || Math.abs(pose.head_pitch)>90 || Math.abs(pose.head_roll)>180){
      this.reset(true);return unknown();
    }
    if(this.lastAt!==null && (timestamp<this.lastAt || timestamp-this.lastAt>t.maxFrameGapMs))this.reset(true);
    const elapsed=this.lastAt===null?0:timestamp-this.lastAt;this.lastAt=timestamp;
    this.smooth=Object.fromEntries(['head_yaw','head_pitch','head_roll'].map(k=>
      [k,this.smooth?this.smooth[k]*(1-t.smoothingAlpha)+pose[k]*t.smoothingAlpha:pose[k]]));
    const {head_yaw:yaw,head_pitch:pitch,head_roll:roll}=this.smooth;
    this.history.push({timestamp,yaw,roll});
    this.history=this.history.filter(p=>timestamp-p.timestamp<=t.movementWindowMs);
    const travel=axis=>{
      let anchor=this.history[0][axis],distance=0;
      for(const p of this.history){const step=Math.abs(p[axis]-anchor);if(step>=t.travelNoise){distance+=step;anchor=p[axis];}}
      const values=this.history.map(p=>p[axis]);
      return {distance,range:Math.max(...values)-Math.min(...values)};
    };
    const yawTravel=travel('yaw'),rollTravel=travel('roll');
    const frequent=(yawTravel.distance>=t.yawTravel && yawTravel.range>=t.minYawRange) ||
      (rollTravel.distance>=t.rollTravel && rollTravel.range>=t.minRollRange);
    let state='neutral';
    if(Math.abs(yaw)>=t.yaw){state=yaw>0?'right-turn':'left-turn';this.pitchAt=null;}
    else if(Math.abs(roll)>=t.roll){state=roll>0?'right-tilt':'left-tilt';this.pitchAt=null;}
    else{
      if(Math.abs(pitch)<=t.nodReturnPitch)this.pitchAt=null;
      if(Math.abs(pitch)>t.pitch && this.pitchAt===null)this.pitchAt=timestamp;
      if(this.pitchAt!==null){
        const nod=Math.abs(yaw)<=t.nodYaw && Math.abs(roll)<=t.nodRoll && Math.abs(pitch)<=t.nodPitch &&
          timestamp-this.pitchAt<t.nodMaxMs;
        state=nod?'nodding':pitch>=0?'sustained-down':'sustained-up';
      }
    }
    const motion=!['neutral','nodding'].includes(state),events=[];
    if(motion){
      this.neutralAt=null;this.nonNodMs+=elapsed;
      if(this.pending!==state){this.pending=state;this.pendingAt=timestamp;}
      if(timestamp-this.pendingAt>=t.motionDebounceMs && this.recorded!==state){
        events.push({type:'head-movement',reason:state,started_at:this.pendingAt,timestamp,
          duration_ms:timestamp-this.pendingAt});this.recorded=state;
      }
    }else{
      this.pending=null;
      if(this.neutralAt===null)this.neutralAt=timestamp;
      if(timestamp-this.neutralAt>=t.neutralResetMs)this.recorded=null;
    }
    // Cumulative yaw/roll travel catches changing directions too fast to pass
    // the per-direction debounce. Pitch travel is excluded so nods are allowed.
    if(frequent && (this.lastFrequentAt===null || timestamp-this.lastFrequentAt>=t.movementWindowMs)){
      events.push({type:'head-movement',reason:'frequent-head-movement',
        started_at:this.history[0].timestamp,timestamp,duration_ms:timestamp-this.history[0].timestamp,
        yaw_travel:yawTravel.distance,roll_travel:rollTravel.distance});this.lastFrequentAt=timestamp;
    }
    return {state:frequent?'frequent-head-movement':state,events,non_nod_ms:this.nonNodMs,
      nod_allowed:state==='nodding'&&!frequent,head_yaw:yaw,head_pitch:pitch,head_roll:roll,
      yaw_travel:yawTravel.distance,roll_travel:rollTravel.distance};
  }
}
