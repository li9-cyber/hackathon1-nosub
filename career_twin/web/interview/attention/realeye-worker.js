importScripts(new URL('vendor/vision_bundle.js',self.location.href).href,new URL('vendor/realeye.bundle.js',self.location.href).href);
importScripts('./realeye-state.js');
// Upstream calibration logs include head pose. Keep those data in memory only.
console.log=()=>{};
let tracker=null,canvas=null,context=null,samples=[],target=null,lastSampleAt=0;
function eyesOpen(detection){
  if(!detection?.allLandmarks?.length)return false;
  const b=detection.blendshapes;
  return !b || (b.eyeBlinkLeft<.6 && b.eyeBlinkRight<.6);
}
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      const options={runningMode:'VIDEO',faceDetectorMode:'landmarker',
        modelPath:new URL('vendor/face_landmarker.task',self.location.href).href,wasmPath:new URL('vendor/wasm',self.location.href).href};
      let delegate='GPU'; // Acceleration on this computer only.
      tracker=new RealEye.WebcamETLight({...options,delegate});
      try{await tracker.initialize();}catch{
        tracker.dispose();delegate='CPU';tracker=new RealEye.WebcamETLight({...options,delegate});await tracker.initialize();
      }
      const restored=RealEyeCalibrationState.restore(tracker,data.calibrationState);
      self.postMessage({type:'ready',delegate,restored,pattern:RealEye.getCalibrationPoints(RealEye.getRecommendedPattern())});
    }else if(data.type==='reset'){
      tracker.reset();samples=[];target=null;
    }else if(data.type==='sample-target'){
      target={...data.target,start:data.timestamp,images:[]};lastSampleAt=0;
    }else if(data.type==='abandon-target'){
      target=null;
    }else if(data.type==='restore'){
      self.postMessage({type:'restored',restored:RealEyeCalibrationState.restore(tracker,data.calibrationState)});
    }else if(data.type==='finish-target'){
      const captured=target?.images||[];
      if(captured.length>=5)samples.push(...captured);
      target=null;
      self.postMessage({type:'target-finished',epoch:data.epoch,index:data.index,count:captured.length,total:samples.length});
    }else if(data.type==='train'){
      self.postMessage({type:'progress',stage:'training',samples:samples.length});
      tracker.calibrate(samples);samples=[];target=null;
      self.postMessage({type:'trained',epoch:data.epoch,trainingMs:tracker.getLastTrainingTimeMs(),
        calibrationState:RealEyeCalibrationState.snapshot(tracker)});
    }else if(data.type==='frame'){
      const started=performance.now();
      try{
        if(!canvas || canvas.width!==data.bitmap.width || canvas.height!==data.bitmap.height){
          canvas=new OffscreenCanvas(data.bitmap.width,data.bitmap.height);context=canvas.getContext('2d',{willReadFrequently:true});
        }
        context.drawImage(data.bitmap,0,0);
        const image=context.getImageData(0,0,canvas.width,canvas.height);
        const detection=tracker.detectFace(image),valid=eyesOpen(detection);
        if(valid && target && data.timestamp-target.start>=250 && target.images.length<5 && data.timestamp-lastSampleAt>=100){
          target.images.push({image,gazeX:target.x,gazeY:target.y});lastSampleAt=data.timestamp;
        }
        // Attention uses the already-computed pose and iris landmarks, without
        // fitting or evaluating a screen-coordinate model.
        self.postMessage({type:'result',points:detection?.allLandmarks||null,valid,
          headPose:detection?.headPose||null,poseMatrix:detection?.transformationMatrix||null,
          sampleCount:target?.images.length||0,timestamp:data.timestamp,inferenceMs:performance.now()-started});
      }finally{data.bitmap.close();}
    }
  }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
};
