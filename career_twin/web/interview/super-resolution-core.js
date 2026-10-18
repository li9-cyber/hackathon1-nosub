export const ROI=Object.freeze({x:28,y:44,width:128,height:96});
export const SR_STRENGTH=0.65;
// A GPU result belongs to the frame and audio generation that submitted it.
// Stop/new audio invalidates it even if the GPU dispatch cannot be cancelled.
export class FrameGate{
  constructor(maxAge=150){this.maxAge=maxAge;this.epoch=0;this.pending=null;}
  begin(now){if(this.pending)return null;return this.pending={epoch:this.epoch,started:now};}
  accepts(ticket,now){return this.pending===ticket&&ticket.epoch===this.epoch&&now-ticket.started<=this.maxAge;}
  finish(ticket){if(this.pending===ticket)this.pending=null;}
  reset(){this.epoch++;}
}
export function rgbaToTensor(image,roi=ROI){
  if(image.width!==184||image.height!==184||image.data.length!==184*184*4)throw new Error('Invalid mini2 input');
  const n=roi.width*roi.height,values=new Float32Array(n*3);
  for(let y=0;y<roi.height;y++)for(let x=0;x<roi.width;x++){
    const i=y*roi.width+x,p=((y+roi.y)*184+x+roi.x)*4;
    for(let c=0;c<3;c++)values[c*n+i]=image.data[p+c]/255;
  }
  return values;
}
export function tensorToRGBA(values,width=512,height=384){
  const n=width*height;if(values.length!==n*3)throw new Error('Invalid SR output');
  const rgba=new Uint8ClampedArray(n*4);
  for(let i=0;i<n;i++){for(let c=0;c<3;c++)rgba[i*4+c]=Math.round(Math.max(0,Math.min(1,values[c*n+i]))*255);rgba[i*4+3]=255;}
  return rgba;
}
export function promptBounds(prompt){
  let x0=184,y0=184,x1=-1,y1=-1,area=0;
  for(let y=0;y<184;y++)for(let x=0;x<184;x++){
    const p=(y*184+x)*4;
    if(prompt[p]>90&&prompt[p+1]<60&&prompt[p+2]<60){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);area++;}
  }
  return {x0,y0,x1,y1,area,cx:(x0+x1)/2,cy:(y0+y1)/2};
}
// Causal detail-only stabilization. Never blends an old full mouth into the new
// mouth. Motion, closures, color changes and playback cancellation reset history.
export function stabilizeDetails(sr,base,previous,bounds,width=256,height=192){
  const current=new Float32Array(sr.length),result=new Uint8ClampedArray(sr);
  for(let i=0;i<sr.length;i++)current[i]=i%4===3?0:sr[i]-base[i];
  let reused=0;
  if(previous&&bounds.area&&previous.bounds.area){
    const dx=Math.round((bounds.cx-previous.bounds.cx)*2),dy=Math.round((bounds.cy-previous.bounds.cy)*2);
    const safe=Math.abs(dx)<=3&&Math.abs(dy)<=3&&Math.abs(bounds.area/previous.bounds.area-1)<0.08;
    if(safe)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const px=x-dx,py=y-dy;if(px<0||py<0||px>=width||py>=height)continue;
      const p=(y*width+x)*4,q=(py*width+px)*4;
      if(Math.max(...[0,1,2].map(c=>Math.abs(base[p+c]-previous.base[q+c])))>10)continue;
      for(let c=0;c<3;c++)result[p+c]=base[p+c]+current[p+c]*0.85+previous.detail[q+c]*0.15;
      reused++;
    }
  }
  return {pixels:result,history:{detail:current,base:new Uint8ClampedArray(base),bounds},reused};
}
export function featherWeight(x,y,width,height,edge=12){
  const value=Math.max(0,Math.min(1,Math.min(x,y,width-1-x,height-1-y)/edge));
  return value*value*(3-2*value);
}
