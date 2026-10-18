// Version-pinned adapter for RealEye 1.1.0. Store fitted coefficients, never camera images.
self.RealEyeCalibrationState=(()=>{
  const schema='realeye-light-open-1.1.0/landmarker/v1';
  const expectedLength=tracker=>tracker.config.useLandmarks&&tracker.config.faceDetectorMode==='landmarker'
    ?30+2*tracker.config.eyeWidth*tracker.config.eyeHeight+1:0;
  function snapshot(tracker){
    if(!tracker.isCalibrated())return null;
    const pose=tracker.calibrationMeanHeadPose;
    return {schema,x:Array.from(tracker.coefficientsX),y:Array.from(tracker.coefficientsY),
      pose:pose?{yaw:pose.yaw,pitch:pose.pitch,roll:pose.roll}:null};
  }
  function restore(tracker,state){
    const n=expectedLength(tracker);
    if(!tracker.isReady()||!n||state?.schema!==schema)return false;
    if(![state.x,state.y].every(v=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite)))return false;
    if(state.pose!==null&&(!state.pose||!['yaw','pitch','roll'].every(k=>Number.isFinite(state.pose[k]))))return false;
    tracker.coefficientsX=state.x.slice();tracker.coefficientsY=state.y.slice();
    tracker.calibrationMeanHeadPose=state.pose?{...state.pose}:null;tracker.state='calibrated';
    return tracker.isCalibrated();
  }
  return {snapshot,restore};
})();
