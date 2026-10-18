// Bounded detail enhancement of the actual model output, not super resolution.
// Never copies the closed source mouth into a speaking mouth.
export function enhanceMouth(image, {amount=0.75, maxCorrection=8, feather=5}={}) {
  const {width:w,height:h,data}=image;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<3||h<3||data.length!==w*h*4)
    throw new Error('Invalid mouth image');
  if(!Number.isFinite(amount)||amount<0||amount>1||!Number.isFinite(maxCorrection)||maxCorrection<0||maxCorrection>12)
    throw new Error('Invalid clarity strength');
  if(!Number.isFinite(feather)||feather<0||feather>Math.min(w,h)/4)
    throw new Error('Invalid edge feather');
  const original=new Uint8ClampedArray(data),luma=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)luma[i]=original[i*4]*0.299+original[i*4+1]*0.587+original[i*4+2]*0.114;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,p=i*4;
    let low=Infinity,high=-Infinity,blur=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const value=luma[Math.max(0,Math.min(h-1,y+dy))*w+Math.max(0,Math.min(w-1,x+dx))];
      low=Math.min(low,value);high=Math.max(high,value);
      blur+=value*(dx===0?2:1)*(dy===0?2:1)/16;
    }
    // Restrict sharpening to the model's central mouth region with soft edges.
    const focus=Math.max(0,Math.min(1,(x-w*0.17)/8,(w*0.83-x)/8,(y-h*0.25)/8,(h*0.75-y)/8));
    const detail=luma[i]-blur;
    const desired=Math.abs(detail)>1.25?amount*detail*focus:0;
    const delta=Math.max(low-luma[i],Math.min(high-luma[i],Math.max(-maxCorrection,Math.min(maxCorrection,desired))));
    for(let c=0;c<3;c++)data[p+c]=original[p+c]+delta;
    const edge=Math.max(0,Math.min(x,y,w-1-x,h-1-y));
    const alpha=feather===0?1:Math.min(1,edge/feather);
    data[p+3]=Math.round(original[p+3]*alpha*alpha*(3-2*alpha));
  }
  return image;
}

// Keep the previously accepted mild filter byte-for-byte unchanged.
export const clarityProfiles=Object.freeze({
  mild:Object.freeze({label:'Mild · previous version',fine:0.75,broad:0,maxCorrection:8}),
  balanced:Object.freeze({label:'Balanced · clearer contours',fine:0.65,broad:2.2,maxCorrection:10}),
  strong:Object.freeze({label:'Strong · compare for artifacts',fine:0.85,broad:3.2,maxCorrection:12})
});

const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const smooth=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

function blurLuma(input,w,h,kernel,[left,top,right,bottom]){
  const radius=(kernel.length-1)/2,normal=kernel.reduce((a,b)=>a+b,0);
  const horizontal=new Float32Array(input.length),output=new Float32Array(input.length);
  for(let y=Math.max(0,top-radius);y<=Math.min(h-1,bottom+radius);y++)for(let x=left;x<=right;x++){
    let sum=0;
    for(let k=-radius;k<=radius;k++)sum+=input[y*w+clamp(x+k,0,w-1)]*kernel[k+radius];
    horizontal[y*w+x]=sum/normal;
  }
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    let sum=0;
    for(let k=-radius;k<=radius;k++)sum+=horizontal[clamp(y+k,0,h-1)*w+x]*kernel[k+radius];
    output[y*w+x]=sum/normal;
  }
  return output;
}

export function enhanceMouthProfile(image,profile='mild'){
  if(!Object.hasOwn(clarityProfiles,profile))throw new Error('Unknown clarity profile');
  if(profile==='mild')return enhanceMouth(image);
  const {width:w,height:h,data}=image;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<3||h<3||data.length!==w*h*4)
    throw new Error('Invalid mouth image');
  const {fine,broad,maxCorrection}=clarityProfiles[profile];
  const original=new Uint8ClampedArray(data),luma=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)luma[i]=original[i*4]*0.299+original[i*4+1]*0.587+original[i*4+2]*0.114;
  const bounds=[Math.floor(w*0.17),Math.floor(h*0.25),Math.min(w-1,Math.ceil(w*0.83)),Math.min(h-1,Math.ceil(h*0.75))];
  const expanded=[Math.max(0,bounds[0]-1),Math.max(0,bounds[1]-1),Math.min(w-1,bounds[2]+1),Math.min(h-1,bounds[3]+1)];
  const narrow=blurLuma(luma,w,h,[1,2,1],expanded);
  const wide=blurLuma(luma,w,h,[1,6,15,20,15,6,1],bounds);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,p=i*4;
    const edge=Math.max(0,Math.min(x,y,w-1-x,h-1-y));
    data[p+3]=Math.round(original[p+3]*smooth(edge/Math.min(5,Math.min(w,h)/4)));
    const focus=clamp(Math.min((x-w*0.17)/8,(w*0.83-x)/8,(y-h*0.25)/8,(h*0.75-y)/8),0,1);
    if(focus===0)continue;
    let low=luma[i],high=luma[i],smoothLow=narrow[i],smoothHigh=narrow[i];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const j=clamp(y+dy,0,h-1)*w+clamp(x+dx,0,w-1);
      low=Math.min(low,luma[j]);high=Math.max(high,luma[j]);
      smoothLow=Math.min(smoothLow,narrow[j]);smoothHigh=Math.max(smoothHigh,narrow[j]);
    }
    // Broader contours receive most of the gain. Suppress low-contrast noise;
    // a continuous threshold avoids switching the effect abruptly between frames.
    const structure=smooth((smoothHigh-smoothLow-2)/6);
    const detail=fine*(luma[i]-narrow[i])+broad*(narrow[i]-wide[i]);
    const desired=detail*smooth((Math.abs(detail)-0.75)/2)*structure*focus;
    const rgbLow=Math.min(original[p],original[p+1],original[p+2]);
    const rgbHigh=Math.max(original[p],original[p+1],original[p+2]);
    // No new extrema or channel clipping: prevents white/dark halos and hue shifts.
    const delta=clamp(desired,Math.max(-maxCorrection,low-luma[i],-rgbLow),
      Math.min(maxCorrection,high-luma[i],255-rgbHigh));
    for(let c=0;c<3;c++)data[p+c]=original[p+c]+delta;
  }
  return image;
}
