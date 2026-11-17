from pathlib import Path
from playwright.sync_api import sync_playwright
import base64

root=Path(__file__).resolve().parents[1]
encoded=base64.b64encode((root/'sample/demo-cube.glb').read_bytes()).decode()
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':640,'height':480}, device_scale_factor=1)
    page.set_content('<!doctype html><html><body style="margin:0;background:#091420"><canvas id="test" width="640" height="440"></canvas></body></html>')
    page.add_script_tag(path=str(root/'js/glb.js'))
    page.add_script_tag(path=str(root/'js/preview.js'))
    result=page.evaluate('''(base64)=> {
      const bytes=Uint8Array.from(atob(base64),ch=>ch.charCodeAt(0));
      const parsed=GLBModel.parseBuffer(bytes.buffer);
      const geo=GLBModel.extractGeometry(parsed);
      const sample=GLBPreview.prepare(geo);
      const canvas=document.getElementById('test');
      GLBPreview.draw(canvas,sample,{yaw:.65,pitch:-.28,zoom:1});
      const img=GLBPreview.thumbnail(geo);
      return {faces:sample.faces.length,vertices:sample.vertices.length,thumbnail:img.slice(0,35),thumbLength:img.length};
    }''', encoded)
    assert result['faces'] > 0, result
    assert result['thumbnail'].startswith('data:image/jpeg;base64,'), result
    assert result['thumbLength'] > 600, result
    page.locator('#test').screenshot(path=str(root/'tests/preview-sample.png'))
    print('PASS: model preview rendering + thumbnail generation:',result)
    browser.close()
