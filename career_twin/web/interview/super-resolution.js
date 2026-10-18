import {ROI,SR_STRENGTH,FrameGate,rgbaToTensor,tensorToRGBA,promptBounds,stabilizeDetails,featherWeight} from './super-resolution-core.js';

const ASSETS=new URL('./vendor/sr-20261002-v1/',import.meta.url).href;
const makeCanvas=(w=1,h=1)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const median=values=>values.length?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]:null;
function loadRuntime(){
  if(window.ort)return Promise.resolve(window.ort);
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=ASSETS+'ort.webgpu.min.js';
    script.onload=()=>resolve(window.ort);script.onerror=()=>reject(new Error('runtime-unavailable'));
    document.head.append(script);
  });
}

export class MouthSuperResolution{
  constructor(source){
    this.source=source;this.output=makeCanvas();this.output.className='sr-output';this.output.hidden=true;
    source.parentElement.append(this.output);this.gate=new FrameGate(150);this.history=null;
    this.ready=false;this.disposed=false;this.session=null;
    this.frame=makeCanvas();this.raw=makeCanvas(184,184);this.base=makeCanvas(256,192);
    this.native=makeCanvas(512,384);this.patch=makeCanvas(256,192);
    this.metrics={mode:'loading',strength:SR_STRENGTH,requested_provider:'webgpu',backend:'not-started',frames:0,skipped_busy:0,
      cancelled_results:0,stale_results:0,sr_samples:[],display_times:[],resets:0};
    this.mark('loading');
    this.hide=()=>{if(document.hidden)this.reset();};document.addEventListener('visibilitychange',this.hide);
    this.init().catch(error=>this.fallback(error.message));
  }
  mark(mode){this.metrics.mode=mode;document.body.dataset.superResolution=mode;
    document.body.dataset.superResolutionStrength=String(SR_STRENGTH);}
  get canCapture(){return this.ready&&!this.disposed&&!this.gate.pending&&!document.hidden;}
  summary(){const times=this.metrics.display_times;return {...this.metrics,sr_ms_median:median(this.metrics.sr_samples),
    displayed_fps:times.length>1?(times.length-1)*1000/(times.at(-1)-times[0]):null,busy:!!this.gate.pending};}
  reset(){this.gate.reset();this.history=null;this.metrics.resets++;
    this.output.hidden=true;this.source.hidden=false;}
  fallback(reason){this.ready=false;this.reset();this.metrics.reason=reason;this.metrics.backend='mini2';this.mark('fallback');
    if(this.session&&!this.gate.pending){this.session.release().catch(()=>{});this.session=null;}}
  async init(){
    const started=performance.now();
    if(!navigator.gpu){this.fallback('webgpu-unavailable');return;}
    const adapter=await navigator.gpu.requestAdapter();
    if(!adapter){this.fallback('adapter-unavailable');return;}
    const fallback=adapter.info.isFallbackAdapter??adapter.isFallbackAdapter??false;
    if(fallback){this.fallback('software-adapter');return;}
    this.metrics.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,isFallbackAdapter:fallback};
    this.metrics.precision=adapter.features.has('shader-f16')?'float16':'float32';
    const ort=await loadRuntime();this.ort=ort;ort.env.wasm.wasmPaths=ASSETS;ort.env.wasm.numThreads=1;
    const name=this.metrics.precision==='float16'?'general-mouth-fp16.onnx':'general-mouth.onnx';
    this.session=await ort.InferenceSession.create(ASSETS+name,{executionProviders:['webgpu'],graphOptimizationLevel:'all'});
    if(this.disposed){this.fallback('disposed');return;}
    const input=new ort.Tensor('float32',new Float32Array(3*96*128),[1,3,96,128]);
    try{for(let i=0;i<3;i++){const result=await this.session.run({input});result.output.dispose();}}
    finally{input.dispose();}
    if(this.disposed){this.fallback('disposed');return;}
    this.ready=true;this.metrics.backend='webgpu';this.metrics.init_ms=performance.now()-started;this.mark('ready');
  }
  submit(image,prompt,rect){
    if(!this.canCapture){if(this.gate.pending)this.metrics.skipped_busy++;return;}
    const ticket=this.gate.begin(performance.now());
    if(this.frame.width!==this.source.width||this.frame.height!==this.source.height){this.frame.width=this.source.width;this.frame.height=this.source.height;}
    this.frame.getContext('2d').drawImage(this.source,0,0);
    this.run(image,prompt,[...rect],ticket).catch(error=>this.fallback(error.message));
  }
  async run(image,prompt,rect,ticket){
    const input=new this.ort.Tensor('float32',rgbaToTensor(image),[1,3,96,128]);let result;
    // A driver that never resolves must not leave a frozen SR mouth on screen.
    // The original renderer continues independently and can remain responsive.
    const deadline=setTimeout(()=>{
      if(this.gate.pending===ticket&&ticket.epoch===this.gate.epoch){
        this.metrics.stale_results++;this.fallback('device-too-slow');
      }
    },this.gate.maxAge);
    try{
      const started=performance.now();result=await this.session.run({input});
      const values=result.output.data,ms=performance.now()-started;
      if(ticket.epoch!==this.gate.epoch||this.disposed){this.metrics.cancelled_results++;return;}
      if(!this.gate.accepts(ticket,performance.now())){
        this.metrics.stale_results++;this.fallback('device-too-slow');return;
      }
      this.compose(image,prompt,rect,values);
      this.metrics.frames++;this.metrics.sr_samples.push(ms);this.metrics.display_times.push(performance.now());
      if(this.metrics.sr_samples.length>120)this.metrics.sr_samples.shift();
      if(this.metrics.display_times.length>120)this.metrics.display_times.shift();
      this.mark('active');document.body.dataset.superResolutionFrames=String(this.metrics.frames);
    }finally{
      clearTimeout(deadline);
      result?.output.dispose();input.dispose();this.gate.finish(ticket);
      if(!this.ready&&this.session){this.session.release().catch(()=>{});this.session=null;}
    }
  }
  compose(image,prompt,rect,values){
    this.raw.getContext('2d').putImageData(image,0,0);
    const baseCtx=this.base.getContext('2d',{willReadFrequently:true});baseCtx.imageSmoothingQuality='high';
    baseCtx.drawImage(this.raw,ROI.x,ROI.y,ROI.width,ROI.height,0,0,256,192);
    const base=baseCtx.getImageData(0,0,256,192).data;
    this.native.getContext('2d').putImageData(new ImageData(tensorToRGBA(values),512,384),0,0);
    const ctx=this.patch.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
    // Clear the previous feathered alpha before drawing this fully opaque result.
    ctx.clearRect(0,0,256,192);ctx.drawImage(this.native,0,0,256,192);
    const restored=ctx.getImageData(0,0,256,192),stable=stabilizeDetails(restored.data,base,this.history,promptBounds(prompt));
    this.history=stable.history;
    for(let y=0;y<192;y++)for(let x=0;x<256;x++){
      const p=(y*256+x)*4,q=((ROI.y+Math.floor(y/2))*184+ROI.x+Math.floor(x/2))*4;
      restored.data[p]=stable.pixels[p];restored.data[p+1]=stable.pixels[p+1];restored.data[p+2]=stable.pixels[p+2];
      restored.data[p+3]=Math.round(image.data[q+3]*featherWeight(x,y,256,192)*SR_STRENGTH);
    }
    ctx.putImageData(restored,0,0);
    if(this.output.width!==this.frame.width*2||this.output.height!==this.frame.height*2){this.output.width=this.frame.width*2;this.output.height=this.frame.height*2;}
    const target=this.output.getContext('2d');target.drawImage(this.frame,0,0,this.output.width,this.output.height);
    const [x0,y0,x1]=rect,scale=(x1-x0)/184;
    target.drawImage(this.patch,(x0+ROI.x*scale)*2,(y0+ROI.y*scale)*2,ROI.width*scale*2,ROI.height*scale*2);
    this.source.hidden=true;this.output.hidden=false;
  }
  dispose(){this.disposed=true;this.fallback('disposed');document.removeEventListener('visibilitychange',this.hide);this.output.remove();}
}
