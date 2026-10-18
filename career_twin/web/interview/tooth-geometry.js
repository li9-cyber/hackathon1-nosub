const isTooth=(rgba,p)=>rgba[p]<60&&((rgba[p+1]>200&&rgba[p+2]<60)||(rgba[p+2]>200&&rgba[p+1]<60));

export function trimToothPrompt(prompt,w,h,retainedHeight){
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<3||h<3||prompt.length!==w*h*4)
    throw new Error('Invalid tooth geometry prompt');
  if(!Number.isFinite(retainedHeight)||retainedHeight<0||retainedHeight>1)
    throw new Error('Invalid tooth exposure');
  const result=new Uint8Array(prompt);
  for(let x=0;x<w;x++)for(const channel of [1,2]){
    const rows=[];
    for(let y=0;y<h;y++){
      const p=(y*w+x)*4;
      if(isTooth(prompt,p)&&prompt[p+channel]>200)rows.push(y);
    }
    const keep=Math.round(rows.length*retainedHeight);
    for(const [n,y] of rows.entries()){
      // Upper teeth stay attached to the upper lip; lower teeth to the lower lip.
      if(channel===1?n<keep:n>=rows.length-keep)continue;
      result.fill(0,(y*w+x)*4,(y*w+x)*4+3);
    }
  }
  return result;
}

export function mergeToothOutput(baseline,alternative,prompt,w,h){
  if(baseline.length!==w*h*4||alternative.length!==baseline.length||prompt.length!==baseline.length)
    throw new Error('Tooth outputs do not match');
  const result=new Uint8ClampedArray(baseline);
  for(let p=0;p<result.length;p+=4){
    if(!isTooth(prompt,p))continue;
    // Never import a changed lip, gum or alpha from the alternative full mouth.
    if(baseline[p]-Math.max(baseline[p+1],baseline[p+2])>=28)continue;
    for(let c=0;c<3;c++)result[p+c]=alternative[p+c];
  }
  return result;
}
