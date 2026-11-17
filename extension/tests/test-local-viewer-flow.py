from pathlib import Path
from playwright.sync_api import sync_playwright
from tempfile import TemporaryDirectory
import json, struct
root=Path(__file__).resolve().parents[1]
html=(root/'viewer.html').read_text().replace('<script defer src="js/meshopt_reference.js"></script>','').replace('<script defer src="js/glb.js"></script>','').replace('<script defer src="viewer.js"></script>','').replace('<link rel="stylesheet" href="viewer.css" />','')
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page(accept_downloads=True,viewport={'width':1300,'height':800})
  page.set_content(html)
  page.add_style_tag(path=str(root/'viewer.css'))
  for f in ('js/meshopt_reference.js','js/glb.js','viewer.js'):
    page.add_script_tag(path=str(root/f))
  page.locator('#fileInput').set_input_files(str(root/'sample/demo-cube-meshopt.glb'))
  page.wait_for_function("document.querySelector('#status').textContent.includes('Ready for Blender')",timeout=15000)
  assert '2 Meshopt buffer(s) decompressed' in page.locator('#status').inner_text()
  assert page.locator('#triangles').inner_text()=='12'
  with page.expect_download(timeout=12000) as d:
    page.locator('[data-format="glb"]').click()
  with TemporaryDirectory() as tmp:
    download=d.value
    assert download.suggested_filename.endswith('_blender.glb'),download.suggested_filename
    path=Path(tmp)/'model.glb'
    download.save_as(path)
    raw=path.read_bytes()
    assert raw[:4]==b'glTF'
    jsonlen=struct.unpack_from('<I',raw,12)[0]
    data=json.loads(raw[20:20+jsonlen].decode())
    assert 'EXT_meshopt_compression' not in data.get('extensionsRequired',[])
    assert all('EXT_meshopt_compression' not in bv.get('extensions',{}) for bv in data['bufferViews'])
  print('PASS: local viewer imported meshopt GLB, previewed 12 triangles, default download generated valid uncompressed GLB')
  browser.close()
