'use strict';
// Browser capture only; recognition and model inference run on GCP.
class MonoPCM extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Float32Array(2048);this.used=0;}
  process(inputs){
    const mono=inputs[0]?.[0];
    if(mono)for(const value of mono){
      this.samples[this.used++]=value;
      if(this.used===this.samples.length){
        this.port.postMessage(this.samples.buffer,[this.samples.buffer]);
        this.samples=new Float32Array(2048);this.used=0;
      }
    }
    return true;
  }
}
registerProcessor('mono-pcm',MonoPCM);
