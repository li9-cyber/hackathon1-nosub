import {validateDHAssets} from './dh-contract.js';
import {pcmWave} from './audio.js';
import {renderMouthQuality} from './mouth-quality.js';
import {MouthSuperResolution} from './super-resolution.js';
const $=id=>document.getElementById(id);
const notify=message=>parent.postMessage({channel:'dh-avatar',...message},location.origin);
let audio,source,epoch=0,ready=false;
let qualityFrames=0,surfacePeak=0,superResolution=null;
// Match DigitalLife's accepted default automatically, without quality controls.
window.DHPostProcess=(image,prompt)=>{
  const result=renderMouthQuality(image,prompt,'balanced','natural');
  surfacePeak=Math.max(surfacePeak,result.surface.changed_pixels);
  document.body.dataset.mouthQualityFrames=String(++qualityFrames);
  document.body.dataset.mouthSurfacePixels=String(result.surface.changed_pixels);
  document.body.dataset.mouthSurfacePeakPixels=String(surfacePeak);
};
document.body.dataset.mouthQuality='surface-v1';
function fail(error){$('avatar-status').hidden=false;$('avatar-status').textContent='Avatar could not load. Please reopen this page.';notify({type:'error',message:error.message||'Avatar unavailable'});}
async function play(bytes,id){
  const mine=++epoch;superResolution?.reset();
  audio ||= new AudioContext();await audio.resume();
  const buffer=await audio.decodeAudioData(bytes.slice(0));if(mine!==epoch)return;
  const ptr=Module._malloc(bytes.byteLength);
  try{Module.HEAPU8.set(new Uint8Array(bytes),ptr);Module._setAudioBuffer(ptr,bytes.byteLength);}finally{Module._free(ptr);}
  source=audio.createBufferSource();source.buffer=buffer;source.connect(audio.destination);
  const current=source;source.onended=()=>{if(mine!==epoch)return;superResolution?.reset();current.disconnect();source=null;notify({type:'ended',id});};
  source.start();notify({type:'playing',id});
}
function stop(){
  epoch++;superResolution?.reset();
  if(source){source.onended=null;source.stop();source.disconnect();source=null;}
  if(ready){
    const bytes=pcmWave([new Float32Array(1600)],16000),ptr=Module._malloc(bytes.byteLength);
    try{Module.HEAPU8.set(new Uint8Array(bytes),ptr);Module._setAudioBuffer(ptr,bytes.byteLength);}finally{Module._free(ptr);}
    notify({type:'ready'});
  }
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==parent||event.data?.channel!=='dh-chat')return;
  const message=event.data;
  if(message.type==='play'&&message.wav instanceof ArrayBuffer&&ready&&!source)play(message.wav,message.id).catch(fail);
  if(message.type==='stop'){try{stop();}catch(error){fail(error);}}
  if(message.type==='unlock'){audio ||= new AudioContext();audio.resume().catch(fail);}
});
window.addEventListener('pagehide',()=>{stop();superResolution?.dispose();audio?.close();});
try{
  const base=new URL('./assets',import.meta.url).href;
  const response=await window.CareerFetch(base+'/combined_data.json.gz');if(!response.ok)throw new Error('Avatar assets unavailable');
  const data=JSON.parse(pako.inflate(new Uint8Array(await response.arrayBuffer()),{to:'string'}));
  window.DH_MODEL_SIZE=validateDHAssets(data);
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('./MiniLive2.js?v=quality-surface-v1',import.meta.url).href;script.onload=resolve;script.onerror=()=>reject(new Error('Avatar runtime unavailable'));document.body.append(script);});
  CONFIG.chromaKeyEnabled=false;CONFIG.videoSrc=base+'/01.mp4';CONFIG.dataSrc=base+'/combined_data.json.gz';
  // Same fixed SR65 model, raw mini2 input and frame lifetime as DigitalLife.
  superResolution=new MouthSuperResolution(canvas_video);window.DHSuperResolution=superResolution;
  const quality=window.DHPostProcess;let rawSR=null,promptSR=null;
  window.DHPostProcess=(image,prompt)=>{
    rawSR=superResolution.canCapture?new ImageData(new Uint8ClampedArray(image.data),image.width,image.height):null;
    promptSR=rawSR?new Uint8Array(prompt):null;quality(image,prompt);
  };
  const mini2=window.processDataSet;
  window.processDataSet=async index=>{
    await mini2(index);
    if(rawSR)superResolution.submit(rawSR,promptSR,dataSets[index].rect);
  };
  await qtLoad({locateFile:path=>path.endsWith('.wasm')?new URL('./vendor/DHLiveMini.clean.wasm',import.meta.url).href:path,qt:{entryFunction:window.createQtAppInstance,containerElements:[$('screen')]}});
  await newVideoTask();validateDHAssets(data,$('canvas_video').width,$('canvas_video').height);
  ready=true;$('avatar-status').hidden=true;notify({type:'ready'});
}catch(error){fail(error);}
