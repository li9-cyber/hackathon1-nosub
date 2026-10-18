// Version 1 here is the mini2 asset schema, NOT the old mini1 model generation.
export function validateDHAssets(data,width=null,height=null,generation='mini2'){
  const legacy=generation==='mini1';
  if(!['mini1','mini2'].includes(generation)||
     (legacy?(data.size!==undefined||data.version!==undefined):(data.size!==184||data.version!==1))||
     !Number.isInteger(data.frame_num)||data.frame_num<1||
     !Array.isArray(data.json_data)||data.frame_num!==data.json_data.length||
     !Array.isArray(data.ref_data)||data.ref_data.length!==(legacy?6480:80)||!data.ref_data.every(Number.isFinite))
    throw new Error('Incompatible '+generation+' asset metadata');
  for(const frame of data.json_data){
    if(!Array.isArray(frame.rect)||frame.rect.length!==4||!frame.rect.every(Number.isFinite)||
       !Array.isArray(frame.points)||frame.points.length!==434||!frame.points.every(Number.isFinite))
      throw new Error('Invalid crop / transform data');
    const [x0,y0,x1,y1]=frame.rect;
    if(x0<0||y0<0||x1<=x0||y1<=y0||x1-x0!==y1-y0||(width!==null&&x1>width)||(height!==null&&y1>height))
      throw new Error('Crop is not square or is outside source bounds');
  }
  return legacy?128:data.size;
}
