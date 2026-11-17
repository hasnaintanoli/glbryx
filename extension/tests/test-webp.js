const fs=require('fs');
require('../js/glb.js');
const M=globalThis.GLBModel;
function p4(n){return n+(-n&3)}
function pack(json,bin){
 const str=Buffer.from(JSON.stringify(json));
 const out=Buffer.alloc(12+8+p4(str.length)+8+p4(bin.length));
 out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
 out.writeUInt32LE(p4(str.length),12);out.writeUInt32LE(0x4e4f534a,16);out.fill(32,20,20+p4(str.length));str.copy(out,20);
 const off=20+p4(str.length);out.writeUInt32LE(p4(bin.length),off);out.writeUInt32LE(0x004e4942,off+4);Buffer.from(bin).copy(out,off+8);
 return out;
}
const cube=fs.readFileSync(__dirname+'/../sample/demo-cube.glb');
const asset=M.parseBuffer(cube.buffer.slice(cube.byteOffset,cube.byteOffset+cube.byteLength));
const webp=fs.readFileSync(__dirname+'/../sample/fixture-texture.webp');
const json=structuredClone(asset.json), bin=new Uint8Array(p4(asset.bin.length)+webp.length);
bin.set(asset.bin);bin.set(webp,p4(asset.bin.length));
json.buffers[0].byteLength=bin.length;
json.bufferViews.push({buffer:0,byteOffset:p4(asset.bin.length),byteLength:webp.length});
json.images=[{bufferView:2,mimeType:'image/webp'}];
json.textures=[{extensions:{EXT_texture_webp:{source:0}}}];
json.materials[0].pbrMetallicRoughness.baseColorTexture={index:0};
json.extensionsUsed=['EXT_texture_webp'];json.extensionsRequired=['EXT_texture_webp'];
const packed=pack(json,bin);
fs.writeFileSync(__dirname+'/../sample/demo-cube-webp.glb',packed);
console.log('Saved test WebP GLB',packed.length,'bytes');
