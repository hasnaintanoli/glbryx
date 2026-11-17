from pathlib import Path
from playwright.sync_api import sync_playwright
import base64, tempfile, time, json, os

ROOT = Path(__file__).resolve().parents[1]
GLB = base64.b64encode((ROOT / 'sample/demo-cube.glb').read_bytes()).decode()
PAGE = '''<!doctype html><html><head><title>Demo Cube - Meshy</title></head><body>
<h1>Test Meshy Model</h1>
<script>
  const base64 = "''' + GLB + '''";
  const b = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0)).buffer;
  const workerText = "onmessage=e=>postMessage(e.data,[e.data])";
  const worker = new Worker(URL.createObjectURL(new Blob([workerText],{type:'text/javascript'})));
  worker.addEventListener('message', () => { window.__workerFinished = true; });
  worker.postMessage(b, [b]);
</script></body></html>'''

with sync_playwright() as p:
    userdir = tempfile.mkdtemp(prefix='meshy-browser-')
    ctx=p.chromium.launch_persistent_context(
        userdir,
        executable_path='/usr/bin/chromium',
        headless=(os.environ.get('MCS_HEADLESS','1')=='1'),
        accept_downloads=True,
        args=[
            '--no-sandbox',
            '--disable-gpu',
            f'--disable-extensions-except={ROOT}',
            f'--load-extension={ROOT}',
            '--ignore-certificate-errors'
        ],
    )
    ctx.route('https://www.meshy.ai/**', lambda route: route.fulfill(status=200,body=PAGE,headers={'content-type':'text/html'}))
    workers=ctx.service_workers
    for _ in range(60):
        if workers:break
        time.sleep(.15)
        workers=ctx.service_workers
    print('Service workers:', [w.url for w in workers]); assert workers, 'extension service worker missing'
    eid=workers[0].url.split('/')[2]
    page=ctx.new_page()
    page.goto('https://www.meshy.ai/workspace',wait_until='domcontentloaded')
    page.wait_for_function('window.__workerFinished === true',timeout=12000)
    page.wait_for_timeout(1000)
    popup=ctx.new_page()
    popup.goto(f'chrome-extension://{eid}/popup.html',wait_until='domcontentloaded')
    popup.wait_for_timeout(1500)
    print('Popup status:',popup.locator('#status').inner_text())
    print('Captured count:',popup.locator('#counter').inner_text())
    print('Cards:',popup.locator('#cards').inner_text()[:180])
    assert popup.locator('#counter').inner_text() == '1', 'GLB capture not stored'
    with popup.expect_download(timeout=15000) as result:
        popup.get_by_role('button',name='Save model').first.click()
    down=result.value
    print('Downloaded:',down.suggested_filename)
    assert down.suggested_filename.endswith('.glb')
    with popup.expect_download(timeout=15000) as result:
        popup.locator('select').first.select_option('stl')
        popup.get_by_role('button',name='Save model').first.click()
    down=result.value
    print('STL downloaded:',down.suggested_filename)
    assert down.suggested_filename.endswith('.stl')
    ctx.close()
print('PASS: Chromium extension captures Worker GLB and downloads GLB + STL')
