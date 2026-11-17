'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('previewCanvas');
const ctx = canvas.getContext('2d', {alpha: false});
const fileInput = $('fileInput');
const dropzone = $('dropzone');
const formatButtons = [...document.querySelectorAll('.format-button')];
const state = {file:null, buffer:null, asset:null,geometry:null, yaw:0.55,pitch:-0.25,zoom:1,drag:false,lastX:0,lastY:0};

function message(text, kind = '') {
  const status = $('status');
  status.className = 'notice' + (kind ? ` ${kind}` : '');
  status.textContent = text;
}
function setEnabled() {
  for(const btn of formatButtons) {
    const format=btn.dataset.format;
    btn.disabled=format==='glb-original'?!state.file:['glb','gltf'].includes(format)?!state.asset:!state.geometry;
  }
}
function selectFile() {fileInput.click();}
dropzone.addEventListener('click', selectFile);
dropzone.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') {e.preventDefault();selectFile();} });
fileInput.addEventListener('change', e=>loadFile(e.target.files?.[0]));
dropzone.addEventListener('dragover', e=>{e.preventDefault();dropzone.classList.add('dragging')});
dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop',e=>{
  e.preventDefault();dropzone.classList.remove('dragging');
  loadFile(e.dataTransfer?.files?.[0]);
});

async function loadFile(file) {
  if(!file) return;
  state.file=file;
  state.buffer=null;
  state.asset=null;
  state.geometry=null;
  $('fileName').textContent = file.name;
  $('fileSize').textContent = (file.size/1024/1024).toFixed(1)+' MB';
  $('previewLabel').textContent = file.name;
  $('triangles').textContent='—';$('vertices').textContent='—';$('meshes').textContent='—';
  $('canvasPlaceholder').style.display='';
  setEnabled();
  if(!/\.glb$/i.test(file.name)) {
    message('Choose a .glb file. This first release supports GLB import only.','error');return;
  }
  message('Reading GLB file locally...');
  try {
    const buffer=await file.arrayBuffer();
    const inputAsset=GLBModel.parseBuffer(buffer);
    message('Checking compression and preparing Blender-compatible model…');
    const result=await GLBModel.makeBlenderReadyGLB(inputAsset);
    const asset=GLBModel.parseBuffer(result.buffer);
    state.buffer=result.buffer;state.asset=asset;
    let previewMessage='';
    try {
      const geom=GLBModel.extractGeometry(asset);
      state.geometry=geom;
      $('canvasPlaceholder').style.display='none';
      $('triangles').textContent=geom.faces.length.toLocaleString();
      $('vertices').textContent=geom.vertices.length.toLocaleString();
      $('meshes').textContent=String(geom.meshCount);
      state.yaw=.65;state.pitch=-.28;state.zoom=1;
      render();
    } catch (previewError) {
      previewMessage=' Geometry preview is unavailable, but the Blender-ready GLB can still be saved.';
    }
    message(`Ready for Blender: ${result.meshopt} Meshopt buffer(s) decompressed, ${result.textures} WebP texture(s) converted.${previewMessage}`,'success');
  } catch(e) {
    message('Cannot prepare a Blender-ready GLB: '+(e.message||String(e))+'. Original GLB can still be saved unchanged.','error');
  }
  setEnabled();
}

function download(blob, filename) {
  const href=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=href; anchor.download=filename; anchor.style.display='none';
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(href),60_000);
}
function basename(name) {return (name||'meshy-model').replace(/\.glb$/i,'').replace(/[^a-z0-9_.-]+/gi,'_').slice(0,80)||'meshy-model';}
formatButtons.forEach(button=>{
  button.addEventListener('click', async()=>{
    if(!state.file || button.disabled) return;
    const format=button.dataset.format;
    const label=button.innerHTML;
    button.disabled=true;
    button.textContent='Exporting...';
    try {
      await new Promise(resolve=>setTimeout(resolve,0));
      let blob;
      switch(format) {
        case 'glb': blob=new Blob([state.buffer],{type:'model/gltf-binary'});break;
        case 'glb-original': blob=state.file;break;
        case 'gltf': blob=GLBModel.makeGLTF(state.asset);break;
        case 'obj': blob=GLBModel.makeOBJ(state.geometry);break;
        case 'stl': blob=GLBModel.makeSTL(state.geometry);break;
        case 'ply': blob=GLBModel.makePLY(state.geometry);break;
        default: throw new Error('Unsupported export format');
      }
      download(blob,basename(state.file.name)+(format==='glb'?'_blender.glb':format==='glb-original'?'_original.glb':'.'+format));
      message(`${format==='glb'?'Blender-ready GLB':format.toUpperCase()} exported locally. Check your Downloads folder.`,'success');
    } catch(e) {
      message('Export failed: '+(e.message||String(e)),'error');
    } finally {button.innerHTML=label;setEnabled()}
  });
});

function canvasSize() {
  const b=canvas.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const w=Math.max(1,Math.round(b.width*dpr));
  const h=Math.max(1,Math.round(b.height*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  return {w,h};
}
function mixColor(color,light) {
  const rgb=color.map(channel=>Math.max(0,Math.min(255,Math.round(255*channel*light))));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}
function render() {
  const {w,h}=canvasSize();
  ctx.fillStyle='#101e2d';ctx.fillRect(0,0,w,h);
  // Subtle ground-plane guide.
  ctx.lineWidth=1;ctx.strokeStyle='#24374a';
  const gap=Math.max(35,Math.floor(w/16));
  for(let x=(w/2)%gap;x<w;x+=gap){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=(h/2)%gap;y<h;y+=gap){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  if(!state.geometry) return;
  const geom=state.geometry;
  const center=geom.min.map((v,i)=>(v+geom.max[i])/2);
  const size=Math.max(...geom.min.map((v,i)=>geom.max[i]-v),0.0001);
  const scale=2/size*state.zoom;
  const cy=Math.cos(state.yaw), sy=Math.sin(state.yaw), cp=Math.cos(state.pitch), sp=Math.sin(state.pitch);
  const camera=4.6;
  const focal=Math.min(w,h)*1.3;
  const transformed=geom.vertices.map(p=>{
    const x=(p[0]-center[0])*scale,y=(p[1]-center[1])*scale,z=(p[2]-center[2])*scale;
    const xx=x*cy+z*sy, zz=-x*sy+z*cy;
    const yy=y*cp-zz*sp, zzz=y*sp+zz*cp;
    const depth=camera-zzz;
    const inv=focal/Math.max(depth,0.1);
    return {x:xx,y:yy,z:zzz,sx:w/2+xx*inv,sy:h/2-yy*inv};
  });
  const skip=Math.max(1,Math.ceil(geom.faces.length/14000));
  const polys=[];
  for(let i=0;i<geom.faces.length;i+=skip) {
    const f=geom.faces[i];
    const a=transformed[f.a],b=transformed[f.b],c=transformed[f.c];
    if(!a||!b||!c) continue;
    const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z;
    const vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    const area=Math.hypot(nx,ny,nz)||1;
    const shading=Math.max(.33,Math.min(1,.54+.45*Math.abs((nx*.3+ny*.65+nz*.7)/area)));
    polys.push({a,b,c,z:(a.z+b.z+c.z)/3,fill:mixColor(f.color,shading)});
  }
  polys.sort((a,b)=>a.z-b.z);
  ctx.lineWidth=.35;ctx.strokeStyle='rgba(4,14,24,.22)';
  for(const p of polys) {
    ctx.beginPath();ctx.moveTo(p.a.sx,p.a.sy);ctx.lineTo(p.b.sx,p.b.sy);ctx.lineTo(p.c.sx,p.c.sy);ctx.closePath();
    ctx.fillStyle=p.fill;ctx.fill();ctx.stroke();
  }
}
canvas.addEventListener('pointerdown',e=>{state.drag=true;state.lastX=e.clientX;state.lastY=e.clientY;canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{
  if(!state.drag||!state.geometry)return;
  state.yaw+=(e.clientX-state.lastX)*.008;
  state.pitch=Math.max(-1.48,Math.min(1.48,state.pitch+(e.clientY-state.lastY)*.008));
  state.lastX=e.clientX;state.lastY=e.clientY;
  requestAnimationFrame(render);
});
canvas.addEventListener('pointerup',()=>state.drag=false);
canvas.addEventListener('pointercancel',()=>state.drag=false);
canvas.addEventListener('wheel',e=>{
  if(!state.geometry)return;
  e.preventDefault();state.zoom=Math.max(.25,Math.min(5,state.zoom*(e.deltaY>0?.9:1.1)));
  requestAnimationFrame(render);
},{passive:false});
$('resetView').addEventListener('click',()=>{state.yaw=.55;state.pitch=-.25;state.zoom=1;render()});
new ResizeObserver(()=>requestAnimationFrame(render)).observe($('canvasBox'));
setEnabled();render();
