from pathlib import Path
from playwright.sync_api import sync_playwright
import base64
root=Path(__file__).resolve().parents[1]
fixture=(root/'sample/demo-cube-webp.glb').read_bytes()
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content('<!doctype html><html><body></body></html>')
    page.add_script_tag(path=str(root/'js/meshopt_reference.js'))
    page.add_script_tag(path=str(root/'js/glb.js'))
    result=page.evaluate('''async (encoded)=>{
      const data=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      const asset=GLBModel.parseBuffer(data.buffer);
      const conv=await GLBModel.makeBlenderReadyGLB(asset);
      const glb=GLBModel.parseBuffer(conv.buffer);
      const img=glb.json.images[0],view=glb.json.bufferViews[img.bufferView];
      const sig=[...glb.bin.subarray(view.byteOffset,view.byteOffset+8)];
      return {textures:conv.textures,meshopt:conv.meshopt, extensions:glb.json.extensionsRequired,
        mime:img.mimeType,src:glb.json.textures[0].source,sig,triangles:GLBModel.extractGeometry(glb).faces.length};
    }''', base64.b64encode(fixture).decode())
    assert result['textures']==1,result
    assert result['mime']=='image/png',result
    assert result['extensions'] is None,result
    assert result['sig']==[137,80,78,71,13,10,26,10],result
    assert result['src']==0,result
    assert result['triangles']==12,result
    print('PASS: WebP texture converted to PNG and embedded, references fixed, geometry unchanged:',result)
    browser.close()
