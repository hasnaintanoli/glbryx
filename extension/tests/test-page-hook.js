'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const glb = fs.readFileSync(path.join(root, 'sample/demo-cube.glb'));
const sent = [];
class FakeWorker {
  constructor() {this.listeners=[];}
  addEventListener(type, fn) {if(type==='message')this.listeners.push(fn);}
  emit(data) {for(const listener of this.listeners)listener({data});}
}
const window = {
  Worker: FakeWorker,
  location: {origin:'https://www.meshy.ai',href:'https://www.meshy.ai/workspace',pathname:'/workspace'},
  postMessage(data,origin,transfers) {sent.push({data,origin,transfers});},
  fetch(){return Promise.resolve({headers:{get(){return null;}},ok:false});}
};
const context=vm.createContext({window,document:{title:'Demo Cube - Meshy',querySelector(){return null;}},location:window.location,ArrayBuffer,Uint8Array,DataView,Blob,Date,console,Object,Reflect,Promise,Set,Map,String,Number});
vm.runInContext(fs.readFileSync(path.join(root,'page-hook.js'),'utf8'),context);
const worker=new window.Worker('example.js');
const bytes=new Uint8Array(glb.length);bytes.set(glb);
worker.emit({data:{buffer:bytes.buffer}});
assert.equal(sent.length,1,'Worker response with GLB should be captured');
assert.equal(sent[0].data.kind,'GLB');
assert.equal(sent[0].data.buffer.byteLength,glb.length);
assert.equal(sent[0].origin,'https://www.meshy.ai');
worker.emit({data:{buffer:new Uint8Array([1,2,3]).buffer}});
assert.equal(sent.length,1,'Other binary data should be ignored');
console.log('PASS: page hook captures valid GLB worker replies only');
