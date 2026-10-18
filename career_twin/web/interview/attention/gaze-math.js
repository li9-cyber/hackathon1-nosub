// Iris motion is measured relative to each eye; screen locations come only from calibration.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function eye(points, outer, inner, top, bottom, iris) {
  const a=points[outer],b=points[inner],p=points[iris];
  const width=distance(a,b);
  if(width<.012 || distance(points[top],points[bottom])/width<.12)return null;
  const dx=(b.x-a.x)/width,dy=(b.y-a.y)/width;
  const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
  return {x:((p.x-mx)*dx+(p.y-my)*dy)/width,
    y:((p.y-my)*dx-(p.x-mx)*dy)/width,center:{x:mx,y:my}};
}
export function irisFeatures(points) {
  if(!points || points.length<478 || points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
  const right=eye(points,33,133,159,145,468),left=eye(points,362,263,386,374,473);
  if(!right||!left)return null;
  const gap=distance(right.center,left.center),nose=points[1];
  if(gap<.04)return null;
  const center={x:(right.center.x+left.center.x)/2,y:(right.center.y+left.center.y)/2};
  const values=[(right.x+left.x)/2,(right.y+left.y)/2,
    (nose.x-center.x)/gap,(nose.y-center.y)/gap,center.x,center.y];
  return values.every(Number.isFinite)?values:null;
}
// Reuse the existing eye/iris geometry. Positive X = the person's right,
// positive Y = down; positions are fractions of eye width, not screen pixels.
export function irisRelativePositions(points, aspect=1) {
  if(!points || points.length<478 || !Number.isFinite(aspect) || aspect<=0 ||
    points.some(p=>!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))return null;
  const scaled=points.map(p=>({x:p.x*aspect,y:p.y}));
  const right=eye(scaled,33,133,159,145,468),left=eye(scaled,362,263,386,374,473);
  if(!right || !left)return null;
  const relative=e=>({x:-e.x,y:e.y});
  const l=relative(left),r=relative(right);
  if([l.x,l.y,r.x,r.y].some(v=>!Number.isFinite(v) || Math.abs(v)>.5) ||
    Math.abs(l.x-r.x)>.18 || Math.abs(l.y-r.y)>.12)return null;
  return {left:l,right:r,eye_x:(l.x+r.x)/2,eye_y:(l.y+r.y)/2};
}
export function average(rows) {
  return rows[0].map((_,i)=>rows.reduce((sum,row)=>sum+row[i],0)/rows.length);
}
function solve(matrix, vector) {
  const a=matrix.map((row,i)=>[...row,vector[i]]),n=vector.length;
  for(let col=0;col<n;col++){
    let pivot=col;
    for(let i=col+1;i<n;i++)if(Math.abs(a[i][col])>Math.abs(a[pivot][col]))pivot=i;
    if(Math.abs(a[pivot][col])<1e-10)throw new Error('校準資料不足，請重新校準');
    [a[col],a[pivot]]=[a[pivot],a[col]];
    const scale=a[col][col];
    for(let j=col;j<=n;j++)a[col][j]/=scale;
    for(let i=0;i<n;i++)if(i!==col){const f=a[i][col];for(let j=col;j<=n;j++)a[i][j]-=f*a[col][j];}
  }
  return a.map(row=>row[n]);
}
export function fitCalibration(samples) {
  if(samples.length<9)throw new Error('需要完成九個校準點');
  const rows=samples.map(s=>s.features),mean=average(rows);
  const std=mean.map((_,i)=>Math.sqrt(rows.reduce((s,r)=>s+(r[i]-mean[i])**2,0)/rows.length));
  if(std[0]<.002 || std[1]<.001)throw new Error('沒有量到足夠眼球移動，請改善光線並注視每個目標');
  const scales=std.map(v=>Math.max(v,.0005));
  const design=rows.map(row=>[1,...row.map((v,i)=>(v-mean[i])/scales[i])]);
  const n=design[0].length;
  const matrix=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
    design.reduce((sum,row)=>sum+row[i]*row[j],0)+(i===j&&i>0?.15:0)));
  const weights=['x','y'].map(axis=>solve(matrix,Array.from({length:n},(_,i)=>
    design.reduce((sum,row,k)=>sum+row[i]*samples[k][axis],0))));
  return {mean,scales,weights};
}
export function predictGaze(model,features) {
  const row=[1,...features.map((v,i)=>(v-model.mean[i])/model.scales[i])];
  const [x,y]=model.weights.map(weights=>weights.reduce((sum,w,i)=>sum+w*row[i],0));
  return {x,y};
}
