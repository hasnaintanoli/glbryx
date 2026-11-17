/* Isolated Chrome content script: store viewer GLBs in local IndexedDB.
 * No model contents or auth tokens are ever transmitted to any external server.
 */
(() => {
'use strict';
const TAG='__MCS_CAPTURE_V1__';
const DB_NAME='meshy-capture-studio-v1';
const STORE='captured-models';
const MAX_RECORDS=12;
const MAX_BYTES=250*1024*1024;
let saving = Promise.resolve();
let previewOverlay = null;
let previewCleanup = null;

function openDB() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB cannot open'));
  });
}
function requestPromise(req) {return new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error||new Error('Storage failed'));});}
async function withStore(mode,runner) {
  const db=await openDB();
  try {
    const tx=db.transaction(STORE,mode);
    const result=await runner(tx.objectStore(STORE));
    await new Promise((res,rej)=>{tx.oncomplete=res;tx.onabort=()=>rej(tx.error||new Error('Storage aborted'));tx.onerror=()=>rej(tx.error||new Error('Storage error'));});
    return result;
  } finally {db.close();}
}
async function allRecords(){return withStore('readonly',s=>requestPromise(s.getAll()));}
async function readRecord(id){return withStore('readonly',s=>requestPromise(s.get(id)));}
async function deleteRecord(id){return withStore('readwrite',s=>{s.delete(id);return Promise.resolve();});}
async function writeRecord(record){return withStore('readwrite',s=>{s.put(record);return Promise.resolve();});}
function metadata(rec) {return {id:rec.id,name:rec.name,bytes:rec.bytes,at:rec.at,source:rec.source,origin:rec.origin,thumbnail:rec.thumbnail||null,previewError:rec.previewError||null};}
async function addThumbnail(record) {
  if (record.thumbnail || (record.previewError && record.previewVersion===2)) return record;
  record.previewError=null;
  try {
    const asset=GLBModel.parseBuffer(await record.blob.arrayBuffer());
    const prepared=await GLBModel.makeBlenderReadyGLB(asset,{convertTextures:false});
    const geometry=GLBModel.extractGeometry(GLBModel.parseBuffer(prepared.buffer));
    record.thumbnail=GLBPreview.thumbnail(geometry);
    record.previewError=null;
  } catch(error) {
    record.previewError='This model uses geometry the lightweight preview cannot render.';
    console.debug('[GLBRYX] No preview for',record.name, String(error.message||error));
  }
  record.previewVersion=2;
  await writeRecord(record);
  return record;
}
async function list() {
  const records=(await allRecords()).sort((a,b)=>b.at-a.at);
  // Also upgrade records made by previous extension versions.
  for(const record of records)await addThumbnail(record);
  return records.map(metadata);
}
function sanitize(text) {return (String(text||'meshy-model').replace(/\s+[|—–-]\s+Meshy.*$/i,'').replace(/\.(glb|obj|stl|ply|gltf)$/i,'').replace(/[^a-z0-9\-_ ]/gi,' ').replace(/\s+/g,' ').trim().slice(0,70)||'meshy-model').replace(/ /g,'_');}
function download(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.style.display='none';a.href=url;a.download=filename;
  (document.body||document.documentElement).append(a);
  a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),120_000);
}
async function capture(buffer, details) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20 || buffer.byteLength > MAX_BYTES) return;
  // Validate actual GLB structure, not just file extension or filename.
  try {GLBModel.parseBuffer(buffer);} catch {return;}
  const hash=await crypto.subtle.digest('SHA-256',buffer);
  const id=Array.from(new Uint8Array(hash)).slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join('');
  const record={id, name:sanitize(details.name),bytes:buffer.byteLength,at:Date.now(),source:String(details.source||location.href).slice(0,2000),origin:String(details.origin||'viewer'),blob:new Blob([buffer],{type:'model/gltf-binary'})};
  await addThumbnail(record);
  const records=await allRecords();
  for (const stale of records.sort((a,b)=>b.at-a.at).slice(MAX_RECORDS)) await deleteRecord(stale.id);
  try {await chrome.runtime.sendMessage({type:'MCS_CAPTURE_COUNT',count:Math.min(records.length,MAX_RECORDS)});} catch{}
  console.info('[GLBRYX] Model stored locally:',record.name,record.bytes);
}
window.addEventListener('message',(event)=>{
  if(event.source!==window || event.origin!==location.origin)return;
  const data=event.data;
  if(!data||data.tag!==TAG||data.kind!=='GLB')return;
  saving=saving.catch(()=>{}).then(()=>capture(data.buffer,data)).catch(e=>console.warn('[GLBRYX]',e));
});

function formatSize(bytes){return bytes>1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.round(bytes/1024)} KB`;}
function closePreview(){
  if(previewOverlay){
    previewOverlay.remove(); previewOverlay=null;
    document.removeEventListener('keydown',onPreviewKeydown,true);
    if(previewCleanup){previewCleanup();previewCleanup=null;}
  }
}
function onPreviewKeydown(event){if(event.key==='Escape'){closePreview();}}
async function showPreview(id) {
  const record=await readRecord(id);
  if(!record)throw new Error('Captured model not found.');
  closePreview();
  const host=document.createElement('div');
  host.id='meshy-capture-studio-preview';
  host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;display:block;isolation:isolate;';
  const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML=`
  <style>
  :host{all:initial;color-scheme:dark;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif}
  *{box-sizing:border-box}button{font:inherit;cursor:pointer}
  .screen{position:fixed;inset:0;background:rgba(2,8,16,.91);display:flex;align-items:center;justify-content:center;padding:24px;color:#e9f5ff}
  .window{width:min(100%,1070px);max-height:94vh;display:flex;flex-direction:column;min-height:450px;overflow:hidden;border:1px solid #355065;border-radius:22px;background:#0d1725;box-shadow:0 30px 100px rgba(0,0,0,.5)}
  .top{display:flex;align-items:center;gap:12px;padding:17px 21px;background:#122236;border-bottom:1px solid #294054}
  .mark{width:38px;height:38px;flex:0 0 auto;display:grid;place-items:center;border-radius:11px;background:linear-gradient(135deg,#60eeca,#649bff);font-size:24px;font-weight:900;color:#063b43}
  .title{min-width:0;flex:1}.title strong{font-size:16px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.title small{display:block;color:#a7bed2;margin-top:3px;font-size:12px}
  .close{border:1px solid #496075;border-radius:9px;background:#22374c;color:#e3f5ff;padding:8px 12px}
  .stage{position:relative;flex:1;min-height:340px;background:#08121f;overflow:hidden}
  canvas{width:100%;height:100%;display:block;touch-action:none;cursor:grab}canvas.dragging{cursor:grabbing}
  .overlay-label{position:absolute;top:16px;left:16px;padding:8px 12px;background:#0a1f2bd8;border:1px solid #345d67;border-radius:9px;font-size:12px;pointer-events:none}
  .error{position:absolute;inset:0;display:none;place-items:center;text-align:center;padding:25px;color:#fecbcb;background:#08121f}
  .bottom{display:flex;align-items:center;gap:14px;padding:16px 20px;background:#101e2e;border-top:1px solid #294054;flex-wrap:wrap}
  .stat{display:flex;flex-direction:column;gap:5px;min-width:85px}.stat small{font-size:10px;color:#90aabe;letter-spacing:.5px}.stat b{font-size:15px}
  .spacer{flex:1}.reset{background:#1c3346;color:#cae9fa;border:1px solid #355468;border-radius:9px;padding:11px 15px}
  .save{background:#68edc9;border:0;color:#04332d;font-weight:800;border-radius:9px;padding:11px 17px}
  select{background:#1b3145;border:1px solid #3d5971;border-radius:9px;color:#effaff;padding:11px 8px}
  .note{padding:10px 20px 15px;margin:0;background:#101e2e;color:#96b0c4;font-size:11px;line-height:1.5}
  @media(max-width:620px){.screen{padding:8px}.window{max-height:98vh}.stat{min-width:65px}.top{padding:12px}.stage{min-height:250px}.bottom{padding:12px;gap:9px}}
  </style>
  <section class="screen" aria-label="3D model preview">
    <div class="window" role="dialog" aria-modal="true" aria-label="3D model preview">
      <header class="top"><span class="mark">M</span><div class="title"><strong id="name"></strong><small>Interactive 3D preview · Drag to rotate · Scroll to zoom</small></div><button class="close" id="close" aria-label="Close preview">✕ Close</button></header>
      <div class="stage" id="stage"><canvas id="canvas" aria-label="3D geometric preview"></canvas><span class="overlay-label" id="label">Preparing model preview…</span><div id="error" class="error"></div></div>
      <div class="bottom"><div class="stat"><small>TRIANGLES</small><b id="triangles">—</b></div><div class="stat"><small>VERTICES</small><b id="vertices">—</b></div><div class="stat"><small>FILE SIZE</small><b id="size">—</b></div><div class="spacer"></div><button class="reset" id="reset">↺ Reset view</button><select id="format" aria-label="Download format"><option value="glb">GLB — Blender Ready (auto)</option><option value="glb-original">GLB — Original (compressed)</option><option value="obj">OBJ</option><option value="stl">STL</option><option value="ply">PLY</option><option value="gltf">glTF</option></select><button class="save" id="download">↓ Download</button></div>
      <p class="note" id="note">Blender-ready GLB automatically decompresses Meshopt and converts embedded WebP textures to PNG. Preview shows geometry and flat colors.</p>
    </div>
  </section>`;
  (document.body||document.documentElement).append(host);previewOverlay=host;
  document.addEventListener('keydown',onPreviewKeydown,true);
  const el=id=>shadow.getElementById(id);
  el('name').textContent=record.name;
  el('size').textContent=formatSize(record.bytes);
  el('close').addEventListener('click',closePreview);
  el('reset').addEventListener('click',()=>{view.yaw=.72;view.pitch=-.29;view.zoom=1;redraw();});
  const view={yaw:.72,pitch:-.29,zoom:1};
  const canvas=el('canvas');let prepared=null,dragging=false,lastX=0,lastY=0,scheduled=false;
  function redraw(){
    if(!previewOverlay||previewOverlay!==host)return;
    const rect=el('stage').getBoundingClientRect();
    const dpr=Math.min(devicePixelRatio||1,1.5);
    const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    GLBPreview.draw(canvas,prepared,view);
  }
  function requestDraw(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;redraw();});}
  canvas.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.classList.add('dragging');canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!dragging||!prepared)return;
    view.yaw+=(e.clientX-lastX)*.008;
    view.pitch=Math.max(-1.48,Math.min(1.48,view.pitch+(e.clientY-lastY)*.008));
    lastX=e.clientX;lastY=e.clientY;requestDraw();
  });
  function stopDrag(){dragging=false;canvas.classList.remove('dragging');}
  canvas.addEventListener('pointerup',stopDrag);canvas.addEventListener('pointercancel',stopDrag);
  canvas.addEventListener('wheel',e=>{if(!prepared)return;e.preventDefault();view.zoom=Math.max(.25,Math.min(5,view.zoom*(e.deltaY>0?.88:1.12)));requestDraw();},{passive:false});
  const resize=new ResizeObserver(requestDraw);resize.observe(el('stage'));
  previewCleanup=()=>resize.disconnect();
  el('download').addEventListener('click',async()=>{
    const button=el('download');const label=button.textContent;button.disabled=true;button.textContent='Exporting…';
    try {const result=await respond({type:'MCS_EXPORT',id:record.id,format:el('format').value});
      el('note').textContent='Saved: '+result.filename+' · Check Downloads';
    }catch(error){el('note').textContent=String(error.message||error);}
    finally{button.disabled=false;button.textContent=label;}
  });
  requestDraw();
  try {
    const asset=GLBModel.parseBuffer(await record.blob.arrayBuffer());
    const preparedAsset=await GLBModel.makeBlenderReadyGLB(asset,{convertTextures:false});
    const geometry=GLBModel.extractGeometry(GLBModel.parseBuffer(preparedAsset.buffer));
    if(previewOverlay!==host)return;
    prepared=GLBPreview.prepare(geometry,10000);
    el('triangles').textContent=prepared.triangles.toLocaleString();
    el('vertices').textContent=prepared.vertexCount.toLocaleString();
    el('label').textContent='3D geometry preview';
    requestDraw();
  } catch (error) {
    if(previewOverlay!==host)return;
    el('error').style.display='grid';
    el('error').textContent='This model has geometry the preview cannot decode. You can still save the original GLB below.';
    el('label').textContent='Preview unavailable';
    el('note').textContent='Preview failed: '+String(error.message||error)+' · GLB download may still work.';
  }
}

async function respond(message) {
  await saving.catch(()=>{});
  if(message.type==='MCS_LIST')return {ok:true,models:await list()};
  if(message.type==='MCS_PREVIEW'){
    if(typeof message.id!=='string')throw new Error('No model selected');
    // Begin displaying the overlay without blocking Chrome's popup message channel
    // on a large model parse; it reports its own preview errors inside the overlay.
    showPreview(message.id).catch(error=>console.warn('[GLBRYX] Preview failed:',error));
    return {ok:true};
  }
  if(message.type==='MCS_DELETE'){
    if(typeof message.id!=='string')throw new Error('No model selected');
    await deleteRecord(message.id);
    return {ok:true,models:await list()};
  }
  if(message.type==='MCS_EXPORT'){
    const record=await readRecord(message.id);
    if(!record)throw new Error('This model is not in local capture history. Reopen its Meshy viewer and reload.');
    const format=String(message.format||'glb').toLowerCase();
    const buffer=await record.blob.arrayBuffer();
    let blob;
    if(format==='glb-original')blob=record.blob;
    else {
      const original=GLBModel.parseBuffer(buffer);
      const converted=await GLBModel.makeBlenderReadyGLB(original);
      const asset=GLBModel.parseBuffer(converted.buffer);
      if(format==='glb')blob=new Blob([converted.buffer],{type:'model/gltf-binary'});
      else if(format==='gltf')blob=GLBModel.makeGLTF(asset);
      else {
        const geometry=GLBModel.extractGeometry(asset);
        if(format==='obj')blob=GLBModel.makeOBJ(geometry);
        else if(format==='stl')blob=GLBModel.makeSTL(geometry);
        else if(format==='ply')blob=GLBModel.makePLY(geometry);
        else throw new Error('Unknown export format');
      }
    }
    const filename=`${record.name}.${format==='glb-original'?'original.glb':format==='glb'?'blender.glb':format}`;
    download(blob,filename);
    return {ok:true,filename};
  }
  return {ok:false,error:'Unsupported action'};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!message?.type?.startsWith('MCS_'))return;
  respond(message).then(sendResponse).catch(error=>sendResponse({ok:false,error:String(error.message||error)}));
  return true;
});
})();
