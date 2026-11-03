// รันใน "โลกของหน้าเว็บ" (world: MAIN) บน affiliate.shopee.co.th ตั้งแต่เริ่มโหลด
// 1) แอบดูคำตอบ JSON ของ API ในหน้า (fetch/XHR) แล้วส่งสำเนาให้แผง Arn Reels (shopee.js) — ไว้อ่านรายการสินค้า + "เรียนรู้" รูปแบบคำขอค้นหา
// 2) รับคำสั่งจากแผงให้ยิงคำขอแบบเดียวกับที่หน้าเว็บยิง (ใช้คุกกี้/ล็อกอินของคุณตามปกติ) แล้วส่งผลกลับ
// ไม่ส่งอะไรออกนอกเครื่อง ไม่แตะคำขออื่นนอกจาก /api/ ของเว็บแอฟฟิลิเอตเอง
(() => {
  if (window.__arnShpHook) return;
  window.__arnShpHook = true;
  // คีย์เวิร์ดที่ส่งมาจากหน้า Arn Reels (#arn_kw=…&arn_n=…) → เก็บไว้ให้แผง (shopee.js) แล้วเอาออกจาก URL ก่อนเว็บเริ่มทำงาน
  try {
    const hp = new URLSearchParams(location.hash.slice(1));
    if (hp.get('arn_kw')) {
      sessionStorage.setItem('arnShpKw', JSON.stringify({ kw: hp.get('arn_kw').slice(0, 80), n: Number(hp.get('arn_n')) || 0, shop: hp.get('arn_shop') === '1', at: Date.now() }));
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  } catch { /* ไม่เป็นไร */ }
  const TAG = 'arn-shp';
  const ORIGIN = location.origin;
  const origFetch = window.fetch.bind(window);
  const MAX = 3_000_000;
  const isApi = (u) => { try { const x = new URL(u, location.href); return x.origin === ORIGIN && x.pathname.startsWith('/api/'); } catch { return false; } };
  const post = (msg) => window.postMessage({ tag: TAG, dir: 'up', ...msg }, ORIGIN);
  const hdrObj = (h) => {
    const out = {};
    if (!h) return out;
    if (h instanceof Headers) h.forEach((v, k) => { out[k] = v; });
    else if (Array.isArray(h)) h.forEach(([k, v]) => { out[k] = v; });
    else Object.assign(out, h);
    return out;
  };
  const buf = []; // คำตอบล่าสุดของหน้า (แผงโหลดทีหลัง ขอย้อนดูได้)
  const report = (url, method, body, headers, text, status) => {
    if (!text || text.length > MAX || text[0] !== '{' && text[0] !== '[') return;
    const cap = { kind: 'cap', url: new URL(url, location.href).href, method, body: typeof body === 'string' ? body.slice(0, 20000) : '', headers, status, text };
    if (/\/offer\/(product|shop)\/list|productOfferLink/i.test(cap.url)) { buf.push(cap); if (buf.length > 12) buf.shift(); }
    post(cap);
  };

  window.fetch = async function (input, init = {}) {
    const res = await origFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input.url;
      if (isApi(url)) {
        const method = (init.method || (input && input.method) || 'GET').toUpperCase();
        const headers = { ...hdrObj(input && input.headers), ...hdrObj(init.headers) };
        res.clone().text().then((t) => report(url, method, init.body, headers, t, res.status)).catch(() => {});
      }
    } catch { /* ไม่ให้กระทบหน้าเว็บ */ }
    return res;
  };

  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send, XH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__arn = { method: String(method || 'GET').toUpperCase(), url: String(url), headers: {} }; return XO.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__arn) this.__arn.headers[k] = v; return XH.call(this, k, v); };
  XMLHttpRequest.prototype.send = function (body) {
    const a = this.__arn;
    if (a && isApi(a.url)) {
      this.addEventListener('load', () => {
        try { if (this.responseType === '' || this.responseType === 'text') report(a.url, a.method, body, a.headers, this.responseText, this.status); } catch { /* ข้าม */ }
      });
    }
    return XS.call(this, body);
  };

  // คำสั่งจากแผง: { dir:'down', id, url, method, headers, body } → ยิงด้วย fetch เดิมของหน้า (same-origin เท่านั้น)
  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.tag !== TAG || m.dir !== 'down') return;
    if (m.op === 'dump') { for (const c of buf) post({ ...c, replay: true }); return; } // แผงขอดูคำตอบที่หน้าโหลดไปแล้ว
    let out;
    try {
      if (!isApi(m.url)) throw new Error('ยิงได้เฉพาะ API ของเว็บนี้');
      const h = { ...(m.headers || {}) };
      for (const k of Object.keys(h)) if (/^(content-length|host|cookie)$/i.test(k)) delete h[k];
      const opts = { method: m.method || 'GET', headers: h, body: m.method && m.method !== 'GET' ? m.body : undefined, credentials: 'include' };
      // ใช้ fetch "ปัจจุบัน" ของหน้า (ไม่ใช่ origFetch ที่จับไว้ตอนเริ่มโหลด) — ระบบความปลอดภัยของเว็บห่อ fetch/XHR ทีหลังเพื่อเติมหัวลายเซ็น
      // ถ้ายิงด้วยตัวที่ยังไม่ถูกห่อ เว็บตอบ 403 (เจอจริง 31 ต.ค.) · ยัง 401/403 → ลองผ่าน XMLHttpRequest อีกทาง
      let r = await window.fetch(m.url, opts);
      let text = await r.text();
      if (r.status === 401 || r.status === 403) {
        const x = await new Promise((resolve) => {
          const q = new XMLHttpRequest();
          q.open(opts.method, m.url, true);
          q.withCredentials = true;
          for (const [k, v] of Object.entries(h)) { try { q.setRequestHeader(k, v); } catch { /* หัวต้องห้าม */ } }
          q.onload = () => resolve({ status: q.status, text: q.responseText });
          q.onerror = () => resolve({ status: 0, text: '' });
          q.send(opts.body);
        });
        if (x.status && x.status !== 401 && x.status !== 403) r = { ok: x.status >= 200 && x.status < 300, status: x.status }, text = x.text;
      }
      out = { ok: r.ok, status: r.status, text: String(text).slice(0, MAX) };
    } catch (err) { out = { ok: false, status: 0, error: String(err && err.message || err) }; }
    post({ kind: 'reply', id: m.id, ...out });
  });
})();
