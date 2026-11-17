/* GLBRYX — page-world capture of valid GLB 2.0 byte streams.
 * Captures data that the visited viewer has already loaded, without making
 * account/API requests, collecting tokens, or uploading data.
 */
(() => {
  'use strict';
  if (window.__MCS_PAGE_HOOK__) return;
  Object.defineProperty(window, '__MCS_PAGE_HOOK__', {value: true, configurable: false});
  const TAG = '__MCS_CAPTURE_V1__';
  const MAGIC = 0x46546c67;
  const LIMIT = 250 * 1024 * 1024;
  const recent = new Map();

  function asGLB(value) {
    let bytes;
    if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else return null;
    if (bytes.length < 20 || bytes.length > LIMIT) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== 2) return null;
    const declaredSize = dv.getUint32(8, true);
    if (declaredSize < 20 || declaredSize > bytes.byteLength) return null;
    const firstChunk = dv.getUint32(16, true);
    if (firstChunk !== 0x4E4F534A) return null; // JSON
    return bytes.slice(0, declaredSize).buffer;
  }

  function deepFind(value, depth = 0, seen = new Set()) {
    const hit = asGLB(value);
    if (hit) return hit;
    if (!value || typeof value !== 'object' || depth >= 4 || seen.has(value)) return null;
    seen.add(value);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Blob) return null;
    for (const key of Object.keys(value).slice(0, 24)) {
      let nested;
      try {nested = value[key];} catch {continue;}
      const found = deepFind(nested, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  function emit(value, origin) {
    try {
      const buffer = deepFind(value);
      if (!buffer) return;
      const bytes = new Uint8Array(buffer);
      const signature = `${bytes.byteLength}:${Array.from(bytes.subarray(0, 48)).join(',')}:${Array.from(bytes.subarray(Math.max(0, bytes.length - 16))).join(',')}`;
      const now = Date.now();
      if (now - (recent.get(signature) || 0) < 45_000) return;
      recent.set(signature, now);
      if (recent.size > 30) for (const [key, time] of recent) if (now - time > 60_000) recent.delete(key);
      const path = window.location.pathname;
      window.postMessage({tag: TAG, kind: 'GLB', buffer, name: (() => {const heading=document.querySelector('h1');const value=heading?.textContent?.trim();return value && value.length <= 90 ? value : (document.title || 'Meshy 3D Model');})(), source: window.location.href, path, origin}, location.origin, [buffer]);
      console.debug('[GLBRYX] GLB viewer data detected:', bytes.byteLength, 'bytes via', origin);
    } catch (error) {
      console.debug('[GLBRYX] capture skipped:', String(error));
    }
  }

  // Most Meshy model viewers use a worker to prepare the decrypted GLB buffer.
  // Watch the replies instead of depending on private endpoint names.
  const OriginalWorker = window.Worker;
  if (typeof OriginalWorker === 'function') {
    class ObservedWorker extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => emit(event.data, 'worker'));
      }
    }
    try {window.Worker = ObservedWorker;} catch { /* browser may forbid replacement */ }
  }

  // Some viewers fetch regular GLB files directly instead of using workers.
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function(...args) {
      const result = Reflect.apply(originalFetch, this, args);
      try {
        const req = args[0];
        const url = typeof req === 'string' ? req : req?.url || '';
        if (/\.glb(?:[?#]|$)/i.test(url)) {
          Promise.resolve(result).then(response => {
            const size = Number(response.headers.get('content-length')) || 0;
            if (response.ok && size < LIMIT) response.clone().arrayBuffer().then(buf => emit(buf, 'fetch')).catch(()=>{});
          }).catch(()=>{});
        }
      } catch { /* Don't affect Meshy's own request */ }
      return result;
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (typeof OriginalXHR === 'function') {
    const originalOpen = OriginalXHR.prototype.open;
    OriginalXHR.prototype.open = function(method, url, ...rest) {
      this.__mcsGlbUrl = /\.glb(?:[?#]|$)/i.test(String(url || ''));
      return originalOpen.call(this, method, url, ...rest);
    };
    const originalSend = OriginalXHR.prototype.send;
    OriginalXHR.prototype.send = function(...args) {
      if (this.__mcsGlbUrl) {
        this.addEventListener('loadend', () => {
          try { if (this.status >= 200 && this.status < 300) emit(this.response, 'xhr'); } catch {}
        }, {once:true});
      }
      return originalSend.apply(this,args);
    };
  }
})();
