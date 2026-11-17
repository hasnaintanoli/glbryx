'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
require('../js/meshopt_reference.js');
require('../js/glb.js');
const M=globalThis.GLBModel;
function pad4(n){return (n+3)&~3;}
function makeGLB(json,bin){
  const raw=Buffer.from(JSON.stringify(json));
  const n=12+8+pad4(raw.length)+8+pad4(bin.length),out=Buffer.alloc(n);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(n,8);
  out.writeUInt32LE(pad4(raw.length),12);out.writeUInt32LE(0x4e4f534a,16);
  out.fill(0x20,20,20+pad4(raw.length));raw.copy(out,20);
  const b=20+pad4(raw.length);out.writeUInt32LE(pad4(bin.length),b);out.writeUInt32LE(0x004e4942,b+4);Buffer.from(bin).copy(out,b+8);
  return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);
}
function leb(n){const res=[];do{let b=n&127;n>>>=7;if(n)b|=128;res.push(b);}while(n);return res;}
function zig(n){return ((n<<1)^(n>>31))>>>0;}
function encodeAttributesVerbatim(bytes,count,stride){
  // Reference meshopt v0 vertex format; encode each byte channel as 16-byte verbatim blocks.
  const out=[0xa0];const prev=new Uint8Array(stride);
  for(let ch=0;ch<stride;ch++){
    out.push(3);
    for(let i=0;i<16;i++){
      const n=i<count?bytes[i*stride+ch]:prev[ch];
      const diff=(n-prev[ch]+256)&255;
      const signed=diff>=128?diff-256:diff;
      out.push(i<count?zig(signed)&255:0);
      prev[ch]=n;
    }
  }
  // For v0, the final 32 bytes contain original previous values + padding.
  out.push(...new Uint8Array(32));
  return Uint8Array.from(out);
}
function encodeSequence(indices){
  const out=[0xd1];let prev=0;
  for(const val of indices){const d=val-prev;prev=val;out.push(...leb(zig(d)*2));}
  return Uint8Array.from(out);
}
function validateAdditionalCodecs(){
  const source=new Uint8Array(8*12),initial=new Uint8Array(12);
  // v1 attributes using direct byte channels and zero-delta base, compressed without WASM.
  for(let i=0;i<source.length;i++)source[i]=i%251;
  const stream=[0xa1,0xff,0xff,0xff];
  for(let c=0;c<12;c++)for(let i=0;i<8;i++){
    const n=source[i*12+c];const delta=(n-initial[c]+256)&255;
    stream.push(zig(delta>=128?delta-256:delta)&255);initial[c]=n;
  }
  stream.push(...new Uint8Array(24));
  const target=new Uint8Array(8*12);
  globalThis.MeshoptDecoder.decodeGltfBuffer(target,8,12,Uint8Array.from(stream),'ATTRIBUTES','NONE');
  assert.deepEqual([...target],[...source]);
  // meshoptimizer TRIANGLES codec, special 0xf0 = one new triangle (0,1,2).
  const tri=new Uint8Array(6);
  globalThis.MeshoptDecoder.decodeGltfBuffer(tri,3,2,Uint8Array.from([0xe1,0xf0,...new Uint8Array(16)]),'TRIANGLES','NONE');
  assert.deepEqual([...tri],[0,0,1,0,2,0]);
}
async function main(){
  validateAdditionalCodecs();
  const original=fs.readFileSync(__dirname+'/../sample/demo-cube.glb');
  const orig=M.parseBuffer(original.buffer.slice(original.byteOffset,original.byteOffset+original.length));
  const json=structuredClone(orig.json);
  const positions=orig.bin.slice(0,96),indexBytes=orig.bin.slice(96,168);
  const indices=Array.from({length:36},(_,i)=>new DataView(indexBytes.buffer,indexBytes.byteOffset,indexBytes.byteLength).getUint16(i*2,true));
  const encodedPositions=encodeAttributesVerbatim(positions,8,12);
  const encodedIndices=encodeSequence(indices);
  const bin=new Uint8Array(pad4(encodedPositions.length)+encodedIndices.length);
  bin.set(encodedPositions);bin.set(encodedIndices,pad4(encodedPositions.length));
  json.buffers[0].byteLength=bin.length;
  json.extensionsUsed=['EXT_meshopt_compression'];json.extensionsRequired=['EXT_meshopt_compression'];
  json.bufferViews[0]={buffer:0,byteOffset:0,byteLength:96,extensions:{EXT_meshopt_compression:{buffer:0,byteOffset:0,byteLength:encodedPositions.length,count:8,byteStride:12,mode:'ATTRIBUTES',filter:'NONE'}}};
  json.bufferViews[1]={buffer:0,byteOffset:0,byteLength:72,extensions:{EXT_meshopt_compression:{buffer:0,byteOffset:pad4(encodedPositions.length),byteLength:encodedIndices.length,count:36,byteStride:2,mode:'INDICES',filter:'NONE'}}};
  const encoded=makeGLB(json,bin);
  const encodedAsset=M.parseBuffer(encoded);
  const normalized=await M.makeBlenderReadyGLB(encodedAsset);
  assert.equal(normalized.meshopt,2);
  assert.equal(normalized.changed,true);
  const clean=M.parseBuffer(normalized.buffer);
  assert.ok(!clean.json.extensionsRequired?.includes('EXT_meshopt_compression'));
  assert.ok(!clean.json.extensionsUsed?.includes('EXT_meshopt_compression'));
  assert.ok(!clean.json.bufferViews.some(b=>b.extensions?.EXT_meshopt_compression));
  assert.equal(clean.json.bufferViews[0].byteLength,96);
  assert.equal(clean.json.bufferViews[1].byteLength,72);
  assert.deepEqual([...clean.bin.subarray(0,96)],[...positions]);
  assert.deepEqual([...clean.bin.subarray(clean.json.bufferViews[1].byteOffset,clean.json.bufferViews[1].byteOffset+72)],[...indexBytes]);
  const mesh=M.extractGeometry(clean);assert.equal(mesh.vertices.length,8);assert.equal(mesh.faces.length,12);
  fs.writeFileSync(__dirname+'/../sample/demo-cube-meshopt.glb',Buffer.from(encoded));
  fs.writeFileSync(__dirname+'/../sample/demo-cube-blender.glb',Buffer.from(normalized.buffer));
  const uncompressed=await M.makeBlenderReadyGLB(orig);
  assert.equal(uncompressed.changed,false);
  assert.equal(uncompressed.buffer,orig.original);
  console.log('PASS: meshopt v0/v1 ATTRIBUTES, INDICES, TRIANGLES, valid Blender-ready GLB, uncompressed passthrough');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
