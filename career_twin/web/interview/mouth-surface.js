// Preserve accepted lip/skin sharpening, but use the unsharpened neural output
// inside teeth and the lip-enclosed oral cavity. No texture or tooth dividers.
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const isLip=(prompt,p)=>prompt[p]>90&&prompt[p+1]<60&&prompt[p+2]<60;
const toothType=(prompt,p)=>prompt[p]<60?
  prompt[p+1]>200&&prompt[p+2]<60?1:prompt[p+2]>200&&prompt[p+1]<60?2:0:0;

export function smoothMouthInterior(image,raw,prompt){
  const {width:w,height:h,data}=image;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<3||h<3||data.length!==w*h*4||raw.length!==data.length)
    throw new Error('Invalid mouth surface image');
  const result={enabled:!!prompt,interior_pixels:0,changed_pixels:0,max_smoothing_correction:0};
  if(!prompt)return result;
  if(prompt.length!==data.length)throw new Error('Mouth surface prompt does not match this frame');
  const mask=new Uint8Array(w*h),luma=new Float32Array(w*h);
  for(let x=0;x<w;x++){
    let top=h,bottom=-1;
    for(let y=0;y<h;y++)if(isLip(prompt,(y*w+x)*4)){top=Math.min(top,y);bottom=Math.max(bottom,y);}
    for(let y=0;y<h;y++){
      const i=y*w+x,p=i*4;
      if(isLip(prompt,p)||raw[p+3]===0)continue;
      let type=toothType(prompt,p);
      // Black outside the face is not an oral cavity. Require the same column
      // to be enclosed by upper/lower lip geometry and stay in the mouth ROI.
      if(!type&&x>w*0.17&&x<w*0.83&&y>h*0.25&&y<h*0.75&&y>top&&y<bottom&&
        prompt[p]<30&&prompt[p+1]<30&&prompt[p+2]<30)type=3;
      if(!type)continue;
      const r=raw[p],g=raw[p+1],b=raw[p+2],value=r*0.299+g*0.587+b*0.114;
      // Protect reddish lip/gum pixels where the approximate geometry overlaps.
      if(r-Math.max(g,b)>=28&&value>60)continue;
      mask[i]=type;luma[i]=value;result.interior_pixels++;
    }
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,p=i*4,type=mask[i];if(!type)continue;
    const sums=[0,0,0];let total=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;
      const j=ny*w+nx,q=j*4;if(mask[j]!==type)continue;
      const distance=(luma[j]-luma[i])/24;
      const weight=(dx===0?2:1)*(dy===0?2:1)/(1+distance*distance);
      total+=weight;for(let c=0;c<3;c++)sums[c]+=raw[q+c]*weight;
    }
    let changed=false;
    for(let c=0;c<3;c++){
      const correction=Math.round(clamp((sums[c]/total-raw[p+c])*0.7,-12,12));
      const value=raw[p+c]+correction;
      changed ||= data[p+c]!==value;data[p+c]=value;
      result.max_smoothing_correction=Math.max(result.max_smoothing_correction,Math.abs(correction));
    }
    if(changed)result.changed_pixels++;
    // Keep alpha from the accepted crop-edge blend, including transparent edges.
  }
  return result;
}
