from pathlib import Path
from playwright.sync_api import sync_playwright
import base64
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':480,'height':750})
    page.set_content((root/'popup.html').read_text())
    page.add_style_tag(path=str(root/'styles.css'))
    page.add_script_tag(path=str(root/'js/glb.js'))
    page.add_script_tag(path=str(root/'js/preview.js'))
    source=base64.b64encode((root/'sample/demo-cube.glb').read_bytes()).decode()
    page.evaluate('''(source)=>{
      const b=Uint8Array.from(atob(source),c=>c.charCodeAt(0));
      window.__testThumb=GLBPreview.thumbnail(GLBModel.extractGeometry(GLBModel.parseBuffer(b.buffer)));
    }''',source)
    page.evaluate('''
      globalThis.chrome={
        tabs:{
          query: async ()=>[{id:1,url:'https://www.meshy.ai/workspace'}],
          sendMessage:async(id,message)=>message.type==='MCS_LIST'?{ok:true,models:[{id:'cube',name:'Sample Generated Cube',bytes:812,at:Date.now(),origin:'worker',thumbnail:window.__testThumb}]}:{ok:true,filename:'cube.glb'},
          create:async()=>{},update:async()=>{}
        },runtime:{getURL:(s)=>s}
      };
    ''')
    page.add_script_tag(path=str(root/'popup.js'))
    page.locator('.model-preview').wait_for(timeout=5000)
    assert page.locator('.model').count()==1
    assert page.locator('.model-image').count()==1
    assert page.get_by_role('button',name='View in 3D').count()==1
    assert page.get_by_role('button',name='Save model').count()==1
    page.screenshot(path=str(root/'tests/popup-sample.png'))
    print('PASS: popup gallery includes thumbnail, 3D preview button and download controls')
    browser.close()

