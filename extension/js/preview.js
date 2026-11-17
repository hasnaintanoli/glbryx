/* GLBRYX — lightweight offline mesh preview.
   Draws geometry with flat material colors. Textured, Draco and meshopt meshes
   may require a more advanced renderer; this module never fetches anything. */
(() => {
  'use strict';
  function clamp(value,lo,hi){return Math.min(hi,Math.max(lo,value));}
  function prepare(geometry,faceLimit=8500) {
    if (!geometry?.faces?.length) throw new Error('No renderable triangles.');
    const faces=geometry.faces;
    const step=Math.max(1,Math.ceil(faces.length/faceLimit));
    const used=new Map(),vertices=[],sample=[];
    function mapIndex(index){
      if(!used.has(index)) {used.set(index,vertices.length);vertices.push(geometry.vertices[index]);}
      return used.get(index);
    }
    for(let i=0;i<faces.length;i+=step){
      const face=faces[i];
      sample.push({a:mapIndex(face.a),b:mapIndex(face.b),c:mapIndex(face.c),color:face.color||[0.27,0.84,0.76]});
    }
    return {vertices,faces:sample,min:geometry.min,max:geometry.max,
      triangles:geometry.faces.length,vertexCount:geometry.vertices.length,meshCount:geometry.meshCount};
  }
  function draw(canvas,prepared,view={}) {
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw new Error('Canvas 2D is unavailable.');
    const w=canvas.width,h=canvas.height;
    const grad=ctx.createLinearGradient(0,0,w,h);
    grad.addColorStop(0,'#0d2435');grad.addColorStop(1,'#08111f');
    ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='rgba(103,179,196,.08)';ctx.lineWidth=1;
    const gap=Math.max(30,Math.floor(Math.min(w,h)/9));
    for(let i=0;i<w;i+=gap){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,h);ctx.stroke();}
    for(let i=0;i<h;i+=gap){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(w,i);ctx.stroke();}
    if(!prepared)return;
    const center=prepared.min.map((x,i)=>(x+prepared.max[i])/2);
    const length=Math.max(0.00001,...prepared.min.map((x,i)=>prepared.max[i]-x));
    const scale=2/length*clamp(view.zoom||1,0.2,5);
    const yaw=view.yaw??0.72,pitch=view.pitch??-0.29;
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const focal=Math.min(w,h)*1.22;
    const projected=prepared.vertices.map(p=>{
      const x=(p[0]-center[0])*scale,y=(p[1]-center[1])*scale,z=(p[2]-center[2])*scale;
      const xx=x*cy+z*sy, zz=-x*sy+z*cy;
      const yy=y*cp-zz*sp, zzz=y*sp+zz*cp;
      const depth=Math.max(.1,4.6-zzz),fac=focal/depth;
      return {x:xx,y:yy,z:zzz,sx:w/2+xx*fac,sy:h/2-yy*fac};
    });
    const polys=[];
    for(const face of prepared.faces){
      const a=projected[face.a],b=projected[face.b],c=projected[face.c];
      if(!a||!b||!c)continue;
      const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z;
      const vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      const norm=Math.hypot(nx,ny,nz)||1;
      const shade=clamp(.52+.42*Math.abs((nx*.32+ny*.76+nz*.55)/norm),.30,1);
      const color=face.color;
      const fill=`rgb(${color.slice(0,3).map(c=>Math.round(255*clamp(c*shade,0,1))).join(',')})`;
      polys.push({a,b,c,z:(a.z+b.z+c.z)/3,fill});
    }
    polys.sort((a,b)=>a.z-b.z);
    ctx.lineWidth=.35;ctx.strokeStyle='rgba(0,13,25,.23)';
    for(const poly of polys){
      ctx.beginPath();ctx.moveTo(poly.a.sx,poly.a.sy);
      ctx.lineTo(poly.b.sx,poly.b.sy);ctx.lineTo(poly.c.sx,poly.c.sy);ctx.closePath();
      ctx.fillStyle=poly.fill;ctx.fill();ctx.stroke();
    }
  }
  function thumbnail(geometry,width=372,height=220){
    const prepared=prepare(geometry,6000);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    draw(canvas,prepared);
    return canvas.toDataURL('image/jpeg',.83);
  }
  globalThis.GLBPreview={prepare,draw,thumbnail};
})();
