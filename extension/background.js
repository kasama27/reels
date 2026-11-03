// Service worker: ตัวกลางคุยกับ Arn Reels (http://127.0.0.1:8791) ด้วยรหัสจับคู่ + ดึงไฟล์วิดีโอจากโดเมนของ Meta ให้ content script
// (content script ติดข้อจำกัด CORS ของหน้า meta.ai แต่ service worker ใช้สิทธิ์ host_permissions ได้)
// ไม่เก็บอะไรนอกจาก serverUrl / token / projectId ใน chrome.storage.local และไม่ยิงไปที่อื่น

const DEFAULT_URL = 'http://127.0.0.1:8791';
// โดเมนที่ยอมให้ดึงไฟล์วิดีโอ (ตรงกับ host_permissions) — กันไม่ให้ extension ถูกใช้ดึงลิงก์ทั่วไป
const REMOTE_OK = /(^|\.)(meta\.ai|facebook\.com|fbcdn\.net|fbsbx\.com|googleusercontent\.com|storage\.googleapis\.com)$/i;
const MAX_BYTES = 45_000_000; // ข้อความระหว่างส่วนต่าง ๆ ของ extension จำกัด ~64MB และ base64 ใหญ่ขึ้น ~33%

async function settings() {
  const v = await chrome.storage.local.get(['serverUrl', 'token', 'projectId']);
  return { serverUrl: (v.serverUrl || DEFAULT_URL).replace(/\/+$/, ''), token: v.token || '', projectId: v.projectId || null };
}

async function call(path, opts = {}) {
  const s = await settings();
  if (!s.token) throw new Error('ยังไม่ได้ใส่รหัสจับคู่ — คลิกไอคอนส่วนเสริมเพื่อเปิดหน้าตั้งค่า');
  let res;
  try {
    res = await fetch(s.serverUrl + path, { ...opts, headers: { 'x-arn-token': s.token, ...(opts.headers || {}) } });
  } catch {
    throw new Error('ต่อ Arn Reels ไม่ได้ — เปิดแอป Arn Reels บนเครื่องนี้ก่อน (หรือเช็กที่อยู่เซิร์ฟเวอร์ในตั้งค่า)');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function handle(m) {
  switch (m.type) {
    case 'ping': return call('/ext/ping');
    case 'projects': return call('/ext/projects');
    case 'next': return call(`/ext/projects/${Number(m.projectId)}/next`);
    case 'getState': return settings();
    case 'setProject': await chrome.storage.local.set({ projectId: m.projectId || null }); return {};
    case 'upload': { // ส่งวิดีโอ (base64) เข้าช็อตของ Arn Reels
      const bytes = b64ToBytes(m.b64);
      return call(`/ext/shots/${Number(m.shotId)}/video`, { method: 'PUT', headers: { 'content-type': m.mime }, body: bytes });
    }
    // คลิปสินค้า: คิวถัดไป / รูปที่ต้องแนบ (ไบต์ → base64 ให้ content script สร้างไฟล์) / ส่งวิดีโอดิบกลับ
    case 'productNext': return call('/ext/products/next');
    // หาสินค้าบน affiliate.shopee.co.th: เช็กว่ามีในคลังแล้วไหม / ส่งที่ติ๊กเข้าคลัง (+ คิวคลิปสินค้า)
    case 'shopeeKnown': return call('/ext/products/known', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: m.ids }) });
    case 'shopeeImport': return call('/ext/products/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: m.items, queue: !!m.queue }) });
    case 'productImage': {
      const s = await settings();
      if (!/^[0-9a-f]{40}\.(jpg|png|webp)$/.test(String(m.file))) throw new Error('ชื่อรูปไม่ถูกต้อง');
      let r;
      try { r = await fetch(`${s.serverUrl}/ext/img/${m.file}`, { headers: { 'x-arn-token': s.token } }); } catch { throw new Error('ต่อ Arn Reels ไม่ได้'); }
      if (!r.ok) throw new Error(`ดึงรูปไม่ได้ (HTTP ${r.status})`);
      return { mime: (r.headers.get('content-type') || 'image/jpeg').split(';')[0], b64: bytesToB64(new Uint8Array(await r.arrayBuffer())) };
    }
    case 'uploadRaw': {
      const bytes = b64ToBytes(m.b64);
      return call(`/ext/clips/${Number(m.clipId)}/raw`, { method: 'PUT', headers: { 'content-type': m.mime }, body: bytes });
    }
    case 'fetchRemote': { // ดึงไฟล์วิดีโอจาก CDN ของ Meta (ใช้คุกกี้ของเบราว์เซอร์ตามปกติ)
      let u;
      try { u = new URL(m.url); } catch { throw new Error('ลิงก์วิดีโอไม่ถูกต้อง'); }
      if (u.protocol !== 'https:' || !REMOTE_OK.test(u.hostname)) throw new Error(`ไม่รองรับการดึงวิดีโอจากโดเมน ${u.hostname}`);
      const r = await fetch(u.href, { credentials: 'include' });
      if (!r.ok) throw new Error(`ดึงวิดีโอไม่ได้ (HTTP ${r.status})`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('วิดีโอใหญ่เกิน 45MB — ดาวน์โหลดแล้วแนบเองในหน้าโปรเจกต์แทน');
      return { mime: (r.headers.get('content-type') || 'video/mp4').split(';')[0], b64: bytesToB64(buf) };
    }
    // โพสต์ลงเพจ: คลิปพร้อมโพสต์ถัดไป / วิดีโอทีละชิ้น (ข้อความระหว่างส่วนของ extension ใหญ่ไม่ได้) / บันทึกว่าโพสต์แล้ว
    case 'postNext': return call(`/ext/post/next${m.photo ? '?type=photo' : ''}`);
    case 'postPhoto': {
      const s = await settings();
      let r;
      try { r = await fetch(`${s.serverUrl}/ext/clips/${Number(m.clipId)}/photo`, { headers: { 'x-arn-token': s.token } }); } catch { throw new Error('ต่อ Arn Reels ไม่ได้'); }
      if (!r.ok) throw new Error(`ดึงรูปโพสต์ไม่ได้ (HTTP ${r.status})`);
      return { b64: bytesToB64(new Uint8Array(await r.arrayBuffer())) };
    }
    // เควสจากหน้าสถานะเพจ (facebook.com/professional_dashboard/status)
    case 'questSync': return call('/ext/quests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ week: String(m.week || ''), items: Array.isArray(m.items) ? m.items.slice(0, 12) : [], channel: m.channel || '' }) });
    case 'postChunk': {
      const s = await settings();
      const start = Math.max(0, Number(m.start) || 0), len = Math.min(8_000_000, Math.max(1, Number(m.len) || 0));
      let r;
      try { r = await fetch(`${s.serverUrl}/ext/clips/${Number(m.clipId)}/video`, { headers: { 'x-arn-token': s.token, range: `bytes=${start}-${start + len - 1}` } }); } catch { throw new Error('ต่อ Arn Reels ไม่ได้'); }
      if (!r.ok) throw new Error(`ดึงวิดีโอไม่ได้ (HTTP ${r.status})`);
      return { b64: bytesToB64(new Uint8Array(await r.arrayBuffer())) };
    }
    case 'postCover': {
      const s = await settings();
      let r;
      try { r = await fetch(`${s.serverUrl}/ext/clips/${Number(m.clipId)}/cover`, { headers: { 'x-arn-token': s.token } }); } catch { throw new Error('ต่อ Arn Reels ไม่ได้'); }
      if (!r.ok) { let e = ''; try { e = (await r.json()).error; } catch { /* ไม่มี */ } throw new Error(e || `ดึงหน้าปกไม่ได้ (HTTP ${r.status})`); }
      return { b64: bytesToB64(new Uint8Array(await r.arrayBuffer())) };
    }
    case 'postDone': return call(`/ext/clips/${Number(m.clipId)}/posted`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fb_url: m.fbUrl || '' }) });
    default: throw new Error('คำสั่งไม่รู้จัก');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // รับเฉพาะข้อความจาก extension นี้เอง (content script ของเรา)
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg).then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: e.message }));
  return true; // ตอบแบบ async
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
