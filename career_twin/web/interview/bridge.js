export class AvatarVoice {
  constructor(frame,onState){
    this.frame=frame;this.onState=onState;this.ready=false;this.pending=null;this.waiters=[];
    this.onMessage=e=>{
      if(e.origin!==location.origin||e.source!==frame.contentWindow||e.data?.channel!=='dh-avatar')return;
      const m=e.data;
      if(m.type==='ready'){this.ready=true;this.resetting=false;this.waiters.splice(0).forEach(w=>w.resolve());this.onState('ready');}
      if(m.type==='playing'&&m.id===this.pending?.id){const start=this.pending.onStart;this.pending.onStart=null;start?.();this.onState('speaking');}
      if(m.type==='ended'&&m.id===this.pending?.id){clearTimeout(this.pending.timer);this.pending.resolve();this.pending=null;}
      if(m.type==='error'){const error=new Error(m.message);if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}this.waiters.splice(0).forEach(w=>w.reject(error));this.onState('error',error);}
    };
    window.addEventListener('message',this.onMessage);
  }
  dispose(){this.stop();window.removeEventListener('message',this.onMessage);this.waiters.splice(0).forEach(w=>w.reject(new DOMException('Cancelled','AbortError')));}
  post(message,transfer=[]){this.frame.contentWindow.postMessage({channel:'dh-chat',...message},location.origin,transfer);}
  unlock(){this.post({type:'unlock'});}
  async whenReady(){
    if(this.ready)return;
    await new Promise((resolve,reject)=>{
      const waiter={resolve:()=>{clearTimeout(timer);resolve();},reject:e=>{clearTimeout(timer);reject(e);}};
      const timer=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==waiter);reject(new Error('Avatar is taking too long to load. Refresh the page.'));},30000);
      this.waiters.push(waiter);
    });
  }
  async play(wav,signal,onStart){
    await this.whenReady();if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    if(this.pending)throw new Error('Avatar audio is already playing');
    return new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),abort=()=>{if(this.pending?.id===id)this.stop();};
      signal.addEventListener('abort',abort,{once:true});
      const cleanup=callback=>value=>{signal.removeEventListener('abort',abort);callback(value);};
      this.pending={id,onStart,resolve:cleanup(resolve),reject:cleanup(reject),timer:setTimeout(()=>{this.stop(new Error('Audio playback timed out.'));},120000)};
      this.post({type:'play',id,wav},[wav]);
    });
  }
  stop(error=new DOMException('Cancelled','AbortError')){
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}
    if(this.resetting)return;
    this.resetting=true;
    this.ready=false;this.post({type:'stop'});
  }
}

export async function* readEvents(response){
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try{while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.trim())yield JSON.parse(line);}if(buffer.length>6000000)throw new Error('Response is too large');if(done)break;}if(buffer.trim())yield JSON.parse(buffer);}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
