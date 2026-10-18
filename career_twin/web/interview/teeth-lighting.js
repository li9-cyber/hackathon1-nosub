// Tone only the existing model output inside its matching tooth geometry.
// No pasted teeth, generated dividers, or changes to the accepted lip filter.
export const teethTreatments=Object.freeze({
  off:Object.freeze({label:'Off · accepted lips only',strength:0,maxCorrection:0}),
  soft:Object.freeze({label:'Soft · subtle tooth shade',strength:0.65,maxCorrection:10}),
  natural:Object.freeze({label:'Natural · reduce flat white band',strength:1.6,maxCorrection:16})
});

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const smooth=v=>{const t=clamp(v,0,1);return t*t*(3-2*t);};

export function applyTeethLighting(image,prompt,mode='off'){
  if(!Object.hasOwn(teethTreatments,mode))throw new Error('Unknown tooth treatment');
  const {width:w,height:h,data}=image;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<3||h<3||data.length!==w*h*4)
    throw new Error('Invalid tooth image');
  const result={mode,geometry_pixels:0,changed_pixels:0,max_rgb_correction:0};
  if(mode==='off'||!prompt)return result;
  if(prompt.length!==data.length)throw new Error('Tooth prompt does not match this frame');
  const {strength,maxCorrection}=teethTreatments[mode];
  const original=new Uint8ClampedArray(data),mask=new Uint8Array(w*h),luma=new Float32Array(w*h);
  const top=new Int32Array(w).fill(h),bottom=new Int32Array(w).fill(-1);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,p=i*4;
    // Upper teeth are pure green and lower teeth pure blue in the existing GL
    // prompt. The original readPixels byte order matches the model crop; the
    // displayed GL canvas is vertically inverted and must not be used here.
    const tooth=prompt[p]<60&&((prompt[p+1]>200&&prompt[p+2]<60)||(prompt[p+2]>200&&prompt[p+1]<60));
    if(!tooth)continue;
    mask[i]=1;top[x]=Math.min(top[x],y);bottom[x]=Math.max(bottom[x],y);result.geometry_pixels++;
    luma[i]=original[p]*0.299+original[p+1]*0.587+original[p+2]*0.114;
  }
  if(!result.geometry_pixels)return result;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,p=i*4;if(!mask[i])continue;
    const r=original[p],g=original[p+1],b=original[p+2],value=luma[i];
    // Leave reddish lip/gum pixels and the dark oral cavity unchanged, even
    // where approximate geometry overlaps them.
    const neutral=smooth((28-(r-Math.max(g,b)))/12)*smooth((55-(Math.max(r,g,b)-Math.min(r,g,b)))/25);
    const light=smooth((value-85)/45);
    let sum=0,count=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const j=clamp(y+dy,0,h-1)*w+clamp(x+dx,0,w-1);
      if(mask[j]){sum+=luma[j];count++;}
    }
    const coverage=0.4+0.6*count/9;
    const depth=(y-top[x]+0.5)/(bottom[x]-top[x]+1);
    const shade=6+8*smooth((value-110)/70)+4*(1-depth);
    const detail=clamp((value-sum/count)*0.3,-3,3);
    // Compression always reduces glare; local existing variations remain.
    // Apply one integer offset to RGB so hue and alpha remain identical.
    const delta=Math.round(clamp(strength*(detail-shade)*neutral*light*coverage,
      Math.max(-maxCorrection,-Math.min(r,g,b)),0));
    if(!delta)continue;
    for(let c=0;c<3;c++)data[p+c]=original[p+c]+delta;
    result.changed_pixels++;result.max_rgb_correction=Math.max(result.max_rgb_correction,-delta);
  }
  return result;
}
