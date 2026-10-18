export function pcmWave(chunks,rate){
  const count=chunks.reduce((n,c)=>n+c.length,0),buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);
  const label=(offset,text)=>{for(let i=0;i<text.length;i++)v.setUint8(offset+i,text.charCodeAt(i));};
  label(0,'RIFF');v.setUint32(4,36+count*2,true);label(8,'WAVE');label(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);label(36,'data');v.setUint32(40,count*2,true);
  let offset=44;for(const chunk of chunks)for(const sample of chunk){const value=Math.max(-1,Math.min(1,sample));v.setInt16(offset,Math.round(value*(value<0?32768:32767)),true);offset+=2;}return buffer;
}
export function encode64(buffer){const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
export function decode64(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0)).buffer;}

// Capture at the device's native rate, then reduce only the submitted utterance.
// Weighted averaging also handles non-integer ratios such as 44100 -> 16000.
export function speechWave(chunks,rate){
  if(rate===16000)return pcmWave(chunks,rate);
  const count=chunks.reduce((n,c)=>n+c.length,0),source=new Float32Array(count);
  let offset=0;for(const chunk of chunks){source.set(chunk,offset);offset+=chunk.length;}
  const ratio=rate/16000,result=new Float32Array(Math.floor(count/ratio));
  for(let i=0;i<result.length;i++){
    const end=Math.min((i+1)*ratio,count);let position=i*ratio,sum=0;
    while(position<end){const index=Math.floor(position),next=Math.min(index+1,end);sum+=source[index]*(next-position);position=next;}
    result[i]=sum/ratio;
  }
  return pcmWave([result],16000);
}

export function microphoneError(error){
  const messages={
    NotAllowedError:'Allow microphone access for this page in your browser, then try again.',
    NotFoundError:'No microphone was found. Connect or enable a microphone, then refresh the device list.',
    NotReadableError:'The microphone could not open. Select an available input below and close other apps using it before retrying.',
    AbortError:'The microphone could not start. Check the selected input and try again.',
    OverconstrainedError:'The selected microphone is unavailable. Refresh the device list and select it again.',
    SecurityError:'Microphone access is disabled for this page.'
  };
  return `${messages[error.name]||error.message} (${error.name||'Microphone error'})`;
}

// Endpoint detection only. Google performs speech recognition on the resulting WAV.
export class SpeechDetector {
  constructor(rate,{silence=.9,maxSeconds=60,manual=false}={}){this.rate=rate;this.silence=silence;this.maxSeconds=maxSeconds;this.manual=manual;this.reset();}
  reset(){this.chunks=[];this.pre=[];this.preCount=0;this.count=0;this.voiced=0;this.quiet=0;this.active=false;this.confirmed=false;this.started=false;this.run=0;this.gap=0;this.interrupting=false;}
  push(samples,interrupting=false){
    this.started=false;
    const rms=Math.sqrt(samples.reduce((sum,s)=>sum+s*s,0)/samples.length),voice=rms>.01;
    if(!this.active){this.pre.push(samples);this.preCount+=samples.length;while(this.preCount>this.rate*.4&&this.pre.length>1)this.preCount-=this.pre.shift().length;if(!voice)return null;this.active=true;this.chunks=this.pre;this.count=this.preCount;this.pre=[];this.preCount=0;}
    else{samples=samples.subarray(0,Math.max(0,this.rate*this.maxSeconds-this.count));this.chunks.push(samples);this.count+=samples.length;}
    if(voice){this.voiced+=samples.length;this.quiet=0;}else{this.quiet+=samples.length;}
    // Keep the stronger gate for this whole candidate, even if the reply ends
    // before the noise does. It must pass this gate before being uploaded too.
    if(!this.confirmed&&interrupting&&!this.interrupting){this.interrupting=true;this.run=0;this.gap=0;}
    const level=this.interrupting ? .025 : .01,duration=this.interrupting ? .32 : .14;
    if(rms>level){this.run+=samples.length;this.gap=0;}
    else{this.gap+=samples.length;if(this.gap>this.rate*.08)this.run=0;}
    // Brief unvoiced consonants may bridge loud syllables. Idle speech keeps
    // its lower gate, so raising the interruption threshold won't hide it.
    if(!this.confirmed&&this.run>=this.rate*duration){this.confirmed=true;this.started=true;}
    if((!this.manual&&this.quiet>=this.rate*this.silence)||this.count>=this.rate*this.maxSeconds){
      return this.finish();
    }
    return null;
  }
  finish(){
      let result=null;
      if(this.confirmed&&this.voiced>=this.rate*.22){
        // Recognition needs a little trailing silence, not the whole endpoint wait.
        let keep=this.count-Math.max(0,this.quiet-this.rate*.2);result=[];
        for(const chunk of this.chunks){if(keep<=0)break;result.push(chunk.subarray(0,keep));keep-=chunk.length;}
      }
      this.reset();return result;
  }
}

export class ConversationMic {
  constructor(onSpeech,onLevel,{deviceId='',onStatus=()=>{},onEnded=()=>{},onSpeechStart=()=>{},isInterrupting=()=>false,detectorOptions={}}={}){this.onSpeech=onSpeech;this.onLevel=onLevel;this.deviceId=deviceId;this.onStatus=onStatus;this.onEnded=onEnded;this.onSpeechStart=onSpeechStart;this.isInterrupting=isInterrupting;this.detectorOptions=detectorOptions;this.closed=false;this.listening=false;}
  async start(){
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access requires HTTPS or localhost.');
      // Resume inside the click gesture; never force the hardware to use 16 kHz.
      // Metering/recognition needs a clock, not a physical speaker. A silent
      // sink avoids opening the default output driver's processing chain.
      const contextOptions={latencyHint:'interactive'};
      if('sinkId' in AudioContext.prototype)contextOptions.sinkId={type:'none'};
      this.context=new AudioContext(contextOptions);
      const resumed=this.context.resume();resumed.catch(()=>{});
      const selected=this.deviceId?{deviceId:{exact:this.deviceId}}:{};
      this.onStatus('Opening microphone… Allow access if your browser asks.');
      try{
        this.stream=await navigator.mediaDevices.getUserMedia({audio:{...selected,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      }catch(error){
        if(this.closed||!['NotReadableError','OverconstrainedError'].includes(error.name))throw error;
        this.onStatus('Retrying the same microphone without audio processing…');
        this.stream=await navigator.mediaDevices.getUserMedia({audio:{...selected,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      }
      if(this.closed){this.stream.getTracks().forEach(t=>t.stop());return;}
      await resumed;if(this.closed)return;
      await this.context.audioWorklet.addModule(new URL('./pcm-worklet.js',import.meta.url).href);if(this.closed)return;
      this.track=this.stream.getAudioTracks()[0];
      this.track.onended=()=>{if(!this.closed){this.close();this.onEnded(new Error('Microphone disconnected. Select an available input and try again.'));}};
      this.detector=new SpeechDetector(this.context.sampleRate,this.detectorOptions);
      this.input=this.context.createMediaStreamSource(this.stream);this.node=new AudioWorkletNode(this.context,'mono-pcm',{channelCount:1,channelCountMode:'explicit'});
      this.silent=this.context.createGain();this.silent.gain.value=0;
      this.node.port.onmessage=e=>{
        if(!this.listening||this.closed)return;
        const samples=new Float32Array(e.data),rms=Math.sqrt(samples.reduce((sum,s)=>sum+s*s,0)/samples.length);
        // A local check meters samples only: no utterance buffer or upload.
        const utterance=this.onSpeech?this.detector.push(samples,this.isInterrupting()):null;
        this.onLevel(this.detector.confirmed,rms);
        if(this.detector.started)this.onSpeechStart();
        if(utterance)this.onSpeech(encode64(speechWave(utterance,this.context.sampleRate)));
      };
      this.input.connect(this.node).connect(this.silent).connect(this.context.destination);
    }catch(error){this.close();throw error;}
  }
  resume(){if(this.closed||this.listening)return;this.detector?.reset();this.listening=true;}
  pause(){this.listening=false;this.detector?.reset();}
  finish(){
    if(this.closed||!this.listening||!this.onSpeech)return false;
    const utterance=this.detector?.finish();
    if(!utterance)return false;
    this.pause();this.onLevel(false,0);
    this.onSpeech(encode64(speechWave(utterance,this.context.sampleRate)));
    return true;
  }
  close(){if(this.closed)return;this.closed=true;this.pause();if(this.track)this.track.onended=null;this.stream?.getTracks().forEach(t=>t.stop());this.input?.disconnect();this.node?.disconnect();if(this.node)this.node.port.onmessage=null;this.silent?.disconnect();this.context?.close().catch(()=>{});}
}
