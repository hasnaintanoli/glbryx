/* Meshopt reference decoder implementation, adapted for classic scripts.
 * MIT License — Copyright (C) 2016-2026 Arseny Kapoulkine,
 * reference decoder by Jasper St. Pierre.
 * Based on https://github.com/zeux/meshoptimizer/blob/master/js/meshopt_decoder_reference.js
 * This JS reference is slower than the optimized WASM decoder; local/offline only.
 */
(function(root){
'use strict';
const decoder={supported:true,ready:Promise.resolve()};
function check(v,m){if(!v)throw new Error('Meshopt decode failed: '+(m||'malformed compressed stream'));}
const dezig=x=>(x>>>1)^-(x&1);
function vertex(dst,count,stride,src,filter){
  check(stride>0 && stride%4===0 && stride<=256,'invalid byte stride');
  check(src[0]===0xa0||src[0]===0xa1,'unsupported vertex codec');
  const ver=src[0]&15, maxBlock=Math.min((8192/stride)&~15,256);
  check(maxBlock>0,'invalid stride');
  const deltas=new Uint8Array(maxBlock*stride);
  const tailSize=ver===0?stride:stride+stride/4;
  const tailOff=src.length-tailSize;
  check(tailOff>=1,'short vertex stream');
  const temp=src.slice(tailOff,tailOff+stride);
  const channels=ver===0?null:src.slice(tailOff+stride,tailOff+tailSize);
  const modes=[[0,2,4,8],[0,1,2,4],[1,2,4,8]];
  let pos=1;
  for(let base=0;base<count;base+=maxBlock){
    const elemCount=Math.min(count-base,maxBlock);
    const groups=((elemCount+15)&~15)>>>4, headerBytes=((groups+3)&~3)>>>2;
    const controlPos=pos;
    if(ver)pos+=stride/4;
    deltas.fill(0);
    for(let byte=0;byte<stride;byte++){
      const deltaStart=byte*elemCount;
      const ctrl=ver?(src[controlPos+(byte>>>2)]>>>((byte&3)*2))&3:0;
      if(ctrl===2)continue;
      if(ctrl===3){deltas.set(src.subarray(pos,pos+elemCount),deltaStart);pos+=elemCount;continue;}
      const head=pos;pos+=headerBytes;
      for(let g=0;g<groups;g++){
        const m=(src[head+(g>>>2)]>>>((g&3)*2))&3;
        const bits=modes[ver===0?0:ctrl+1][m];
        const offset=deltaStart+(g<<4);
        if(!bits)continue;
        if(bits===8){deltas.set(src.subarray(pos,pos+16),offset);pos+=16;continue;}
        const packed=bits===1?2:bits===2?4:8;
        const initial=pos;pos+=packed;
        for(let i=0;i<16;i++){
          let val;
          if(bits===1)val=(src[initial+(i>>>3)]>>>(i&7))&1;
          else if(bits===2)val=(src[initial+(i>>>2)]>>>(6-((i&3)*2)))&3;
          else val=(src[initial+(i>>>1)]>>>(4-((i&1)*4)))&15;
          if(val===(1<<bits)-1)val=src[pos++];
          deltas[offset+i]=val;
        }
      }
    }
    for(let elem=0;elem<elemCount;elem++){
      for(let bg=0;bg<stride;bg+=4){
        const cm=ver===0?0:channels[bg>>>2]&3;
        check(cm!==3,'unsupported channel mode');
        if(cm===0){
          for(let b=bg;b<bg+4;b++){
            const val=(temp[b]+dezig(deltas[b*elemCount+elem]))&255;
            dst[(base+elem)*stride+b]=temp[b]=val;
          }
        }else if(cm===1){
          for(let b=bg;b<bg+4;b+=2){
            const delta=dezig(deltas[b*elemCount+elem]+(deltas[(b+1)*elemCount+elem]<<8));
            let val=(temp[b]+(temp[b+1]<<8)+delta)&65535;
            dst[(base+elem)*stride+b]=temp[b]=val&255;
            dst[(base+elem)*stride+b+1]=temp[b+1]=val>>>8;
          }
        }else{
          const d=deltas[bg*elemCount+elem]+(deltas[(bg+1)*elemCount+elem]<<8)+(deltas[(bg+2)*elemCount+elem]<<16)+(deltas[(bg+3)*elemCount+elem]<<24);
          let v=temp[bg]+(temp[bg+1]<<8)+(temp[bg+2]<<16)+(temp[bg+3]<<24);
          const rot=channels[bg>>>2]>>>4;
          v ^= (d>>>rot)|(d<<(32-rot));
          for(let b=0;b<4;b++)dst[(base+elem)*stride+bg+b]=temp[bg+b]=(v>>>(b*8))&255;
        }
      }
    }
  }
  const padded=Math.max(tailSize,ver===0?32:24);
  check(pos===src.length-padded,'vertex stream length mismatch');
  if(filter==='OCTAHEDRAL'){
    check(stride===4||stride===8);
    const arr=stride===4?new Int8Array(dst.buffer,dst.byteOffset,count*4):new Int16Array(dst.buffer,dst.byteOffset,count*4);
    const max=stride===4?127:32767;
    for(let i=0;i<count*4;i+=4){
      let x=arr[i]/arr[i+2],y=arr[i+1]/arr[i+2];const z=1-Math.abs(x)-Math.abs(y);
      const t=Math.max(-z,0);x-=x>=0?t:-t;y-=y>=0?t:-t;
      const h=max/Math.sqrt(x*x+y*y+z*z);
      arr[i]=Math.round(x*h);arr[i+1]=Math.round(y*h);arr[i+2]=Math.round(z*h);
    }
  }else if(filter==='QUATERNION'){
    check(stride===8);
    const arr=new Int16Array(dst.buffer,dst.byteOffset,count*4);
    for(let i=0;i<count*4;i+=4){
      const w=arr[i+3],maxComp=w&3,s=Math.SQRT1_2/(w|3);
      const x=arr[i]*s,y=arr[i+1]*s,z=arr[i+2]*s;
      const q=Math.sqrt(Math.max(0,1-x*x-y*y-z*z));
      arr[i+(maxComp+1)%4]=Math.round(x*32767);
      arr[i+(maxComp+2)%4]=Math.round(y*32767);
      arr[i+(maxComp+3)%4]=Math.round(z*32767);
      arr[i+maxComp]=Math.round(q*32767);
    }
  }else if(filter==='EXPONENTIAL'){
    check((stride&3)===0);
    const i32=new Int32Array(dst.buffer,dst.byteOffset,count*stride/4);
    const f32=new Float32Array(dst.buffer,dst.byteOffset,count*stride/4);
    const bits=new Uint32Array(1),f=new Float32Array(bits.buffer);
    for(let i=0;i<i32.length;i++){
      const v=i32[i],exp=v>>24,mant=(v<<8)>>8;
      bits[0]=(exp+127)<<23;f32[i]=f[0]*mant;
    }
  }else if(filter==='COLOR'){
    check(stride===4||stride===8);
    const max=(1<<(stride*2))-1;
    const arr=stride===4?new Uint8Array(dst.buffer,dst.byteOffset,count*4):new Uint16Array(dst.buffer,dst.byteOffset,count*4);
    const signed=stride===4?new Int8Array(dst.buffer,dst.byteOffset,count*4):new Int16Array(dst.buffer,dst.byteOffset,count*4);
    for(let i=0;i<count*4;i+=4){
      const y=arr[i],co=signed[i+1],cg=signed[i+2],alpha=arr[i+3];
      const alphaBit=31-Math.clz32(alpha),as=(1<<(alphaBit+1))-1;
      const r=y+co-cg,g=y+cg,b=y-co-cg;
      let a=alpha&(as>>>1);a=(a<<1)|(a&1);
      const scale=max/as;
      arr[i]=Math.round(r*scale);arr[i+1]=Math.round(g*scale);arr[i+2]=Math.round(b*scale);arr[i+3]=Math.round(a*scale);
    }
  }else check(!filter||filter==='NONE','unknown meshopt filter '+filter);
}
const fifoGet=(a,n)=>a[(a.offset-1-n)&(a.length-1)];
function fifoPush(a,n){a[a.offset]=n;a.offset=(a.offset+1)&(a.length-1);}
function triangle(dst,count,stride,src){
  check(src[0]===0xe1&&count%3===0&&(stride===2||stride===4),'unsupported triangle stream');
  const out=stride===2?new Uint16Array(dst.buffer,dst.byteOffset,count):new Uint32Array(dst.buffer,dst.byteOffset,count);
  let code=1,data=1+count/3,next=0,last=0,at=0;
  const aux=src.length-16,edges=new Uint32Array(32),verts=new Uint32Array(16);
  edges.offset=0;verts.offset=0;
  const leb=()=>{let v=0,bit=0,b;do{check(bit<=28,'malformed LEB128');b=src[data++];check(b!==undefined,'truncated index stream');v|=(b&127)<<bit;bit+=7;}while(b>=128);return v>>>0;};
  const change=v=>(last+=dezig(v));
  for(let i=0;i<count/3;i++){
    const byte=src[code++],hi=byte>>>4,lo=byte&15;
    let a,b,c;
    if(hi<15){
      a=fifoGet(edges,hi*2);b=fifoGet(edges,hi*2+1);
      if(lo===0){c=next++;fifoPush(verts,c);}
      else if(lo<13)c=fifoGet(verts,lo);
      else if(lo===13){c=--last;fifoPush(verts,c);}
      else if(lo===14){c=++last;fifoPush(verts,c);}
      else{c=change(leb());fifoPush(verts,c);}
      fifoPush(edges,b);fifoPush(edges,c);fifoPush(edges,c);fifoPush(edges,a);
    }else if(lo<14){
      const e=src[aux+lo],z=e>>>4,w=e&15;
      a=next++;b=z?fifoGet(verts,z-1):next++;c=w?fifoGet(verts,w-1):next++;
      fifoPush(verts,a);if(!z)fifoPush(verts,b);if(!w)fifoPush(verts,c);
      fifoPush(edges,a);fifoPush(edges,b);fifoPush(edges,b);fifoPush(edges,c);fifoPush(edges,c);fifoPush(edges,a);
    }else{
      const e=src[data++];if(!e)next=0;
      const z=e>>>4,w=e&15;
      a=lo===14?next++:change(leb());
      b=z===0?next++:z===15?change(leb()):fifoGet(verts,z-1);
      c=w===0?next++:w===15?change(leb()):fifoGet(verts,w-1);
      fifoPush(verts,a);if(z===0||z===15)fifoPush(verts,b);if(w===0||w===15)fifoPush(verts,c);
      fifoPush(edges,a);fifoPush(edges,b);fifoPush(edges,b);fifoPush(edges,c);fifoPush(edges,c);fifoPush(edges,a);
    }
    out[at++]=a;out[at++]=b;out[at++]=c;
  }
}
function sequence(dst,count,stride,src){
  check(src[0]===0xd1&&(stride===2||stride===4),'unsupported index stream');
  const out=stride===2?new Uint16Array(dst.buffer,dst.byteOffset,count):new Uint32Array(dst.buffer,dst.byteOffset,count);
  let pos=1;const last=new Uint32Array(2);
  const leb=()=>{let v=0,bit=0,b;do{check(bit<=28,'malformed LEB128');b=src[pos++];check(b!==undefined,'truncated index stream');v|=(b&127)<<bit;bit+=7;}while(b>=128);return v>>>0;};
  for(let i=0;i<count;i++){const v=leb(),which=v&1;out[i]=last[which]+=dezig(v>>>1);}
}
decoder.decodeGltfBuffer=(out,count,stride,src,mode,filter)=>{
  check(out.byteLength===count*stride,'invalid decode output size');
  if(mode==='ATTRIBUTES')vertex(out,count,stride,src,filter);
  else if(mode==='TRIANGLES')triangle(out,count,stride,src);
  else if(mode==='INDICES')sequence(out,count,stride,src);
  else throw new Error('Meshopt unsupported codec mode '+mode);
};
decoder.decodeGltfBufferAsync=(count,stride,src,mode,filter)=>{
  const out=new Uint8Array(count*stride);decoder.decodeGltfBuffer(out,count,stride,src,mode,filter);return Promise.resolve(out);
};
root.MeshoptDecoder=decoder;
if(typeof module!=='undefined'&&module.exports)module.exports=decoder;
})(typeof window!=='undefined'?window:globalThis);
