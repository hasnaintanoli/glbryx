'use strict';
const $=id=>document.getElementById(id);
let tabId=null;
const formats=['glb','glb-original','obj','stl','ply','gltf'];
function setStatus(message,type=''){$('status').textContent=message;$('status').className=`status ${type}`;}
function filesize(bytes){return bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${(bytes/1024).toFixed(0)} KB`;}
async function findMeshyTab() {
  const active=await chrome.tabs.query({active:true,currentWindow:true});
  const matches=t=>/^https:\/\/([a-z0-9-]+\.)?meshy\.ai\//i.test(t?.url||'');
  if(matches(active[0]))return active[0];
  const tabs=await chrome.tabs.query({url:['https://meshy.ai/*','https://*.meshy.ai/*']});
  return tabs.find(matches)||null;
}
async function send(type,args={}){
  if(tabId==null)throw new Error('No Meshy tab open. Open a model on Meshy and reload the page.');
  const resp=await chrome.tabs.sendMessage(tabId,{type,...args});
  if(!resp?.ok)throw new Error(resp?.error||'Meshy tab is not responding');
  return resp;
}
function render(models){
  $('counter').textContent=models.length;
  const container=$('cards');container.replaceChildren();
  if(!models.length){
    const empty=document.createElement('div');empty.className='empty';
    empty.textContent='No 3D model captured yet. Open your generated Meshy model, refresh the page, and wait until its 3D preview finishes loading. Then click Refresh here.';
    container.append(empty);return;
  }
  for(const model of models){
    const card=document.createElement('article');card.className='model';
    const previewFrame=document.createElement('button');
    previewFrame.className='model-preview';
    previewFrame.setAttribute('aria-label',`Preview ${model.name} in 3D`);
    previewFrame.title='Click to open interactive 3D preview';
    if(model.thumbnail){
      const thumbnail=document.createElement('img');thumbnail.className='model-image';
      thumbnail.src=model.thumbnail;thumbnail.alt=`Geometry preview of ${model.name}`;
      previewFrame.append(thumbnail);
    } else {
      const placeholder=document.createElement('span');placeholder.className='no-preview';
      placeholder.textContent=model.previewError?'Preview unavailable for this GLB':'3D Preview';
      previewFrame.append(placeholder);
    }
    const badge=document.createElement('span');badge.className='preview-pill';
    badge.textContent=model.thumbnail?'↗ View in 3D':'⬡ View model';
    previewFrame.append(badge);
    const openPreview=async()=>{
      try {
        setStatus('Opening 3D preview…');
        await send('MCS_PREVIEW',{id:model.id});
        await chrome.tabs.update(tabId,{active:true});
        window.close();
      } catch(error){setStatus('Preview failed: '+error.message,'error');}
    };
    previewFrame.addEventListener('click',openPreview);
    const header=document.createElement('div');header.className='model-header';
    const icon=document.createElement('div');icon.className='model-icon';icon.textContent='⬡';
    const info=document.createElement('div');info.className='model-info';
    const title=document.createElement('strong');title.textContent=model.name;title.title=model.name;
    const small=document.createElement('small');small.textContent=`${filesize(model.bytes)} · Captured ${new Date(model.at).toLocaleString()}`;
    info.append(title,small);header.append(icon,info);
    const controls=document.createElement('div');controls.className='export-row';
    const select=document.createElement('select');select.setAttribute('aria-label',`Export ${model.name} as`);
    for(const format of formats){const option=document.createElement('option');option.value=format;option.textContent=format==='glb'?'GLB · Blender Ready':format==='glb-original'?'GLB · Original':format.toUpperCase();select.append(option);}
    const save=document.createElement('button');save.textContent='Save model';
    save.addEventListener('click',async()=>{
      save.disabled=true;save.textContent='Exporting…';
      try{const reply=await send('MCS_EXPORT',{id:model.id,format:select.value});setStatus(`Saved: ${reply.filename}`,'ok');}
      catch(e){setStatus(`Export failed: ${e.message}`,'error');}
      finally{save.disabled=false;save.textContent='Save model';}
    });
    const view=document.createElement('button');
    view.className='view-btn';view.textContent='View in 3D';
    view.addEventListener('click',openPreview);
    controls.append(view,select,save);
    const foot=document.createElement('div');foot.className='model-footer';
    const source=document.createElement('span');source.textContent=`Source: ${model.origin||'3D viewer'}`;
    const remove=document.createElement('button');remove.textContent='Remove';
    remove.addEventListener('click',async()=>{
      try{const reply=await send('MCS_DELETE',{id:model.id});render(reply.models);setStatus('Removed from local capture history.','ok');}
      catch(e){setStatus(e.message,'error');}
    });
    foot.append(source,remove);card.append(previewFrame,header,controls,foot);container.append(card);
  }
}
async function refresh(){
  try{
    const tab=await findMeshyTab();
    if(!tab){tabId=null;render([]);setStatus('No Meshy tab found. Open meshy.ai and load a model.','error');return;}
    tabId=tab.id;
    const data=await send('MCS_LIST');render(data.models);
    if(data.models.length)setStatus(`${data.models.length} model(s) available for local export.`,'ok');
    else setStatus('Meshy is open; waiting for 3D model data to load.');
  }catch(e){setStatus('Reload your Meshy model page, then press Refresh. '+e.message,'error');render([]);}
}
$('refresh').addEventListener('click',refresh);
$('openViewer').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('viewer.html')}));
$('openMeshy').addEventListener('click',()=>chrome.tabs.create({url:'https://www.meshy.ai/workspace'}));
refresh();
