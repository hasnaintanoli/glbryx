/* Lightweight geometry-only GLB 2.0 reader. No external dependencies. */
(function(global) {
'use strict';
const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const IDENTITY = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const BPC = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const NC = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};

function requireValid(condition, message) { if (!condition) throw new Error(message); }
function matrixMultiply(a, b) {
  const out = new Array(16);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++) {
    let n=0; for(let k=0;k<4;k++) n += a[k*4+r]*b[c*4+k];
    out[c*4+r]=n;
  }
  return out;
}
function matrixFromNode(node) {
  if(node.matrix) return node.matrix;
  const [x,y,z,w]=node.rotation || [0,0,0,1];
  const [sx,sy,sz]=node.scale || [1,1,1];
  const [tx,ty,tz]=node.translation || [0,0,0];
  const x2=x+x,y2=y+y,z2=z+z;
  const xx=x*x2,xy=x*y2,xz=x*z2;
  const yy=y*y2,yz=y*z2,zz=z*z2;
  const wx=w*x2,wy=w*y2,wz=w*z2;
  return [
    (1-(yy+zz))*sx,(xy+wz)*sx,(xz-wy)*sx,0,
    (xy-wz)*sy,(1-(xx+zz))*sy,(yz+wx)*sy,0,
    (xz+wy)*sz,(yz-wx)*sz,(1-(xx+yy))*sz,0,
    tx,ty,tz,1
  ];
}
function transform(m,p) {
  const [x,y,z]=p;
  return [m[0]*x+m[4]*y+m[8]*z+m[12],
          m[1]*x+m[5]*y+m[9]*z+m[13],
          m[2]*x+m[6]*y+m[10]*z+m[14]];
}
function parseBuffer(buffer) {
  requireValid(buffer instanceof ArrayBuffer, 'The selected file is not readable.');
  requireValid(buffer.byteLength >= 20, 'File is too small to be a valid GLB.');
  const view=new DataView(buffer);
  requireValid(view.getUint32(0,true)===MAGIC, 'Not a GLB file. Select a .glb file.');
  requireValid(view.getUint32(4,true)===2, 'Only glTF 2.0 GLB files are supported.');
  requireValid(view.getUint32(8,true)===buffer.byteLength, 'Invalid GLB header length.');
  let offset=12, json=null, bin=null;
  while(offset+8<=buffer.byteLength) {
    const len=view.getUint32(offset,true);
    const type=view.getUint32(offset+4,true);
    offset+=8;
    requireValid(len<=buffer.byteLength-offset, 'GLB chunk exceeds file length.');
    if(type===JSON_CHUNK && !json) {
      const raw=new Uint8Array(buffer, offset, len);
      json=JSON.parse(new TextDecoder().decode(raw).replace(/\0+$/g,'').trim());
    }
    if(type===BIN_CHUNK && !bin) bin=new Uint8Array(buffer,offset,len);
    offset+=len;
  }
  requireValid(json && bin, 'GLB must contain JSON and BIN chunks.');
  requireValid(json.asset?.version?.startsWith('2.'), 'Only glTF 2.0 assets are supported.');
  return {json,bin,original:buffer};
}
function readAccessor(asset, accessorIndex) {
  const {json,bin}=asset;
  const accessor=json.accessors?.[accessorIndex];
  requireValid(accessor, `Missing accessor ${accessorIndex}.`);
  requireValid(accessor.bufferView!==undefined && !accessor.sparse, 'Sparse or missing buffer-view accessors are not supported by this converter.');
  const bv=json.bufferViews?.[accessor.bufferView];
  requireValid(bv, 'GLB is missing a referenced buffer view.');
  requireValid(!bv.extensions?.EXT_meshopt_compression, 'Meshopt-compressed GLB requires a decoder. Use an uncompressed Meshy export.');
  requireValid((bv.buffer || 0)===0, 'Only GLB embedded binary buffers are supported.');
  const n=NC[accessor.type]; const bpc=BPC[accessor.componentType];
  requireValid(n && bpc && Number.isInteger(accessor.count), 'Unsupported GLB accessor type.');
  const packed=n*bpc;
  const stride=bv.byteStride || packed;
  requireValid(stride>=packed, 'Invalid buffer view stride.');
  const start=(bv.byteOffset || 0)+(accessor.byteOffset || 0);
  requireValid(start>=0 && start+((accessor.count-1)*stride)+packed<=bin.byteLength, 'Accessor extends outside GLB binary data.');
  const data=new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get=(off)=>{
    switch(accessor.componentType) {
      case 5120: return data.getInt8(off);
      case 5121: return data.getUint8(off);
      case 5122: return data.getInt16(off,true);
      case 5123: return data.getUint16(off,true);
      case 5125: return data.getUint32(off,true);
      case 5126: return data.getFloat32(off,true);
      default: throw new Error('Unsupported component type.');
    }
  };
  const out=new Array(accessor.count);
  for(let i=0;i<accessor.count;i++) {
    const row=[];
    for(let j=0;j<n;j++) row.push(get(start+i*stride+j*bpc));
    out[i]=n===1 ? row[0] : row;
  }
  return out;
}
function sequenceToTriangles(indices, mode) {
  const faces=[];
  if(mode===4 || mode==null) for(let i=0;i+2<indices.length;i+=3) faces.push([indices[i],indices[i+1],indices[i+2]]);
  else if(mode===5) for(let i=0;i+2<indices.length;i++) {
    faces.push(i%2===0?[indices[i],indices[i+1],indices[i+2]]:[indices[i+1],indices[i],indices[i+2]]);
  }
  else if(mode===6) for(let i=1;i+1<indices.length;i++) faces.push([indices[0],indices[i],indices[i+1]]);
  return faces;
}
function extractGeometry(asset) {
  const {json}=asset;
  requireValid(Array.isArray(json.meshes) && json.meshes.length, 'This GLB does not contain a 3D mesh.');
  const vertices=[];
  const faces=[];
  let skipped=0, meshCount=0;
  const scenes=json.scenes || [];
  const active=scenes[json.scene || 0];
  const allNodes=json.nodes || [];
  const children=new Set(allNodes.flatMap((n)=>n.children || []));
  const roots=active?.nodes || allNodes.map((_,i)=>i).filter(i=>!children.has(i));
  const visiting=new Set();
  function traverse(nodeIndex, parent) {
    requireValid(nodeIndex>=0 && nodeIndex<allNodes.length, 'Invalid scene node index.');
    requireValid(!visiting.has(nodeIndex), 'Cyclic glTF scene graph.');
    visiting.add(nodeIndex);
    const node=allNodes[nodeIndex];
    const world=matrixMultiply(parent,matrixFromNode(node));
    if(node.mesh!==undefined) addMesh(node.mesh,world);
    for(const child of node.children || []) traverse(child,world);
    visiting.delete(nodeIndex);
  }
  function addMesh(index, world) {
    const mesh=json.meshes[index];
    requireValid(mesh, 'Scene refers to a missing mesh.');
    meshCount++;
    for(const primitive of mesh.primitives || []) {
      if(primitive.extensions?.KHR_draco_mesh_compression) {
        throw new Error('This GLB uses Draco compression. Export an uncompressed GLB from Meshy before converting.');
      }
      if(![undefined,4,5,6].includes(primitive.mode)) {skipped++;continue;}
      if(primitive.attributes?.POSITION===undefined) {skipped++;continue;}
      const coords=readAccessor(asset,primitive.attributes.POSITION);
      const indices=primitive.indices===undefined ? coords.map((_,i)=>i) : readAccessor(asset,primitive.indices);
      const offset=vertices.length;
      for(const point of coords) vertices.push(transform(world,point));
      const rawFaces=sequenceToTriangles(indices,primitive.mode);
      const material=json.materials?.[primitive.material];
      const base=material?.pbrMetallicRoughness?.baseColorFactor || [0.36,0.85,0.77,1];
      for(const [a,b,c] of rawFaces) {
        requireValid([a,b,c].every(v=>Number.isInteger(v)&&v>=0&&v<coords.length), 'Mesh has invalid triangle indices.');
        if(a===b||b===c||a===c) continue;
        faces.push({a:a+offset,b:b+offset,c:c+offset,color:base.slice(0,3)});
      }
    }
  }
  if(allNodes.length) roots.forEach(index=>traverse(index,IDENTITY));
  else json.meshes.forEach((_,index)=>addMesh(index,IDENTITY));
  requireValid(faces.length, 'No triangles found. Non-triangle primitives are not converted.');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of vertices) for(let c=0;c<3;c++) {min[c]=Math.min(min[c],p[c]);max[c]=Math.max(max[c],p[c]);}
  return {vertices,faces,min,max,meshCount,skipped};
}
function fmt(v) { return Number.isFinite(v) ? Number(v.toFixed(7)).toString() : '0'; }
function makeOBJ(geometry) {
  const chunks=['# Exported by Meshy Model Hub','o MeshyModel'];
  for(const p of geometry.vertices) chunks.push(`v ${fmt(p[0])} ${fmt(p[1])} ${fmt(p[2])}`);
  for(const f of geometry.faces) chunks.push(`f ${f.a+1} ${f.b+1} ${f.c+1}`);
  return new Blob([chunks.join('\n')+'\n'],{type:'text/plain'});
}
function makePLY(geometry) {
  const {vertices,faces}=geometry;
  const header=['ply','format ascii 1.0','comment Exported by Meshy Model Hub',
    `element vertex ${vertices.length}`,'property float x','property float y','property float z',
    `element face ${faces.length}`,'property list uchar int vertex_indices','end_header'];
  const lines=header.concat(vertices.map(p=>p.map(fmt).join(' ')),faces.map(f=>`3 ${f.a} ${f.b} ${f.c}`));
  return new Blob([lines.join('\n')+'\n'],{type:'text/plain'});
}
function makeSTL(geometry) {
  const {vertices,faces}=geometry;
  const array=new ArrayBuffer(84+faces.length*50);
  const dv=new DataView(array);
  const title='Meshy Model Hub STL';
  for(let i=0;i<title.length;i++) dv.setUint8(i,title.charCodeAt(i));
  dv.setUint32(80,faces.length,true);
  let off=84;
  for(const face of faces) {
    const a=vertices[face.a],b=vertices[face.b],c=vertices[face.c];
    const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
    const v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const d=Math.hypot(...n)||1;
    for(const val of n) {dv.setFloat32(off,val/d,true);off+=4;}
    for(const p of [a,b,c]) for(const val of p) {dv.setFloat32(off,val,true);off+=4;}
    dv.setUint16(off,0,true);off+=2;
  }
  return new Blob([array],{type:'model/stl'});
}
function makeGLTF(asset) {
  const json=JSON.parse(JSON.stringify(asset.json));
  // Embedded data URI keeps external textures/images stored in BIN chunks intact.
  // Conversion is memory-intensive for very large GLBs.
  const bin=asset.bin;
  const chunks=[];
  const CHUNK_SIZE=0x8000;
  for(let i=0;i<bin.length;i+=CHUNK_SIZE) chunks.push(String.fromCharCode(...bin.subarray(i,i+CHUNK_SIZE)));
  json.buffers=json.buffers || [{}];
  requireValid(json.buffers.length===1, 'This GLB uses multiple buffers and cannot be exported as single-file glTF.');
  json.buffers[0].uri='data:application/octet-stream;base64,'+btoa(chunks.join(''));
  return new Blob([JSON.stringify(json)],{type:'model/gltf+json'});
}
/* Convert standard EXT_meshopt_compression and EXT_texture_webp assets into
 * an ordinary GLB which older Blender glTF importers can understand.
 * Preserve the full scene graph, UVs, normals, materials, images, skinning and animation.
 */
async function makeBlenderReadyGLB(asset, options={}) {
  const json=JSON.parse(JSON.stringify(asset.json));
  const compressedViews=(json.bufferViews||[]).filter(v=>v.extensions?.EXT_meshopt_compression);
  const webpImages=(json.images||[]).filter(img=>img.mimeType==='image/webp' || /^data:image\/webp/i.test(img.uri||''));
  const webpTex=(json.textures||[]).filter(tex=>tex.extensions?.EXT_texture_webp);
  const hasWebp=options.convertTextures!==false && (webpImages.length+webpTex.length)>0;
  // Reject unsupported compressed geometry rather than saving another broken GLB.
  if((json.meshes||[]).some(m=>(m.primitives||[]).some(p=>p.extensions?.KHR_draco_mesh_compression))) {
    throw new Error('This GLB uses Draco geometry. Automatic Draco decompression is not included; try Blender 4+ or provide a meshopt-compressed GLB.');
  }
  if(!compressedViews.length&&!hasWebp) return {buffer:asset.original, changed:false,meshopt:0,textures:0};
  requireValid(json.buffers?.length===1,'This converter supports one embedded GLB buffer.');
  const decoder=global.MeshoptDecoder;
  if(compressedViews.length)requireValid(decoder?.supported,'Meshopt decoder was not loaded. Reload the extension.');
  if(decoder)await decoder.ready;
  const originalBin=asset.bin;
  const newPieces=[], viewData=[];
  let total=0;
  function bytesFromView(view) {
    const start=view.byteOffset||0, len=view.byteLength;
    requireValid(Number.isSafeInteger(start)&&Number.isSafeInteger(len)&&start>=0&&len>=0&&start+len<=originalBin.byteLength,'Invalid GLB buffer view range.');
    return originalBin.slice(start,start+len);
  }
  function append(bytes) {
    requireValid(bytes instanceof Uint8Array,'Invalid asset binary segment.');
    const aligned=(total+3)&~3;
    requireValid(aligned+bytes.byteLength<=0xffffffff-1048576,'Converted GLB would be too large.');
    total=aligned;
    const offset=total;
    newPieces.push({offset,bytes});total+=bytes.byteLength;
    return offset;
  }
  for(const view of json.bufferViews||[]){
    let decoded;
    const opt=view.extensions?.EXT_meshopt_compression;
    if(opt){
      requireValid((opt.buffer||0)===0,'Meshopt compression references an external buffer.');
      requireValid(Number.isSafeInteger(opt.count)&&opt.count>=0&&Number.isSafeInteger(opt.byteStride)&&opt.byteStride>0,'Invalid Meshopt geometry dimensions.');
      const bytes=opt.count*opt.byteStride;
      requireValid(bytes<=512*1024*1024,'Meshopt decompressed view exceeds the safe memory limit.');
      const source=bytesFromView({byteOffset:opt.byteOffset||0,byteLength:opt.byteLength});
      decoded=new Uint8Array(bytes);
      try { decoder.decodeGltfBuffer(decoded,opt.count,opt.byteStride,source,opt.mode,opt.filter||'NONE'); }
      catch(e){throw new Error('Meshopt decode failed: '+(e.message||e));}
      delete view.extensions.EXT_meshopt_compression;
      if(!Object.keys(view.extensions).length)delete view.extensions;
      if(opt.mode==='ATTRIBUTES')view.byteStride=opt.byteStride;
      else delete view.byteStride;
    } else decoded=bytesFromView(view);
    const start=append(decoded);
    view.byteOffset=start;view.byteLength=decoded.byteLength;
    viewData.push(decoded);
  }
  // WebP images frequently trigger Blender errors even after meshopt decompression.
  // Convert embedded WebP to PNG with the browser's native image decoder.
  let convertedTextures=0;
  for(const image of hasWebp?(json.images||[]):[]){
    let source=null;
    if(image.mimeType==='image/webp' && image.bufferView!==undefined) {
      source=viewData[image.bufferView];
    }else if(/^data:image\/webp(;base64)?,/i.test(image.uri||'')) {
      const raw=image.uri.slice(image.uri.indexOf(',')+1);
      source=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
    }
    if(!source)continue;
    requireValid(typeof createImageBitmap==='function' && typeof OffscreenCanvas!=='undefined','WebP image conversion is unavailable in this browser.');
    let bitmap;
    try{
      bitmap=await createImageBitmap(new Blob([source],{type:'image/webp'}));
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
      const context=canvas.getContext('2d');
      requireValid(context,'Cannot create canvas for WebP image.');
      context.drawImage(bitmap,0,0);
      const png=await canvas.convertToBlob({type:'image/png'});
      const data=new Uint8Array(await png.arrayBuffer());
      const offset=append(data);
      const imageView={buffer:0,byteOffset:offset,byteLength:data.byteLength};
      image.bufferView=json.bufferViews.length;
      json.bufferViews.push(imageView);
      delete image.uri;
      image.mimeType='image/png';
      convertedTextures++;
    }catch(e){throw new Error('Could not convert WebP texture to PNG: '+(e.message||e));}
    finally{bitmap?.close();}
  }
  for(const texture of hasWebp?(json.textures||[]):[]){
    const webp=texture.extensions?.EXT_texture_webp;
    if(webp){
      requireValid(Number.isInteger(webp.source) && json.images?.[webp.source], 'Invalid WebP texture reference.');
      texture.source=webp.source;
      delete texture.extensions.EXT_texture_webp;
      if(!Object.keys(texture.extensions).length)delete texture.extensions;
    }
  }
  function withoutExtension(name){
    for(const key of ['extensionsRequired','extensionsUsed']){
      if(json[key]){
        json[key]=json[key].filter(e=>e!==name);
        if(!json[key].length)delete json[key];
      }
    }
  }
  withoutExtension('EXT_meshopt_compression');
  if(hasWebp)withoutExtension('EXT_texture_webp');
  json.buffers[0].byteLength=total;
  delete json.buffers[0].uri;
  const encoder=new TextEncoder();
  const jsonRaw=encoder.encode(JSON.stringify(json));
  const jsonLen=(jsonRaw.length+3)&~3;
  const binLen=(total+3)&~3;
  const length=12+8+jsonLen+8+binLen;
  requireValid(length<=0xffffffff,'Resulting GLB exceeds maximum file length.');
  const out=new Uint8Array(length);
  const dv=new DataView(out.buffer);
  dv.setUint32(0,MAGIC,true);dv.setUint32(4,2,true);dv.setUint32(8,length,true);
  dv.setUint32(12,jsonLen,true);dv.setUint32(16,JSON_CHUNK,true);
  out.fill(0x20,20,20+jsonLen);out.set(jsonRaw,20);
  const binHeader=20+jsonLen;
  dv.setUint32(binHeader,binLen,true);dv.setUint32(binHeader+4,BIN_CHUNK,true);
  for(const part of newPieces)out.set(part.bytes,binHeader+8+part.offset);
  return {buffer:out.buffer,changed:true,meshopt:compressedViews.length,textures:convertedTextures};
}

global.GLBModel={parseBuffer,extractGeometry,makeOBJ,makePLY,makeSTL,makeGLTF,matrixFromNode,matrixMultiply,makeBlenderReadyGLB};
})(typeof window!=='undefined'?window:globalThis);
