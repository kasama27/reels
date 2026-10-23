// arn-reels —คลังคลิป Facebook Reels: ใส่เนื้อหา → สคริปต์ → เรนเดอร์คลิป → AI แคปชัน → เก็บใน SQLite
// รัน: node server.js   (http://127.0.0.1:8791) — ไม่มี auth ตั้งใจให้ใช้บนเครื่องตัวเองเท่านั้น
const http = require('http');
const fs = require('fs');
const crypto = require('node:crypto');
const path = require('path');
const cfg = require('./lib/config');
const ctx = require('./lib/ctx');
const db = require('./lib/db');
const ai = require('./lib/ai');
const { renderClip, ffmpegOk, THEMES, THEME_INFO } = require('./lib/render');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.ico': 'image/x-icon',
};

const tts = require('./lib/tts');
const cli = require('./lib/claude-cli');
const feeds = require('./lib/feeds');
const brandLib = require('./lib/brand');
const story = require('./lib/story');
const { parsePromptScript } = require('./lib/promptimport');
const pondy = require('./lib/pondy');

const feedCache = new Map(); // feedId -> { t, items }  (แคช 5 นาที ไม่ยิงเว็บข่าวถี่เกิน)

// เพลงพื้นหลัง: สร้างสดในเบราว์เซอร์ (ไม่มีลิขสิทธิ์) หรือไฟล์ของผู้ใช้ในโฟลเดอร์ music/
const LOGO_FILE = path.join(db.DATA_DIR, 'brand-logo.png'); // โลโก้เพจ (PNG พื้นใส) — แปลงฝั่งหน้าเว็บก่อนอัปโหลด
const IMG_DIR = path.join(db.DATA_DIR, 'data', 'clip-images'); // รูปประกอบคลิปที่ผู้ใช้เลือกจากเว็บ (ชื่อไฟล์ = sha1 ของเนื้อไฟล์)
fs.mkdirSync(IMG_DIR, { recursive: true });
if (!cfg.extToken) cfg.save({ extToken: crypto.randomBytes(24).toString('hex') });
const IMG_NAME = /^[0-9a-f]{40}\.(jpg|png|webp)$/;
const STORY_VIDEO_DIR = path.join(db.DATA_DIR, 'data', 'story-videos'); // คลิปต่อช็อตที่แนบจาก Meta AI (โปรเจกต์เรื่อง)
fs.mkdirSync(STORY_VIDEO_DIR, { recursive: true });
const STORY_VIDEO_NAME = /^shot-\d+-\d+\.(mp4|webm|png|jpg|webp)$/; // ช็อตแนบได้ทั้งคลิปและภาพนิ่ง
const STORY_MEDIA_TYPE = { mp4: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const rmStoryVideo = (name) => { if (name && STORY_VIDEO_NAME.test(name)) fs.rmSync(path.join(STORY_VIDEO_DIR, name), { force: true }); };
const MUSIC_DIR = path.join(db.DATA_DIR, 'music');
fs.mkdirSync(MUSIC_DIR, { recursive: true });
const MUSIC_EXT = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac' };
const MUSIC_PRESETS = ['none', 'calm', 'mystic', 'upbeat'];
const listMusic = () => fs.readdirSync(MUSIC_DIR).filter((f) => MUSIC_EXT[path.extname(f).toLowerCase()]).sort();

const rendering = new Set(); // id ที่กำลังเรนเดอร์ (กันกดซ้ำ)

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'body ใหญ่เกินไป')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON ไม่ถูกต้อง')); }
    });
    req.on('error', reject);
  });
}

// ตรวจและทำความสะอาดฟิลด์จากผู้ใช้
function clean(body, { requireTitle = false } = {}) {
  const out = {};
  const str = (k, max) => {
    if (body[k] === undefined) return;
    if (typeof body[k] !== 'string') throw new HttpError(400, `${k} ต้องเป็นข้อความ`);
    if (body[k].length > max) throw new HttpError(400, `${k} ยาวเกิน ${max} ตัวอักษร`);
    out[k] = body[k].replace(/\r\n/g, '\n').trim();
  };
  str('title', 200); str('brief', 20000); str('script', 5000); str('source', 300);
  str('caption', 5000); str('hashtags', 1000); str('badge', 40);
  if (body.theme !== undefined) {
    if (!THEMES.includes(body.theme)) throw new HttpError(400, 'theme ไม่รู้จัก');
    out.theme = body.theme;
  }
  for (const k of ['video_prompts', 'image_prompts']) {
    if (body[k] === undefined) continue;
    const arr = body[k];
    if (!Array.isArray(arr) || arr.length > 16 || arr.some((p) => !p || typeof p.prompt !== 'string' || p.prompt.length > 1500 || (p.note != null && typeof p.note !== 'string') || (p.text != null && (typeof p.text !== 'string' || p.text.length > 200)))) {
      throw new HttpError(400, `${k} ต้องเป็นอาร์เรย์ {prompt, note} ไม่เกิน 16 อัน`);
    }
    out[k] = arr.length ? JSON.stringify(arr.map((p) => ({ prompt: p.prompt.trim(), note: (p.note || '').trim().slice(0, 300), ...(typeof p.text === 'string' ? { text: p.text.trim() } : {}) }))) : '';
  }
  if (body.images !== undefined) {
    const a = body.images;
    if (!Array.isArray(a) || a.length > 8 || a.some((p) => !p || typeof p.file !== 'string' || !IMG_NAME.test(p.file))) throw new HttpError(400, 'images ต้องเป็นอาร์เรย์ {file, credit, src} ไม่เกิน 8 รูป');
    const ok = a.filter((p) => fs.existsSync(path.join(IMG_DIR, p.file)));
    out.images = ok.length ? JSON.stringify(ok.map((p) => ({ file: p.file, credit: String(p.credit || '').slice(0, 120), src: String(p.src || '').slice(0, 500) }))) : '';
  }
  if (body.target_sec !== undefined) {
    const n = Number(body.target_sec) || 0;
    if (!Number.isInteger(n) || (n !== 0 && (n < 5 || n > 90))) throw new HttpError(400, 'ความยาวต้องเป็น 0 (อัตโนมัติ) หรือ 5–90 วินาที');
    out.target_sec = n;
  }
  if (body.voice !== undefined) out.voice = body.voice ? 1 : 0;
  if (body.music !== undefined) {
    const ok = MUSIC_PRESETS.includes(body.music) ||
      (typeof body.music === 'string' && body.music.startsWith('file:') && listMusic().includes(body.music.slice(5)));
    if (!ok) throw new HttpError(400, 'music ไม่รู้จัก');
    out.music = body.music;
  }
  if (body.kind !== undefined) {
    if (!['quick', 'story'].includes(body.kind)) throw new HttpError(400, 'kind ต้องเป็น quick | story');
    out.kind = body.kind;
  }
  if (requireTitle && !out.title) throw new HttpError(400, 'ต้องมี title');
  if (out.title === '') throw new HttpError(400, 'title ห้ามว่าง');
  return out;
}

// ตัวเลือกดึงสินค้าจากมือถือ: serial / q (ค้นชื่อ-คีย์เวิร์ด) / days (โพสต์ภายในกี่วัน 0=ทั้งหมด) / limit (สูงสุด 5000)
function pondyOpts(b) {
  if (typeof b.serial !== 'string' || !/^[A-Za-z0-9._:-]{4,64}$/.test(b.serial)) throw new HttpError(400, 'เลือกมือถือก่อน');
  return {
    serial: b.serial,
    q: typeof b.q === 'string' ? b.q.trim().slice(0, 100) : '',
    days: Math.min(3650, Math.max(0, Number(b.days) || 0)), // ทศนิยมได้ เช่น 0.25 = 6 ชั่วโมง
    limit: Math.min(5000, Math.max(1, Math.floor(Number(b.limit)) || 300)),
    urls: Array.isArray(b.urls) ? b.urls.filter((u) => typeof u === 'string').slice(0, 5000) : null, // เลือกเฉพาะลิงก์เหล่านี้ (ไม่ส่ง = ทั้งหมดที่ตรงเงื่อนไข)
  };
}

// สินค้า: ชื่อ/ลิงก์ (http/https)/แท็ก/โน้ต — create=true บังคับต้องมีชื่อและลิงก์
function cleanProduct(b, create) {
  const out = {};
  const str = (k, max) => {
    if (b[k] === undefined) return;
    if (typeof b[k] !== 'string' || b[k].length > max) throw new HttpError(400, `${k} ต้องเป็นข้อความไม่เกิน ${max} ตัวอักษร`);
    out[k] = b[k].trim();
  };
  str('name', 150); str('url', 500); str('tags', 200); str('note', 300);
  if (b.sales !== undefined) {
    const n = Number(b.sales === '' ? 0 : b.sales);
    if (!Number.isInteger(n) || n < 0 || n > 1e9) throw new HttpError(400, 'ยอดขายต้องเป็นจำนวนเต็ม 0 ขึ้นไป');
    out.sales = n;
  }
  if (out.url !== undefined) {
    let u;
    try { u = new URL(out.url); } catch { throw new HttpError(400, 'ลิงก์ไม่ถูกต้อง'); }
    if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'ลิงก์ต้องขึ้นต้น http/https');
  }
  if (create && (!out.name || !out.url)) throw new HttpError(400, 'ต้องมีชื่อสินค้าและลิงก์');
  if (out.name === '') throw new HttpError(400, 'ชื่อสินค้าห้ามว่าง');
  return out;
}

// เลือกสินค้าให้คลิป — ดู mode ที่ route /api/clips/:id/products
const STOP = new Set(['และ', 'ที่', 'ของ', 'ใน', 'ได้', 'ให้', 'ไป', 'มา', 'เป็น', 'กับ', 'จะ', 'ก็', 'แต่', 'ว่า', 'นี้', 'นั้น', 'ไม่', 'มี', 'หรือ', 'ๆ', 'ครับ', 'ค่ะ', 'แล้ว', 'อยู่', 'จาก', 'ถึง', 'เพื่อ', 'คือ', 'การ', 'ความ', 'ผู้', 'the', 'and', 'for', 'with']);
const thSeg = new Intl.Segmenter('th', { granularity: 'word' });

// คลังใหญ่ (หลายพันรายการ) ส่งให้ AI ทั้งหมดไม่ได้ → คัดผู้เข้าชิงจากคำในคลิปที่ไปตรงกับชื่อ/แท็กสินค้า (เรียงตามจำนวนคำที่ตรง แล้วโพสต์ล่าสุด)
function topMatches(clip, products, n = 40) {
  const text = [clip.title, clip.brief, clip.script, clip.caption, clip.hashtags].join(' ').toLowerCase();
  const toks = new Set();
  for (const { segment, isWordLike } of thSeg.segment(text)) {
    if (isWordLike && segment.length >= 2 && !STOP.has(segment) && !/^\d+$/.test(segment)) toks.add(segment);
  }
  const scored = [];
  for (const p of products) {
    const hay = `${p.name} ${p.tags} ${p.note}`.toLowerCase();
    let s = 0;
    for (const t of toks) if (hay.includes(t)) s++;
    if (s > 0) scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s || b.p.last_posted - a.p.last_posted);
  return scored.slice(0, n).map((x) => x.p);
}

// ค้นสินค้าจากมือถือโดยตรง (ไม่ต้องนำเข้าคลังก่อน): รวมสินค้าที่ลงคลิปแล้วของทุกเครื่องที่ต่ออยู่ → คัดที่ตรงกับคำในคลิป → ให้ AI เลือก
// ลิงก์ทุกอันมาจากบัญชีแอฟฟิลิเอตของผู้ใช้เอง (ที่แอป Pondy โพสต์ไว้) มือถือไม่เก็บยอดขาย จึงรองรับเฉพาะโหมด "เข้ากับคลิป"
// opts: serials (เครื่องที่ผู้ใช้เลือก) / days (โพสต์ภายในกี่วัน 0=ทั้งหมด) / q (ต้องมีคำนี้ในชื่อหรือคีย์เวิร์ด)
async function recommendFromPhones(clip, mode, opts = {}) {
  if (mode !== 'fit') throw new HttpError(400, 'สินค้าจากมือถือไม่มียอดขาย — ใช้ได้เฉพาะโหมด “เข้ากับคลิป” (หรือสลับไปใช้คลังสินค้าที่ใส่ยอดขายเอง)');
  const serials = opts.serials || [];
  if (!serials.length) throw new HttpError(400, 'เลือกมือถืออย่างน้อย 1 เครื่องก่อน');
  const seen = new Map();
  for (const serial of serials) {
    const { rows } = await pondy.readProducts(serial, { limit: 100000, days: opts.days || 0, q: opts.q || '', shortOnly: !!opts.shortOnly }).catch((e) => { throw new HttpError(502, e.message); });
    for (const r of rows) if (!seen.has(r.url)) seen.set(r.url, r);
  }
  const all = [...seen.values()].map((r, i) => ({ id: i + 1, name: r.name, url: r.url, tags: r.keyword || '', note: '', sales: 0, last_posted: r.last_posted }));
  // เงื่อนไขที่ติ๊กไว้ (ช่วงเวลา/คำ/ลิงก์สั้น) ทำให้ไม่เหลือสินค้าเลย — บอกให้ชัดว่าติดที่เงื่อนไข ไม่ใช่ "ไม่ตรงกับคลิป"
  if (!all.length) {
    let msg = 'ไม่มีสินค้าที่ตรงเงื่อนไขที่เลือก (เครื่อง/ช่วงเวลา/คำที่ต้องมี/ลิงก์สั้น)';
    if (opts.shortOnly) {
      const parts = [];
      for (const serial of serials) {
        const r = await pondy.readProducts(serial, { limit: 1, shortOnly: true }).catch(() => null);
        parts.push(r && r.total ? `เครื่อง ${serial}: มีลิงก์สั้น ${r.total.toLocaleString('en-US')} อัน โพสต์ล่าสุด ${new Date(r.rows[0].last_posted).toLocaleDateString('th-TH')}` : `เครื่อง ${serial}: ไม่มีลิงก์สั้นเลย`);
      }
      msg += ` — ${parts.join(' · ')} — ลองเลือกช่วงเวลา “ทั้งหมด” หรือเอาติ๊ก “เฉพาะลิงก์สั้น” ออก`;
    } else if (opts.days) msg += ' — ลองเลือกช่วงเวลา “ทั้งหมด”';
    return { mode, source: 'phones', scanned: 0, message: msg, picks: [] };
  }
  const pool = topMatches(clip, all);
  if (!pool.length) return { mode, source: 'phones', scanned: all.length, message: `ค้นแล้ว ${all.length.toLocaleString('en-US')} สินค้าในมือถือ ไม่พบอันที่ชื่อ/คีย์เวิร์ดตรงกับเนื้อหาของคลิปนี้`, picks: [] };
  const r = await ai.pickProducts(clip, pool);
  const byId = new Map(pool.map((p) => [p.id, p]));
  // link_kind: short = ลิงก์สั้น Shopee (น่าจะเป็นแอฟฟิลิเอต) | plain = ลิงก์สินค้าธรรมดา (ไม่มีตัวติดตาม → วางบน Facebook อาจไม่ได้ค่าคอม)
  return { mode, source: 'phones', scanned: all.length, message: r.message, picks: r.picks.map((p) => { const product = byId.get(p.id); return { ...p, product: { ...product, link_kind: pondy.linkKind(product.url) } }; }) };
}

async function recommend(clip, mode) {
  const all = db.allProducts().sort((a, b) => b.sales - a.sales || b.last_posted - a.last_posted);
  if (!all.length) throw new HttpError(400, 'ยังไม่มีสินค้าในคลัง — กดปุ่ม 🛍 สินค้า เพื่อเพิ่มลิงก์ก่อน');
  const byId = new Map(all.map((p) => [p.id, p]));
  const withProduct = (picks) => picks.map((p) => ({ ...p, product: byId.get(p.id) }));
  if (mode === 'fit') { // AI เลือกให้เข้ากับคลิป (คลังเล็กส่งทั้งหมด คลังใหญ่คัดผู้เข้าชิงก่อน)
    const pool = all.length <= 60 ? all : topMatches(clip, all);
    if (!pool.length) return { mode, message: 'ไม่พบสินค้าที่ชื่อ/แท็กตรงกับเนื้อหาของคลิปนี้เลย', picks: [] };
    const r = await ai.pickProducts(clip, pool);
    return { mode, message: r.message, picks: withProduct(r.picks) };
  }
  const sellers = all.filter((p) => p.sales > 0);
  if (!sellers.length) throw new HttpError(400, 'ยังไม่ได้ใส่ยอดขายให้สินค้าเลย — ใส่ตัวเลขยอดขาย/ความนิยมในคลังสินค้าก่อน (ดูจากแดชบอร์ด Shopee Affiliate ของคุณ)');
  if (mode === 'top') {
    return {
      mode, message: '',
      picks: withProduct(sellers.slice(0, 3).map((p, i) => ({
        id: p.id, reason: `ขายดีอันดับ ${i + 1} ในคลังของคุณ (ยอดขาย ${p.sales.toLocaleString('en-US')}) — เลือกตามยอดขาย ไม่ได้ดูความเกี่ยวข้องกับคลิป`,
        link_name: p.name.slice(0, 40), cta: 'สนใจดูสินค้าตามลิงก์ในโพสต์ได้เลย',
      }))),
    };
  }
  const r = await ai.pickProducts(clip, sellers.slice(0, 10)); // mix: ขายดี 10 อันดับ แล้วให้ AI เลือกอันที่เข้ากับคลิปที่สุด
  return { mode, message: r.message, picks: withProduct(r.picks) };
}

function mustGet(id) {
  const clip = db.get(id);
  if (!clip) throw new HttpError(404, 'ไม่พบคลิป');
  return clip;
}

function videoPath(clip) {
  return clip.video_file ? path.join(db.OUT_DIR, path.basename(clip.video_file)) : null;
}

// ลบรูปประกอบของคลิป — เฉพาะไฟล์ที่คลิปอื่นไม่ได้ใช้ร่วมอยู่
function rmImages(clip) {
  let files = [];
  try { files = JSON.parse(clip.images || '[]').map((p) => p.file); } catch { /* ข้อมูลเสีย */ }
  if (!files.length) return;
  const others = new Set();
  for (const c of db.list({ limit: 100000 }).items) {
    if (c.id === clip.id) continue;
    try { for (const p of JSON.parse(c.images || '[]')) others.add(p.file); } catch { /* ข้าม */ }
  }
  for (const f of files) if (IMG_NAME.test(f) && !others.has(f)) fs.rmSync(path.join(IMG_DIR, f), { force: true });
}

// อัปโหลดรูปที่ผู้ใช้สร้างเอง (จาก Google Flow/ChatGPT/Meta AI) เป็นพื้นหลังคลิป — ตรวจลายเซ็นรูปจริง เก็บชื่อ = sha1
async function saveClipImage(req) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
  if (!ext) throw new HttpError(415, 'รองรับเฉพาะรูป png/jpg/webp');
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    req.on('data', (c) => { size += c.length; if (size > 25_000_000) { reject(new HttpError(413, 'รูปใหญ่เกิน 25MB')); req.destroy(); } else chunks.push(c); });
    req.on('error', reject); req.on('end', resolve);
  });
  const buf = Buffer.concat(chunks);
  if (buf.length < 1000) throw new HttpError(400, 'ไฟล์ว่างหรือเล็กเกินไป');
  const h = buf.subarray(0, 12);
  const ok = { png: h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), jpg: h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff, webp: h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP' }[ext];
  if (!ok) throw new HttpError(400, 'ไฟล์ไม่ใช่รูปจริง');
  const file = `${crypto.createHash('sha1').update(buf).digest('hex')}.${ext}`;
  fs.writeFileSync(path.join(IMG_DIR, file), buf);
  return { file, credit: '', src: '' };
}

// แนบคลิปให้ช็อต: เขียนลงไฟล์ตามสตรีม (จำกัด 300MB) ตรวจลายเซ็น mp4/webm จริง แทนที่ไฟล์เดิมของช็อต
async function saveShotVideo(req, id) {
  const shot = story.getShot(id);
  if (!shot) throw new HttpError(404, 'ไม่พบช็อต');
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  const ext = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[type];
  if (!ext) throw new HttpError(415, 'รองรับเฉพาะ mp4/webm หรือรูป png/jpg/webp');
  const isImage = ['.png', '.jpg', '.webp'].includes(ext);
  const name = `shot-${id}-${Date.now()}${ext}`;
  const file = path.join(STORY_VIDEO_DIR, name);
  const MAX = isImage ? 25_000_000 : 300_000_000;
  let size = 0;
  try {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(file);
      req.on('data', (c) => { size += c.length; if (size > MAX) { reject(new HttpError(413, 'ไฟล์ใหญ่เกินไป')); ws.destroy(); req.destroy(); } });
      req.on('error', reject); ws.on('error', reject); ws.on('finish', resolve);
      req.pipe(ws);
    });
    if (size < 1000) throw new HttpError(400, 'ไฟล์ว่างหรือเล็กเกินไป');
    const head = Buffer.alloc(12);
    const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
    const sig = {
      '.mp4': head.subarray(4, 8).toString('latin1') === 'ftyp',
      '.webm': head.readUInt32BE(0) === 0x1a45dfa3,
      '.png': head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      '.jpg': head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
      '.webp': head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP',
    }[ext];
    if (!sig) throw new HttpError(400, isImage ? 'ไฟล์ไม่ใช่รูปจริง' : 'ไฟล์ไม่ใช่วิดีโอ mp4/webm จริง');
    if (!story.getShot(id)) throw new HttpError(404, 'ไม่พบช็อต');
  } catch (e) { fs.rmSync(file, { force: true }); throw e; }
  rmStoryVideo(shot.video_file);
  story.setShotVideo(id, name);
  return story.getProject(shot.project_id);
}

// ---------- ส่วนเสริม Chrome (extension/) ----------
// เรียกผ่านรหัสจับคู่ (header x-arn-token) เท่านั้น: Host ต้องเป็นเครื่องเรา และ Origin ต้องไม่มีหรือเป็น chrome-extension:// — เว็บอื่นยิงเข้ามาไม่ได้
function extAuth(req) {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) throw new HttpError(403, 'host ไม่อนุญาต');
  const o = req.headers.origin;
  if (o && !/^chrome-extension:\/\//.test(o)) throw new HttpError(403, 'origin ไม่อนุญาต');
  const a = Buffer.from(String(req.headers['x-arn-token'] || '')), b = Buffer.from(cfg.extToken || '');
  if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'รหัสจับคู่ไม่ถูกต้อง (ตั้งค่า → ส่วนเสริม Chrome)');
}

// ช็อตถัดไปที่ต้องสร้าง: ช็อตแรกที่ยังไม่มีคลิป หรือถูกรีวิวว่า ❌ ไม่ผ่าน
function extNext(pid) {
  const p = story.getProjectRow(pid);
  if (!p) throw new HttpError(404, 'ไม่พบโปรเจกต์');
  const shots = story.listShots(pid);
  const s = shots.find((x) => !x.video_file || x.status === 'rejected');
  return {
    project: { id: p.id, title: p.title, aspect: p.aspect, media: p.media, generator: p.generator }, total: shots.length, done: shots.filter((x) => x.video_file && x.status !== 'rejected').length,
    shot: s ? { id: s.id, position: s.position, beat: s.beat, prompt: s.prompt, narration: s.narration, duration: s.duration, status: s.status } : null,
  };
}

async function handleExt(req, res, url) {
  extAuth(req);
  const p = url.pathname;
  if (p === '/ext/ping' && req.method === 'GET') return send(res, 200, { ok: true, app: 'arn-reels' });
  if (p === '/ext/projects' && req.method === 'GET') return send(res, 200, story.listProjects().map((x) => ({ id: x.id, title: x.title, shots: x.shots, done: x.done })));
  let m = /^\/ext\/projects\/(\d+)\/next$/.exec(p);
  if (m && req.method === 'GET') return send(res, 200, extNext(+m[1]));
  m = /^\/ext\/shots\/(\d+)\/video$/.exec(p);
  if (m && req.method === 'PUT') {
    const proj = await saveShotVideo(req, +m[1]);
    return send(res, 200, { ok: true, ...extNext(proj.project.id) });
  }
  throw new HttpError(404, 'ไม่มี endpoint นี้');
}

// ส่งไฟล์พร้อม Range (ให้ <video> เลื่อนดูได้)
function serveRange(req, res, file, type) {
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  const { size } = fs.statSync(file);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = size - 1, code = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = +range[1]; if (range[2]) end = Math.min(+range[2], size - 1); } else start = Math.max(0, size - +range[2]);
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    code = 206;
  }
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'no-store' };
  if (code === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(code, headers);
  fs.createReadStream(file, { start, end }).pipe(res);
}

function rmVideo(clip) {
  const p = videoPath(clip);
  if (p) fs.rmSync(p, { force: true });
}

const thumbPath = (id) => path.join(db.THUMB_DIR, `${id}.jpg`);

// ภาพหน้าปก (JPEG เล็ก) ที่เบราว์เซอร์จับตอนเรนเดอร์ — ให้คลังโชว์รูปแทนการโหลดวิดีโอทุกอัน
async function saveThumb(req, id) {
  mustGet(id);
  if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'image/jpeg') throw new HttpError(415, 'หน้าปกต้องเป็น image/jpeg');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 500_000) throw new HttpError(413, 'หน้าปกใหญ่เกินไป');
    chunks.push(c);
  }
  const buf = Buffer.concat(chunks);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(400, 'ไม่ใช่ไฟล์ JPEG');
  fs.writeFileSync(thumbPath(id), buf);
  return { ok: true };
}

// เรนเดอร์เบื้องหลัง — ตอบกลับทันทีด้วย status=rendering แล้วให้หน้าเว็บ poll
function startRender(id) {
  if (rendering.has(id)) throw new HttpError(409, 'กำลังเรนเดอร์อยู่');
  const clip = mustGet(id);
  rendering.add(id);
  const out = `clip-${id}-${Date.now()}.mp4`;
  const updated = db.update(id, { status: 'rendering', error: null });
  renderClip(clip, path.join(db.OUT_DIR, out))
    .then(({ duration }) => {
      const cur = db.get(id);
      if (!cur) { fs.rmSync(path.join(db.OUT_DIR, out), { force: true }); return; } // ถูกลบระหว่างเรนเดอร์
      rmVideo(cur);
      db.update(id, { status: 'ready', video_file: out, duration, error: null, posted_at: null, fb_url: null });
    })
    .catch((e) => {
      fs.rmSync(path.join(db.OUT_DIR, out), { force: true });
      if (db.get(id)) db.update(id, { status: 'failed', error: String(e.message).slice(0, 800) });
    })
    .finally(() => rendering.delete(id));
  return updated;
}

// ---------- ตั้งค่า (คีย์ไม่เคยถูกส่งกลับ เห็นแค่ ••••ท้าย 4 ตัว) ----------
const maskKey = (k) => (k ? { set: true, hint: `••••${k.slice(-4)}` } : { set: false, hint: '' });
const settingsView = async (forceCli = false) => ({
  aiProvider: cfg.aiProvider, claudeCli: await cli.info(forceCli),
  anthropicKey: maskKey(cfg.anthropicKey), model: cfg.model,
  ttsProvider: cfg.ttsProvider, googleKey: maskKey(cfg.googleKey), googleVoice: cfg.googleVoice, geminiKey: maskKey(cfg.geminiKey), geminiVoice: cfg.geminiVoice, geminiModel: cfg.geminiModel, ttsRate: cfg.ttsRate,
  brand: brandLib.get(), brandPresets: brandLib.PRESETS,
});

// คีย์: ไม่ส่งมา = ไม่แก้, null = ลบ, ข้อความ = ตั้งใหม่
function cleanSettings(b) {
  const patch = {};
  for (const k of ['anthropicKey', 'googleKey', 'geminiKey']) {
    if (b[k] === undefined) continue;
    if (b[k] === null) { patch[k] = ''; continue; }
    const v = typeof b[k] === 'string' ? b[k].trim() : '';
    if (!/^[\x21-\x7e]{8,300}$/.test(v)) throw new HttpError(400, `${k} ไม่ถูกต้อง (ต้องเป็นอักขระ ASCII 8–300 ตัว ไม่มีช่องว่าง)`);
    patch[k] = v;
  }
  if (b.aiProvider !== undefined) {
    if (!['cli', 'api'].includes(b.aiProvider)) throw new HttpError(400, 'aiProvider ไม่รู้จัก');
    patch.aiProvider = b.aiProvider;
  }
  if (b.model !== undefined) {
    if (typeof b.model !== 'string' || !/^[A-Za-z0-9._-]{3,80}$/.test(b.model.trim())) throw new HttpError(400, 'ชื่อโมเดลไม่ถูกต้อง');
    patch.model = b.model.trim();
  }
  if (b.ttsProvider !== undefined) {
    if (!['windows', 'google', 'gemini'].includes(b.ttsProvider)) throw new HttpError(400, 'ttsProvider ไม่รู้จัก');
    patch.ttsProvider = b.ttsProvider;
  }
  if (b.googleVoice !== undefined) {
    if (typeof b.googleVoice !== 'string' || !/^[A-Za-z0-9-]{3,60}$/.test(b.googleVoice.trim())) throw new HttpError(400, 'ชื่อเสียง Google ไม่ถูกต้อง');
    patch.googleVoice = b.googleVoice.trim();
  }
  if (b.brand !== undefined) {
    const x = b.brand;
    if (!x || typeof x !== 'object') throw new HttpError(400, 'สไตล์ประจำเพจไม่ถูกต้อง');
    const s = (v, max) => {
      if (v == null) return '';
      if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `สไตล์ประจำเพจยาวเกิน ${max} ตัวอักษร`);
      return v.replace(/\s+/g, ' ').trim();
    };
    const tags = s(x.tags, 200).split(/[\s,]+/).filter(Boolean).map((t) => `#${t.replace(/^#+/, '')}`).filter((t) => t.length > 1).slice(0, 10).join(' ');
    patch.brand = { preset: brandLib.PRESETS.some((p) => p.id === x.preset) ? x.preset : '', visual: s(x.visual, 500), voice: s(x.voice, 900), tags, logoOn: x.logoOn !== false };
  }
  if (b.geminiVoice !== undefined) {
    if (typeof b.geminiVoice !== 'string' || !/^[A-Za-z]{3,30}$/.test(b.geminiVoice.trim())) throw new HttpError(400, 'ชื่อเสียง Gemini ไม่ถูกต้อง');
    patch.geminiVoice = b.geminiVoice.trim();
  }
  if (b.geminiModel !== undefined) {
    if (typeof b.geminiModel !== 'string' || !/^[A-Za-z0-9._-]{3,80}$/.test(b.geminiModel.trim())) throw new HttpError(400, 'ชื่อโมเดล Gemini ไม่ถูกต้อง');
    patch.geminiModel = b.geminiModel.trim();
  }
  if (b.ttsRate !== undefined) {
    const r = Number(b.ttsRate);
    if (!(r >= 0.5 && r <= 2)) throw new HttpError(400, 'ความเร็วเสียงต้องอยู่ระหว่าง 0.5–2');
    patch.ttsRate = r;
  }
  return patch;
}

// ---------- โปรเจกต์เรื่อง ----------
function storyProjectBody(b, partial = false) {
  const out = {};
  const s = (k, max) => {
    if (b[k] === undefined) return;
    if (typeof b[k] !== 'string' || b[k].length > max) throw new HttpError(400, `${k} ต้องเป็นข้อความไม่เกิน ${max} ตัวอักษร`);
    out[k] = b[k].replace(/\r\n/g, '\n').trim();
  };
  s('title', 150); s('premise', 30000); s('style', 500);
  if (!partial && !out.title) throw new HttpError(400, 'ใส่ชื่อเรื่อง');
  if (out.title === '') throw new HttpError(400, 'ชื่อเรื่องห้ามว่าง');
  for (const [k, lo, hi] of [['total_sec', 10, 1800], ['shot_sec', 3, 15]]) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, `${k} ต้องเป็นจำนวนเต็ม ${lo}–${hi}`);
    out[k] = n;
  }
  if (b.narr_tone !== undefined) {
    if (!story.NARR_TONES[b.narr_tone]) throw new HttpError(400, 'narr_tone ไม่รู้จัก');
    out.narr_tone = b.narr_tone;
  }
  if (b.per_image !== undefined) {
    if (!story.PER_IMAGE.includes(Number(b.per_image))) throw new HttpError(400, 'per_image ต้องเป็น 1, 4, 6 หรือ 12');
    out.per_image = Number(b.per_image);
  }
  if (b.aspect !== undefined) {
    if (!story.ASPECTS.includes(b.aspect)) throw new HttpError(400, 'aspect ไม่รู้จัก');
    out.aspect = b.aspect;
  }
  if (b.sources !== undefined) { // [{title,url,note}] — เฉพาะลิงก์ http(s)
    if (!Array.isArray(b.sources) || b.sources.length > 40) throw new HttpError(400, 'sources ต้องเป็นรายการไม่เกิน 40 แหล่ง');
    out.sources = JSON.stringify(b.sources.map((x) => {
      const url = String(x?.url || '').trim();
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new HttpError(400, `ลิงก์ไม่ถูกต้อง: ${url.slice(0, 60)}`);
      return { title: String(x?.title || '').trim().slice(0, 150), url: url.slice(0, 500), note: String(x?.note || '').trim().slice(0, 300) };
    }));
  }
  if (b.look !== undefined) { // โทนภาพ {ref,light,film,sound} (อังกฤษ) ใส่ซ้ำทุก prompt
    if (!b.look || typeof b.look !== 'object' || Array.isArray(b.look)) throw new HttpError(400, 'look ต้องเป็น object');
    const look = {};
    for (const k of ['ref', 'light', 'film', 'sound']) {
      const v = b.look[k] === undefined ? '' : b.look[k];
      if (typeof v !== 'string' || v.length > 400) throw new HttpError(400, `look.${k} ต้องเป็นข้อความไม่เกิน 400 ตัวอักษร`);
      look[k] = v.replace(/\s+/g, ' ').trim();
    }
    out.look = JSON.stringify(look);
  }
  if (b.generator !== undefined) {
    if (!story.GENERATORS.includes(b.generator)) throw new HttpError(400, 'generator ไม่ถูกต้อง');
    out.generator = b.generator;
  }
  if (b.media !== undefined) {
    if (!story.MEDIA.includes(b.media)) throw new HttpError(400, 'media ต้องเป็น video | image');
    out.media = b.media;
  }
  return out;
}
// สร้างโปรเจกต์เรื่องจากสคริปต์ที่แยกแล้ว (ใช้ร่วมกันโดย "นำเข้า prompt" และ "แฟนบอลสายฮา")
function createFromScript(b, r, text) {
  const media = b.media === 'image' ? 'image' : 'video';
  if (b.generator !== undefined && !story.GENERATORS.includes(b.generator)) throw new HttpError(400, `generator ต้องเป็น ${story.GENERATORS.join(' | ')}`);
  const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 150) : r.title;
  const per = story.PER_IMAGE.includes(Number(b.per_image)) ? Number(b.per_image) : 1;
  const sources = (Array.isArray(b.sources) ? b.sources : []).filter((u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u)).slice(0, 40)
    .map((url) => ({ title: '', url: url.slice(0, 500), note: '' }));
  // ทั้งก้อนเป็นธุรกรรมเดียว: ถ้าขั้นไหนล้ม ไม่ทิ้งโปรเจกต์ที่สร้างค้างครึ่งทาง
  db.handle.exec('BEGIN');
  try {
    const p = story.createProject({ title, premise: text.replace(/\r\n/g, '\n').trim().slice(0, 30000), total_sec: r.total_sec, shot_sec: r.shot_sec, aspect: story.ASPECTS.includes(r.aspect) ? r.aspect : '9:16', media, generator: b.generator, per_image: per });
    story.updateProject(p.id, { look: JSON.stringify(r.look), ...(sources.length ? { sources: JSON.stringify(sources) } : {}) });
    const ids = new Map(r.characters.map((c) => [c.name, story.addEntity(p.id, { kind: 'character', name: c.name.slice(0, 80), desc: c.desc }).id]));
    for (const s of r.shots) story.addShot(p.id, { scene: s.scene, beat: s.action.slice(0, 300), action: s.action.slice(0, 600), narration: s.narration, duration: s.duration, character_ids: s.characters.map((n) => ids.get(n)).filter(Boolean) });
    story.rebuildPrompts(p.id);
    db.handle.exec('COMMIT');
    return { ...story.getProject(p.id), warnings: r.warnings };
  } catch (e) { db.handle.exec('ROLLBACK'); throw e; }
}
function mustProject(id) { const p = story.getProjectRow(id); if (!p) throw new HttpError(404, 'ไม่พบโปรเจกต์'); return p; }

const routes = [
  ['GET', /^\/api\/story\/projects$/, async () => story.listProjects()],
  ['POST', /^\/api\/story\/projects$/, async (req) => {
    const f = storyProjectBody(await readBody(req));
    const p = story.createProject(f);
    // createProject รับแค่บางฟิลด์ — ฟิลด์ที่ตรวจแล้วแต่ไม่ได้ใช้ (โทนภาพ/สไตล์คำบรรยาย) ต้องบันทึกต่อ ไม่งั้นหายเงียบ ๆ
    const rest = {};
    for (const k of ['look', 'narr_tone']) if (f[k] !== undefined) rest[k] = f[k];
    return Object.keys(rest).length ? story.updateProject(p.id, rest) : p;
  }],
  // นำเข้า prompt หนังสั้นสำเร็จรูป (SCENE n — … (a–bs)) → โปรเจกต์ + ตัวละคร + ช็อตตามต้นฉบับ ไม่ใช้ AI; dry=true คืนผลแยกให้ดูก่อนโดยไม่บันทึก
  ['POST', /^\/api\/story\/import$/, async (req) => {
    const b = await readBody(req);
    if (typeof b.text !== 'string' || !b.text.trim()) throw new HttpError(400, 'วาง prompt ก่อน');
    if (b.text.length > 30000) throw new HttpError(400, 'prompt ยาวเกิน 30000 ตัวอักษร');
    let r;
    try { r = parsePromptScript(b.text); } catch (e) { throw new HttpError(400, e.message); }
    if (b.dry === true) return { title: r.title, total_sec: r.total_sec, characters: r.characters.length, shots: r.shots.map((s) => ({ scene: s.scene, duration: s.duration, narration: s.narration })), warnings: r.warnings };
    return createFromScript(b, r, b.text);
  }],
  // สร้างจากหัวข้อ: หัวข้อ + แนวเรื่อง + แนวภาพ (+ค้นข้อมูลจริง) → AI เขียนสตอรีบอร์ดหลายช่อง → โปรเจกต์ภาพนิ่งแบบตาราง (1 รูป = N ช่อง) พร้อมไปสร้างรูป
  ['POST', /^\/api\/story\/from-topic$/, async (req) => {
    const b = await readBody(req);
    const topic = typeof b.topic === 'string' ? b.topic.trim() : '';
    if (!topic || topic.length > 300) throw new HttpError(400, 'ใส่หัวข้อ (ไม่เกิน 300 ตัวอักษร)');
    const panels = [4, 6, 12].includes(Number(b.panels)) ? Number(b.panels) : 6;
    const genre = ['parody', 'newsfun', 'spoil', 'explain'].includes(b.genre) ? b.genre : 'parody';
    const visual = ['cartoon', 'realistic', 'anime', 'stickman'].includes(b.visual) ? b.visual : 'cartoon';
    const { text, sources } = await ai.writeTopicBoard({ topic, genre, visual, panels, research: b.research === true });
    let r;
    try { r = parsePromptScript(text); } catch (e) { throw new HttpError(502, `AI เขียนสคริปต์ผิดรูปแบบ ลองใหม่อีกครั้ง (${e.message})`); }
    return createFromScript({ media: 'image', generator: b.generator, per_image: panels, sources }, r, text);
  }],
  // คอนเทนต์แฟนบอลสายฮา: ผลบอล/มุก → AI เขียนสคริปต์ล้อเลียนรูปแบบเดียวกับนำเข้า → สร้างโปรเจกต์ทันที (สคริปต์เก็บในช่องเรื่องย่อ แก้ต่อได้)
  ['POST', /^\/api\/story\/fan-comedy$/, async (req) => {
    const b = await readBody(req);
    const match = typeof b.match === 'string' ? b.match.trim() : '';
    if (!match || match.length > 500) throw new HttpError(400, 'ใส่ผลบอล/เหตุการณ์ (ไม่เกิน 500 ตัวอักษร)');
    const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 1000) : '';
    const total = Math.min(90, Math.max(30, Number(b.total) || 60));
    const text = await ai.writeFanComedy({ match, notes, total });
    let r;
    try { r = parsePromptScript(text); } catch (e) { throw new HttpError(502, `AI เขียนสคริปต์ผิดรูปแบบ ลองใหม่อีกครั้ง (${e.message})`); }
    return createFromScript(b, r, text);
  }],
  ['GET', /^\/api\/story\/projects\/(\d+)$/, async (req, m) => { mustProject(+m[1]); return story.getProject(+m[1]); }],
  ['PATCH', /^\/api\/story\/projects\/(\d+)$/, async (req, m) => {
    const cur = mustProject(+m[1]);
    const f = storyProjectBody(await readBody(req), true);
    // เว็บสร้างรูป/คลิปและจำนวนช็อตต่อรูปต้องเข้ากับแบบงานเสมอ (createProject ทำอยู่แล้ว — PATCH ต้องทำเหมือนกัน)
    const media = f.media ?? cur.media;
    if (f.media !== undefined || f.generator !== undefined) f.generator = story.fitGen(media, f.generator ?? cur.generator);
    if (media === 'video') f.per_image = 1;
    story.updateProject(+m[1], f);
    if (f.media || f.look) story.rebuildPrompts(+m[1]); // เปลี่ยนวิดีโอ↔ภาพนิ่ง หรือโทนภาพ: ประกอบ prompt ทุกช็อตใหม่
    return story.getProject(+m[1]);
  }],
  ['DELETE', /^\/api\/story\/projects\/(\d+)$/, async (req, m) => { mustProject(+m[1]); story.videoFiles(+m[1]).forEach(rmStoryVideo); story.deleteProject(+m[1]); return { ok: true }; }],
  // prompt รวมฉาก: ต่อช็อตติดกันเป็นย่อหน้าเดียวตามความยาวที่โมเดลวิดีโอสร้างได้ (?sec=5–30)
  ['GET', /^\/api\/story\/projects\/(\d+)\/merged$/, async (req, m, url) => {
    mustProject(+m[1]);
    const sec = Number(url.searchParams.get('sec') || 15);
    if (!Number.isInteger(sec) || sec < 5 || sec > 30) throw new HttpError(400, 'sec ต้องเป็นจำนวนเต็ม 5–30');
    return story.buildMerged(+m[1], sec);
  }],
  ['GET', /^\/api\/story\/projects\/(\d+)\/sheet$/, async (req, m, url) => {
    mustProject(+m[1]);
    const per = Number(url.searchParams.get('per') || 4);
    if (![4, 6, 12].includes(per)) throw new HttpError(400, 'per ต้องเป็น 4, 6 หรือ 12');
    return story.buildSheet(+m[1], per);
  }],
  // คลังตัวละคร/สถานที่/ของประกอบ
  ['POST', /^\/api\/story\/projects\/(\d+)\/entities$/, async (req, m) => {
    mustProject(+m[1]);
    const b = await readBody(req);
    if (!story.KINDS.includes(b.kind)) throw new HttpError(400, 'kind ต้องเป็น character | location | prop');
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
    if (!name) throw new HttpError(400, 'ใส่ชื่อ');
    return story.addEntity(+m[1], { kind: b.kind, name, alias: String(b.alias || '').trim().slice(0, 60), desc: String(b.desc || '').slice(0, 500), notes: String(b.notes || '').slice(0, 300) });
  }],
  ['PATCH', /^\/api\/story\/entities\/(\d+)$/, async (req, m) => {
    if (!story.getEntity(+m[1])) throw new HttpError(404, 'ไม่พบรายการ');
    const b = await readBody(req), f = {};
    for (const [k, max] of [['name', 80], ['alias', 60], ['desc', 500], ['notes', 300]]) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== 'string' || b[k].length > max) throw new HttpError(400, `${k} ยาวเกิน ${max}`);
      f[k] = b[k].trim();
    }
    if (f.name === '') throw new HttpError(400, 'ชื่อห้ามว่าง');
    return story.updateEntity(+m[1], f);
  }],
  ['DELETE', /^\/api\/story\/entities\/(\d+)$/, async (req, m) => { story.deleteEntity(+m[1]); return { ok: true }; }],
  // AI ร่างคลังจากเรื่องย่อ (เพิ่มเฉพาะชื่อที่ยังไม่มี ไม่ทับของเดิม)
  ['POST', /^\/api\/story\/projects\/(\d+)\/ai-bible$/, async (req, m) => {
    const p = mustProject(+m[1]);
    if (!p.premise.trim()) throw new HttpError(400, 'ใส่เรื่องย่อก่อน');
    const d = await ai.draftBible(p);
    const have = new Set(story.listEntities(p.id).map((e) => `${e.kind}:${e.name.toLowerCase()}`));
    let added = 0;
    for (const [kind, list] of [['character', d.characters], ['location', d.locations], ['prop', d.props]]) {
      for (const e of list) if (!have.has(`${kind}:${e.name.toLowerCase()}`)) { story.addEntity(p.id, { kind, ...e }); added++; }
    }
    return { ...story.getProject(p.id), added };
  }],
  // AI แบ่งช็อต (เขียนทับช็อตเดิมทั้งหมดเมื่อ replace=true) + สร้าง prompt ให้ทุกช็อต
  ['POST', /^\/api\/story\/projects\/(\d+)\/ai-shots$/, async (req, m) => {
    const p = mustProject(+m[1]);
    const b = await readBody(req);
    if (!p.premise.trim()) throw new HttpError(400, 'ใส่เรื่องย่อก่อน');
    const ents = story.listEntities(p.id);
    if (story.listShots(p.id).length && b.replace !== true) throw new HttpError(409, 'มีช็อตอยู่แล้ว — ยืนยันเพื่อเขียนทับ');
    const total = story.planCount(p);
    if (total > 80) throw new HttpError(400, `จะได้ ${total} ช็อต เกิน 80 — เพิ่มความยาวต่อช็อตหรือลดความยาวรวม`);
    const planned = await ai.planShots({ title: p.title, premise: p.premise, entities: ents, shotSec: p.shot_sec, total, tone: story.NARR_TONES[p.narr_tone]?.write });
    const id = (kind, name) => ents.find((e) => e.kind === kind && e.name.trim().toLowerCase() === String(name).trim().toLowerCase())?.id;
    story.videoFiles(p.id).forEach(rmStoryVideo); // แบ่งช็อตใหม่ = ช็อตเดิมหาย คลิปที่แนบไว้ก็ไม่มีที่อ้างถึงแล้ว
    story.clearShots(p.id);
    let prevState = '';
    for (const s of planned) {
      story.addShot(p.id, {
        scene: s.scene, beat: s.beat, location_id: id('location', s.location) ?? null,
        character_ids: s.characters.map((n) => id('character', n)).filter(Boolean), prop_ids: s.props.map((n) => id('prop', n)).filter(Boolean),
        action: s.action, camera: s.camera, narration: s.narration, duration: p.shot_sec, state_before: prevState, state_after: s.state_after, visible_text: s.visible_text,
      });
      prevState = s.state_after;
    }
    story.rebuildPrompts(p.id);
    return story.getProject(p.id);
  }],
  // เขียนคำบรรยายใหม่ทุกช็อตตามสไตล์ของโปรเจกต์ — แก้แค่ narration (ช็อต/prompt/รูปที่แนบไว้คงเดิม)
  ['POST', /^\/api\/story\/projects\/(\d+)\/ai-narration$/, async (req, m) => {
    const p = mustProject(+m[1]);
    const shots = story.listShots(p.id);
    if (!shots.length) throw new HttpError(400, 'ยังไม่มีช็อต — แบ่งช็อตก่อน');
    const lines = await ai.writeNarration({ title: p.title, premise: p.premise, shots, shotSec: p.shot_sec, tone: story.NARR_TONES[p.narr_tone]?.write });
    shots.forEach((s, i) => story.updateShot(s.id, { narration: lines[i] }));
    return story.getProject(p.id);
  }],
  // ช็อต
  ['POST', /^\/api\/story\/projects\/(\d+)\/shots$/, async (req, m) => { const p = mustProject(+m[1]); const s = story.addShot(p.id, {}); story.rebuildPrompts(p.id, s.id); return story.getProject(p.id); }],
  ['PATCH', /^\/api\/story\/shots\/(\d+)$/, async (req, m) => {
    const cur = story.getShot(+m[1]);
    if (!cur) throw new HttpError(404, 'ไม่พบช็อต');
    const b = await readBody(req), f = {};
    for (const [k, max] of [['scene', 80], ['beat', 300], ['action', 600], ['camera', 200], ['narration', 300], ['state_before', 300], ['state_after', 300], ['visible_text', 120], ['prompt', 3000], ['note', 500]]) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== 'string' || b[k].length > max) throw new HttpError(400, `${k} ยาวเกิน ${max}`);
      f[k] = b[k].trim();
    }
    if (b.duration !== undefined) {
      const n = Number(b.duration);
      if (!Number.isInteger(n) || n < 2 || n > 20) throw new HttpError(400, 'duration ต้องเป็นจำนวนเต็ม 2–20');
      f.duration = n;
    }
    if (b.status !== undefined) {
      if (!story.SHOT_STATUS.includes(b.status)) throw new HttpError(400, 'status ไม่รู้จัก');
      f.status = b.status;
    }
    const ents = new Map(story.listEntities(cur.project_id).map((e) => [e.id, e]));
    if (b.location_id !== undefined) {
      if (b.location_id !== null && ents.get(b.location_id)?.kind !== 'location') throw new HttpError(400, 'location_id ไม่ถูกต้อง');
      f.location_id = b.location_id;
    }
    for (const [k, kind] of [['character_ids', 'character'], ['prop_ids', 'prop']]) {
      if (b[k] === undefined) continue;
      if (!Array.isArray(b[k]) || b[k].some((x) => ents.get(x)?.kind !== kind)) throw new HttpError(400, `${k} ไม่ถูกต้อง`);
      f[k] = [...new Set(b[k])];
    }
    story.updateShot(cur.id, f);
    // แก้ฟิลด์ที่เป็นส่วนประกอบของ prompt (และไม่ได้ส่ง prompt มาเอง) → ประกอบ prompt ใหม่ให้
    if (f.prompt === undefined && ['location_id', 'character_ids', 'prop_ids', 'action', 'camera', 'duration', 'state_before', 'state_after', 'visible_text'].some((k) => f[k] !== undefined)) story.rebuildPrompts(cur.project_id, cur.id);
    return story.getProject(cur.project_id);
  }],
  ['DELETE', /^\/api\/story\/shots\/(\d+)$/, async (req, m) => { const s = story.getShot(+m[1]); if (!s) throw new HttpError(404, 'ไม่พบช็อต'); rmStoryVideo(s.video_file); story.deleteShot(s.id); return story.getProject(s.project_id); }],
  ['DELETE', /^\/api\/story\/shots\/(\d+)\/video$/, async (req, m) => { const s = story.getShot(+m[1]); if (!s) throw new HttpError(404, 'ไม่พบช็อต'); rmStoryVideo(s.video_file); story.clearShotVideo(s.id); return story.getProject(s.project_id); }],
  ['POST', /^\/api\/story\/shots\/(\d+)\/move$/, async (req, m) => {
    const s = story.getShot(+m[1]);
    if (!s) throw new HttpError(404, 'ไม่พบช็อต');
    const b = await readBody(req);
    story.moveShot(s.id, b.dir === 'up' ? -1 : 1);
    return story.getProject(s.project_id);
  }],
  ['POST', /^\/api\/story\/projects\/(\d+)\/rebuild-prompts$/, async (req, m) => { mustProject(+m[1]); story.rebuildPrompts(+m[1]); return story.getProject(+m[1]); }],

  ['GET', /^\/api\/settings$/, async () => settingsView()],
  ['POST', /^\/api\/settings$/, async (req) => {
    cfg.save(cleanSettings(await readBody(req)));
    return settingsView();
  }],
  // ดึงรายการรูปจากหน้าเว็บ (ให้ผู้ใช้เลือกเอง) / ดาวน์โหลดรูปที่เลือกมาเก็บในเครื่อง
  ['POST', /^\/api\/images\/search$/, async (req) => {
    const b = await readBody(req);
    const u = typeof b.url === 'string' ? b.url.trim().slice(0, 500) : '';
    if (!u) throw new HttpError(400, 'ใส่ลิงก์หน้าเว็บก่อน');
    const r = await feeds.readImages(u).catch((e) => { throw new HttpError(502, e.message); });
    if (!r.images.length) throw new HttpError(404, 'ไม่พบรูปในหน้านี้ — ลองลิงก์หน้าบทความตรง ๆ');
    return { page: r.page, host: new URL(r.page).hostname.replace(/^www\./, ''), images: r.images };
  }],
  ['POST', /^\/api\/images\/pick$/, async (req) => {
    const b = await readBody(req);
    const src = typeof b.url === 'string' ? b.url.trim().slice(0, 1000) : '';
    const ref = typeof b.ref === 'string' ? b.ref.trim().slice(0, 500) : '';
    const img = await feeds.fetchImage(src, ref).catch((e) => { throw new HttpError(502, `ดึงรูปไม่ได้: ${e.message}`); });
    const file = `${crypto.createHash('sha1').update(img.buf).digest('hex')}.${img.ext}`;
    fs.writeFileSync(path.join(IMG_DIR, file), img.buf);
    let credit = '';
    try { credit = new URL(ref || src).hostname.replace(/^www\./, ''); } catch { /* ไม่มีเครดิต */ }
    return { file, credit, src };
  }],
  // ดึงรูปจริงจากลิงก์ที่มา (ข่าว/แหล่งอ้างอิง) ให้อัตโนมัติ: เรียง og:image ก่อน ข้ามรูปเล็ก/ซ้ำ ได้สูงสุด max รูป — ลิงก์ไหนดึงไม่ได้ก็ข้ามไป
  ['POST', /^\/api\/images\/auto$/, async (req) => {
    const b = await readBody(req);
    const urls = (Array.isArray(b.urls) ? b.urls : []).filter((u) => typeof u === 'string').slice(0, 4);
    const max = Math.min(8, Math.max(1, Number(b.max) || 5));
    const got = [], seen = new Set(), notes = [];
    for (const page of urls) {
      if (got.length >= max) break;
      let list;
      try { list = (await feeds.readImages(page)).images; } catch (e) { notes.push(`${page}: ${e.message}`); continue; }
      let credit = '';
      try { credit = new URL(page).hostname.replace(/^www\./, ''); } catch { /* ไม่มีเครดิต */ }
      const main = list.filter((c) => c.from !== 'page'); // ใช้ og:image + รูปในบทความก่อน ไม่มีค่อยใช้รูปอื่นในหน้า
      let tried = 0;
      for (const cand of (main.length ? main : list)) {
        if (got.length >= max || tried >= 10) break;
        tried++;
        try {
          const img = await feeds.fetchImage(cand.url, page);
          if (img.buf.length < 25_000) continue; // รูปเล็กมากมักเป็นไอคอน/ปุ่ม/โฆษณา
          const file = `${crypto.createHash('sha1').update(img.buf).digest('hex')}.${img.ext}`;
          if (seen.has(file)) continue;
          seen.add(file);
          fs.writeFileSync(path.join(IMG_DIR, file), img.buf);
          got.push({ file, credit, src: cand.url });
        } catch { /* รูปนี้ดึงไม่ได้ ลองรูปถัดไป */ }
      }
    }
    return { images: got, notes };
  }],
  // รหัสจับคู่ส่วนเสริม Chrome (แสดงในหน้าตั้งค่า ให้คัดลอกไปใส่ในตัวเลือกของ extension)
  ['GET', /^\/api\/ext\/pairing$/, async () => ({ token: cfg.extToken, url: `http://127.0.0.1:${cfg.port}`, dir: path.join(__dirname, 'extension') })],
  ['POST', /^\/api\/ext\/pairing\/rotate$/, async () => { cfg.save({ extToken: crypto.randomBytes(24).toString('hex') }); return { token: cfg.extToken, url: `http://127.0.0.1:${cfg.port}`, dir: path.join(__dirname, 'extension') }; }],
  ['DELETE', /^\/api\/brand\/logo$/, async () => { fs.rmSync(LOGO_FILE, { force: true }); return { ok: true }; }],
  // ตรวจสถานะล็อกอิน Claude Code ใหม่ (ข้ามแคช) — หลังผู้ใช้ล็อกอินเสร็จ
  ['POST', /^\/api\/ai\/check$/, async () => settingsView(true)],
  // เริ่มล็อกอิน (เบราว์เซอร์เด้งขึ้นมาให้ผู้ใช้กดอนุญาตเอง) / ดูสถานะการล็อกอินที่กำลังทำอยู่
  ['POST', /^\/api\/ai\/login$/, async () => {
    if (!(await cli.info()).found) throw new HttpError(400, 'ไม่พบโปรแกรม claude (Claude Code) ในเครื่อง');
    return cli.startLogin();
  }],
  ['GET', /^\/api\/ai\/login$/, async () => ({ ...cli.loginState(), loggedIn: (await cli.info(true)).loggedIn })],
  ['POST', /^\/api\/tts\/test$/, async () => {
    const [name] = await tts.synthesize(['สวัสดีครับ นี่คือเสียงพากย์ทดสอบ']);
    return { file: `/tts/${name}` };
  }],
  ['GET', /^\/api\/status$/, async () => ({
    ffmpeg: await ffmpegOk(), ai: await ai.available(), aiProvider: cfg.aiProvider, model: cfg.model, themes: THEME_INFO, brand: brandLib.summary(), logo: fs.existsSync(LOGO_FILE) ? { v: Math.floor(fs.statSync(LOGO_FILE).mtimeMs) } : null,
    tts: await tts.available(), ttsProvider: cfg.ttsProvider, music: listMusic(),
  })],
  // ข้อความต่อฉาก → WAV เสียงไทย (แคชตามข้อความ); คืนลิงก์ /tts/<hash>.wav ตามลำดับเดิม
  ['POST', /^\/api\/tts$/, async (req) => {
    const { lines, tone } = await readBody(req);
    if (!Array.isArray(lines) || !lines.length || lines.length > 30 || lines.some((l) => typeof l !== 'string')) {
      throw new HttpError(400, 'lines ต้องเป็นอาร์เรย์ข้อความ 1–30 บรรทัด');
    }
    // tone = สไตล์คำบรรยายของโปรเจกต์เรื่อง → น้ำเสียงตอนอ่าน (เฉพาะ Gemini TTS ที่กำกับด้วยข้อความได้)
    return { files: (await tts.synthesize(lines, story.NARR_TONES[tone]?.speak || '')).map((n) => `/tts/${n}`) };
  }],
  // รูปอินโฟกราฟิก (data URL) → ชื่อ + เนื้อหา + สคริปต์ฉาก — ไม่บันทึกอะไรลง DB
  // ค้นความรู้จากคีย์เวิร์ด (ค้นเว็บ + แหล่งอ้างอิง) → ชื่อ เนื้อหา สคริปต์ แหล่งที่มา
  ['POST', /^\/api\/knowledge$/, async (req) => {
    const body = await readBody(req);
    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    if (topic.length < 2 || topic.length > 120) throw new HttpError(400, 'ใส่คีย์เวิร์ดหรือหัวข้อ 2–120 ตัวอักษร');
    const target = clean({ target_sec: body.target_sec ?? 0 }).target_sec;
    return ai.researchTopic(topic, target);
  }],
  ['POST', /^\/api\/extract$/, async (req) => {
    const body = await readBody(req, 8_000_000);
    const target = clean({ target_sec: body.target_sec ?? 0 }).target_sec;
    return ai.extractFromImage(body.image, target);
  }],
  ['GET', /^\/api\/music$/, async () => listMusic()],
  // ---------- คลังสินค้าแอฟฟิลิเอต ----------
  // ?q=&sort=new|sales|posted&limit=1..200&offset= → { items, total }
  ['GET', /^\/api\/products$/, async (req, m, url) => {
    const p = url.searchParams;
    return db.listProducts({
      q: (p.get('q') || '').trim().slice(0, 100),
      sort: ['sales', 'posted'].includes(p.get('sort')) ? p.get('sort') : 'new',
      limit: Math.min(200, Math.max(1, Number(p.get('limit')) || 50)),
      offset: Math.max(0, Number(p.get('offset')) || 0),
    });
  }],
  // ---- ดึงสินค้าที่เคยลงคลิปจากแอป Pondy บนมือถือ (adb, อ่านอย่างเดียว) ----
  // รายการสินค้าที่ลงไว้ให้ผู้ใช้เลือกเอง (รวมหลายเครื่อง ใหม่สุดก่อน) พร้อมชนิดลิงก์ — ไม่ใช้ AI
  ['POST', /^\/api\/pondy\/browse$/, async (req) => {
    const b = await readBody(req);
    const serials = (Array.isArray(b.serials) ? b.serials : []).filter((s) => typeof s === 'string' && /^[A-Za-z0-9._:-]{4,64}$/.test(s)).slice(0, 8);
    if (!serials.length) throw new HttpError(400, 'เลือกมือถืออย่างน้อย 1 เครื่องก่อน');
    const opts = {
      q: typeof b.q === 'string' ? b.q.trim().slice(0, 100) : '',
      days: Math.min(3650, Math.max(0, Number(b.days) || 0)),
      shortOnly: b.short === true,
      limit: 5000,
    };
    const merged = new Map();
    for (const serial of serials) {
      const r = await pondy.readProducts(serial, opts).catch((e) => { throw new HttpError(502, e.message); });
      for (const row of r.rows) if (!merged.has(row.url) || merged.get(row.url).last_posted < row.last_posted) merged.set(row.url, { ...row, serial });
    }
    const all = [...merged.values()].sort((a, c) => c.last_posted - a.last_posted);
    const limit = Math.min(200, Math.max(1, Number(b.limit) || 10));
    return {
      total: all.length,
      rows: all.slice(0, limit).map((r) => ({ name: r.name, url: r.url, keyword: r.keyword, last_posted: r.last_posted, serial: r.serial, link_kind: pondy.linkKind(r.url) })),
    };
  }],
  ['GET', /^\/api\/pondy\/devices$/, async () => pondy.devices().catch((e) => { throw new HttpError(502, e.message); })],
  // ดูก่อนนำเข้า: จำนวนที่ตรงเงื่อนไข + ตัวอย่าง
  ['POST', /^\/api\/pondy\/preview$/, async (req) => {
    const b = pondyOpts(await readBody(req));
    const r = await pondy.readProducts(b.serial, b).catch((e) => { throw new HttpError(502, e.message); });
    return {
      total: r.total, shown: r.rows.length, sample: r.rows.slice(0, 5).map((x) => x.name),
      rows: r.rows.slice(0, 200).map((x) => ({ name: x.name, url: x.url, keyword: x.keyword, last_posted: x.last_posted })), // ให้เลือกรายตัวในหน้าเว็บ
    };
  }],
  ['POST', /^\/api\/pondy\/import$/, async (req) => {
    const b = pondyOpts(await readBody(req));
    const r = await pondy.readProducts(b.serial, b).catch((e) => { throw new HttpError(502, e.message); });
    // แท็ก = คีย์เวิร์ดที่ใช้ค้นสินค้านั้นในแอป Pondy (ช่วยให้จับคู่กับคลิปแม่นขึ้น)
    const pick = b.urls ? new Set(b.urls) : null;
    const rows = pick ? r.rows.filter((x) => pick.has(x.url)) : r.rows;
    const res = db.addProductsBulk(rows.map((x) => ({ name: x.name.slice(0, 150), url: x.url.slice(0, 500), tags: (x.keyword || '').slice(0, 200), last_posted: x.last_posted })), `pondy:${b.serial}`);
    return { ...res, matched: r.total, read: rows.length };
  }],
  ['POST', /^\/api\/products$/, async (req) => db.addProduct(cleanProduct(await readBody(req), true))],
  // วางหลายบรรทัด: "ชื่อ | ลิงก์ | แท็ก | โน้ต | ยอดขาย" (ลิงก์อยู่ตำแหน่งไหนก็ได้, ที่เหลือไม่บังคับ) ลิงก์ซ้ำจะข้าม
  ['POST', /^\/api\/products\/import$/, async (req) => {
    const { text } = await readBody(req, 2_000_000);
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'วางรายการสินค้าก่อน');
    const have = new Set(db.allProducts().map((p) => p.url));
    let added = 0, skipped = 0, dup = 0;
    for (const line of text.split('\n').slice(0, 500)) {
      const parts = line.split('|').map((s) => s.trim());
      const i = parts.findIndex((p) => /https?:\/\/\S+/.test(p));
      if (i < 0) { if (line.trim()) skipped++; continue; }
      const u = parts[i].match(/https?:\/\/\S+/)[0];
      const rest = parts.filter((_, k) => k !== i);
      const before = parts[i].replace(u, '').trim(); // ชื่อเขียนติดหน้าลิงก์ เช่น "ครีมกันแดด https://…"
      try {
        const f = cleanProduct({ name: rest[0] || before || new URL(u).hostname, url: u, tags: rest[1] || '', note: rest[2] || '', sales: (rest[3] || '').replace(/[,\s]/g, '') }, true);
        if (have.has(f.url)) { dup++; continue; }
        db.addProduct(f); have.add(f.url); added++;
      } catch { skipped++; }
    }
    return { added, skipped, duplicates: dup };
  }],
  ['POST', /^\/api\/products\/clear-imported$/, async () => ({ removed: db.clearImported() })],
  ['PATCH', /^\/api\/products\/(\d+)$/, async (req, m) => {
    if (!db.getProduct(+m[1])) throw new HttpError(404, 'ไม่พบสินค้า');
    return db.updateProduct(+m[1], cleanProduct(await readBody(req), false));
  }],
  ['DELETE', /^\/api\/products\/(\d+)$/, async (req, m) => { db.removeProduct(+m[1]); return { ok: true }; }],
  // เลือกสินค้าให้คลิปนี้ + ชื่อลิงก์/ประโยคชวนสำหรับต่อท้ายแคปชัน
  //  mode: 'fit' = AI เลือกจากทั้งคลังให้เข้ากับคลิป (ค่าเริ่มต้น) | 'top' = ขายดีสุด 3 อันดับแรก ไม่สนว่าเกี่ยวกับคลิปไหม (ไม่ใช้ AI)
  //        'mix' = เอา 10 อันดับขายดี แล้วให้ AI เลือกอันที่เข้ากับคลิปที่สุด
  ['POST', /^\/api\/clips\/(\d+)\/products$/, async (req, m) => {
    const clip = mustGet(+m[1]);
    const b = await readBody(req);
    const mode = ['fit', 'top', 'mix'].includes(b.mode) ? b.mode : 'fit';
    if (b.source === 'catalog') return recommend(clip, mode); // คลังสินค้า (ยังเรียกผ่าน API ได้ แต่หน้าเว็บไม่ได้ใช้แล้ว)
    const serials = (Array.isArray(b.serials) ? b.serials : []).filter((s) => typeof s === 'string' && /^[A-Za-z0-9._:-]{4,64}$/.test(s)).slice(0, 8);
    return recommendFromPhones(clip, mode, {
      serials, days: Math.min(3650, Math.max(0, Number(b.days) || 0)), q: typeof b.q === 'string' ? b.q.trim().slice(0, 100) : '',
      shortOnly: b.short === true,
    });
  }],

  // ---------- โหมดข่าว ----------
  ['GET', /^\/api\/feeds$/, async () => db.listFeeds()],
  ['POST', /^\/api\/feeds$/, async (req) => {
    const b = await readBody(req);
    const url = typeof b.url === 'string' ? b.url.trim().slice(0, 500) : '';
    const parsed = await feeds.readFeed(url).catch((e) => { throw new HttpError(400, e.message); }); // ลองอ่านก่อนบันทึก
    const name = (typeof b.name === 'string' && b.name.trim()) || parsed.title || new URL(url).hostname;
    try { return db.addFeed(name.slice(0, 100), parsed.url); } catch { throw new HttpError(409, 'มีฟีดนี้อยู่แล้ว'); }
  }],
  ['DELETE', /^\/api\/feeds\/(\d+)$/, async (req, m) => { db.removeFeed(+m[1]); feedCache.delete(+m[1]); return { ok: true }; }],
  ['GET', /^\/api\/feeds\/(\d+)\/items$/, async (req, m, url) => {
    const feed = db.getFeed(+m[1]);
    if (!feed) throw new HttpError(404, 'ไม่พบฟีด');
    const hit = feedCache.get(feed.id);
    if (hit && Date.now() - hit.t < 300000 && !url.searchParams.has('fresh')) return { feed, items: hit.items };
    const { items } = await feeds.readFeed(feed.url).catch((e) => { throw new HttpError(502, `อ่านฟีดไม่ได้: ${e.message}`); });
    feedCache.set(feed.id, { t: Date.now(), items });
    return { feed, items };
  }],
  // เนื้อบทความของลิงก์ข่าวที่ผู้ใช้เลือก (ย่อหน้าหลัก) — ไว้ส่งให้ AI เรียบเรียง
  ['POST', /^\/api\/news\/article$/, async (req) => {
    const { url } = await readBody(req);
    return feeds.readArticle(String(url || '')).catch((e) => { throw new HttpError(502, `อ่านข่าวไม่ได้: ${e.message}`); });
  }],
  // ข่าว (ข้อความหรือรูป) → เรียบเรียงใหม่ + ใส่ที่มา; ไม่บันทึกอะไร (หน้าเว็บเอาไปกรอก/บันทึกเอง)
  ['POST', /^\/api\/news\/rewrite$/, async (req) => {
    const b = await readBody(req, 8_000_000);
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 12000) : '';
    const source = typeof b.source === 'string' ? b.source.trim().slice(0, 300) : '';
    if (!text && !b.image) throw new HttpError(400, 'ใส่ข้อความข่าวหรือรูปก่อน');
    return ai.rewriteNews({ text, image: typeof b.image === 'string' ? b.image : '', source, target_sec: clean({ target_sec: b.target_sec ?? 0 }).target_sec });
  }],
  ['GET', /^\/api\/stats$/, async () => db.stats()],
  // ?status=&q=&sort=new|old|title&limit=1..200&offset= → { items, total }
  ['GET', /^\/api\/clips$/, async (req, m, url) => {
    const p = url.searchParams;
    const sort = p.get('sort') || 'new';
    if (!(sort in db.SORTS)) throw new HttpError(400, 'sort ไม่รู้จัก');
    const limit = Math.min(200, Math.max(1, Number(p.get('limit')) || 24));
    const offset = Math.max(0, Number(p.get('offset')) || 0);
    const kind = p.get('kind'); if (kind && !['quick', 'story'].includes(kind)) throw new HttpError(400, 'kind ไม่รู้จัก');
    return db.list({ status: p.get('status') || undefined, kind: kind || undefined, q: (p.get('q') || '').trim().slice(0, 100), sort, limit, offset });
  }],
  ['POST', /^\/api\/clips$/, async (req) => db.create(clean(await readBody(req), { requireTitle: true }))],
  // ล้างคลิปที่ทำเครื่องหมาย "โพสต์แล้ว" ทั้งหมด (ลบไฟล์วิดีโอ/หน้าปกด้วย) — ไว้เคลียร์คลังหลังคัดลอกไปลงเสร็จ
  ['POST', /^\/api\/clips\/clear-posted$/, async () => {
    const { items } = db.list({ status: 'posted', limit: 100000 });
    let removed = 0;
    for (const clip of items) {
      rmVideo(clip);
      rmImages(clip);
      fs.rmSync(thumbPath(clip.id), { force: true });
      db.remove(clip.id);
      removed++;
    }
    return { removed };
  }],
  ['GET', /^\/api\/clips\/(\d+)$/, async (req, m) => mustGet(+m[1])],
  ['PATCH', /^\/api\/clips\/(\d+)$/, async (req, m) => {
    mustGet(+m[1]);
    return db.update(+m[1], clean(await readBody(req)));
  }],
  ['DELETE', /^\/api\/clips\/(\d+)$/, async (req, m) => {
    const clip = mustGet(+m[1]);
    if (rendering.has(clip.id)) throw new HttpError(409, 'กำลังเรนเดอร์อยู่ รอให้เสร็จก่อน');
    rmVideo(clip);
    rmImages(clip);
    fs.rmSync(thumbPath(clip.id), { force: true });
    db.remove(clip.id);
    return { ok: true };
  }],
  ['POST', /^\/api\/clips\/(\d+)\/script$/, async (req, m) => {
    const clip = mustGet(+m[1]);
    if (!clip.brief) throw new HttpError(400, 'ใส่เนื้อหา/prompt ก่อน');
    return db.update(clip.id, { script: await ai.writeScript(clip) });
  }],
  // prompt วิดีโอรายฉากสำหรับ Meta AI (เขียนทับของเดิม)
  ['POST', /^\/api\/clips\/(\d+)\/prompts$/, async (req, m) => {
    const clip = mustGet(+m[1]);
    if (!clip.script && !clip.brief) throw new HttpError(400, 'ต้องมีเนื้อหาหรือสคริปต์ก่อน');
    return db.update(clip.id, { video_prompts: JSON.stringify(await ai.writeVideoPrompts(clip)) });
  }],
  // prompt สร้างรูป: รูปปก 1 + รายฉาก (เขียนทับของเดิม)
  ['POST', /^\/api\/clips\/(\d+)\/image-prompts$/, async (req, m) => {
    const clip = mustGet(+m[1]);
    if (!clip.script && !clip.brief) throw new HttpError(400, 'ต้องมีเนื้อหาหรือสคริปต์ก่อน');
    const body = await readBody(req);
    return db.update(clip.id, { image_prompts: JSON.stringify(await ai.writeImagePrompts(clip, { single: body.single === true })) });
  }],
  ['POST', /^\/api\/clips\/(\d+)\/caption$/, async (req, m) => {
    const clip = mustGet(+m[1]);
    if (!clip.script && !clip.brief) throw new HttpError(400, 'ต้องมีเนื้อหาหรือสคริปต์ก่อน');
    return db.update(clip.id, await ai.writeCaption(clip));
  }],
  ['POST', /^\/api\/clips\/(\d+)\/render$/, async (req, m) => startRender(+m[1])],
  ['POST', /^\/api\/clips\/(\d+)\/posted$/, async (req, m) => {
    const clip = mustGet(+m[1]);
    if (!clip.video_file) throw new HttpError(400, 'ยังไม่มีไฟล์คลิป');
    const body = await readBody(req);
    const fb = typeof body.fb_url === 'string' ? body.fb_url.trim().slice(0, 500) : '';
    return db.update(clip.id, { status: 'posted', posted_at: Date.now(), fb_url: fb || null });
  }],
  ['POST', /^\/api\/clips\/(\d+)\/unposted$/, async (req, m) => {
    const clip = mustGet(+m[1]);
    return db.update(clip.id, { status: clip.video_file ? 'ready' : 'draft', posted_at: null, fb_url: null });
  }],
];

// รับไฟล์คลิปที่เบราว์เซอร์เรนเดอร์ (PUT body ดิบ mp4/webm) เก็บลง output/ แล้วตั้งสถานะ ready
async function saveUpload(req, id) {
  const clip = mustGet(id);
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  const ext = { 'video/mp4': '.mp4', 'video/webm': '.webm' }[type];
  if (!ext) throw new HttpError(415, 'รองรับเฉพาะ mp4/webm');
  if (rendering.has(id)) throw new HttpError(409, 'กำลังเรนเดอร์อยู่');
  const name = `clip-${id}-${Date.now()}${ext}`;
  const file = path.join(db.OUT_DIR, name);
  const MAX = 300_000_000;
  let size = 0;
  try {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(file);
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX) { reject(new HttpError(413, 'ไฟล์ใหญ่เกินไป')); ws.destroy(); req.destroy(); }
      });
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    });
    if (!size) throw new HttpError(400, 'ไฟล์ว่าง');
    if (!db.get(id)) throw new HttpError(404, 'ไม่พบคลิป');
  } catch (e) {
    fs.rmSync(file, { force: true });
    throw e;
  }
  rmVideo(db.get(id) || clip);
  const duration = Number(req.headers['x-duration']) || null;
  return db.update(id, { status: 'ready', video_file: name, duration, error: null, posted_at: null, fb_url: null });
}

// อัปโหลดโลโก้ (PNG ≤ 3MB — หน้าเว็บแปลง/ตัดพื้นหลังเป็น PNG ให้แล้ว) ตรวจลายเซ็นไฟล์จริงไม่เชื่อแค่ header
async function saveLogo(req) {
  const MAX = 3_000_000;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX) throw new HttpError(413, 'ไฟล์โลโก้ใหญ่เกิน 3MB');
    chunks.push(c);
  }
  const buf = Buffer.concat(chunks);
  if (buf.length < 100 || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new HttpError(400, 'ต้องเป็นไฟล์ PNG');
  fs.writeFileSync(LOGO_FILE, buf);
  return { ok: true, v: Math.floor(fs.statSync(LOGO_FILE).mtimeMs) };
}

// ส่งไฟล์วิดีโอพร้อม Range (ให้ <video> เลื่อนดูได้)
function serveMedia(req, res, id) {
  const clip = db.get(id);
  const file = clip && videoPath(clip);
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  const { size } = fs.statSync(file);
  const ext = path.extname(file);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = size - 1, status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = +range[1]; if (range[2]) end = Math.min(+range[2], size - 1); }
    else { start = Math.max(0, size - +range[2]); }
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      return res.end();
    }
    status = 206;
  }
  const headers = {
    'content-type': ext === '.webm' ? 'video/webm' : 'video/mp4', 'accept-ranges': 'bytes', 'content-length': end - start + 1,
    'content-disposition': `inline; filename="reel-${id}${ext}"`,
  };
  if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  fs.createReadStream(file, { start, end }).pipe(res);
}

function serveFile(res, file, type) {
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': type, 'content-length': fs.statSync(file).size, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  // หน้าเว็บกดหยุด/ตัดการเชื่อมต่อก่อนตอบเสร็จ → ยกเลิกงานที่ค้าง (เช่น โปรเซส Claude) ผ่าน lib/ctx.js
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  return ctx.run({ signal: ac.signal }, () => handleRequest(req, res));
});

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      // กันเว็บอื่นยิงมาที่ localhost (CSRF / DNS rebinding): Host ต้องเป็นเครื่องเรา และ Origin (ถ้ามี) ต้องเป็นหน้าเราเอง
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) throw new HttpError(403, 'host ไม่อนุญาต');
      if (req.headers.origin && new URL(req.headers.origin).host !== host) throw new HttpError(403, 'origin ไม่อนุญาต');
    }
    if (url.pathname.startsWith('/ext/')) return await handleExt(req, res, url);
    const media = /^\/media\/(\d+)\.mp4$/.exec(url.pathname);
    if (media && req.method === 'GET') return serveMedia(req, res, +media[1]);

    // ไฟล์เสียง: พากย์ที่แคชไว้ (ชื่อเป็น sha1 เท่านั้น) และเพลงของผู้ใช้ (ชื่อต้องอยู่ในรายการโฟลเดอร์ music/)
    const tts_ = /^\/tts\/([0-9a-f]{40}\.wav)$/.exec(url.pathname);
    if (tts_ && req.method === 'GET') return serveFile(res, path.join(tts.DIR, tts_[1]), 'audio/wav');
    const mus = /^\/music\/([^/\\]+)$/.exec(url.pathname);
    if (mus && req.method === 'GET') {
      const name = decodeURIComponent(mus[1]);
      if (!listMusic().includes(name)) throw new HttpError(404, 'ไม่พบไฟล์เพลง');
      return serveFile(res, path.join(MUSIC_DIR, name), MUSIC_EXT[path.extname(name).toLowerCase()]);
    }

    const cim = /^\/clip-images\/([0-9a-f]{40}\.(?:jpg|png|webp))$/.exec(url.pathname);
    if (cim && req.method === 'GET') return serveFile(res, path.join(IMG_DIR, cim[1]), { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[cim[1].split('.')[1]]);
    // พรอกซีรูปจากเว็บอื่นให้แสดงตัวอย่างในหน้า (หน้าเว็บโหลดตรงอาจโดนบล็อก hotlink) — ผ่านการตรวจ SSRF และเป็นรูปจริงเท่านั้น
    if (url.pathname === '/api/images/proxy' && req.method === 'GET') {
      const img = await feeds.fetchImage(url.searchParams.get('u') || '', url.searchParams.get('ref') || '').catch((e) => { throw new HttpError(502, e.message); });
      res.writeHead(200, { 'content-type': img.type, 'content-length': img.buf.length, 'cache-control': 'private, max-age=600' });
      return res.end(img.buf);
    }
    const sm = /^\/story-media\/(shot-\d+-\d+\.(mp4|webm|png|jpg|webp))$/.exec(url.pathname);
    if (sm && req.method === 'GET') return serveRange(req, res, path.join(STORY_VIDEO_DIR, sm[1]), STORY_MEDIA_TYPE[sm[2]]);
    const sv = /^\/api\/story\/shots\/(\d+)\/video$/.exec(url.pathname);
    if (sv && req.method === 'PUT') return send(res, 200, await saveShotVideo(req, +sv[1]));
    if (url.pathname === '/brand/logo.png' && req.method === 'GET') return serveFile(res, LOGO_FILE, 'image/png');
    if (url.pathname === '/api/brand/logo' && req.method === 'PUT') return send(res, 200, await saveLogo(req));

    const th = /^\/thumb\/(\d+)\.jpg$/.exec(url.pathname);
    if (th && req.method === 'GET') return serveFile(res, thumbPath(+th[1]), 'image/jpeg');
    const thUp = /^\/api\/clips\/(\d+)\/thumb$/.exec(url.pathname);
    if (thUp && req.method === 'PUT') return send(res, 200, await saveThumb(req, +thUp[1]));

    const upload = /^\/api\/clips\/(\d+)\/video$/.exec(url.pathname);
    if (upload && req.method === 'PUT') return send(res, 200, await saveUpload(req, +upload[1]));

    // อัปโหลดรูปที่สร้างเองเป็นพื้นหลังคลิป (raw image body)
    if (url.pathname === '/api/images/upload' && req.method === 'PUT') return send(res, 200, await saveClipImage(req));

    if (url.pathname.startsWith('/api/')) {
      for (const [method, re, handler] of routes) {
        const m = re.exec(url.pathname);
        if (m && method === req.method) return send(res, 200, await handler(req, m, url));
      }
      throw new HttpError(404, 'ไม่มี endpoint นี้');
    }
    if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
    serveStatic(res, url.pathname);
  } catch (e) {
    if (ctx.isCancel(e)) { if (!res.headersSent) res.destroy(); return; } // ผู้ใช้กดหยุด: การเชื่อมต่อปิดแล้ว ไม่ต้อง log/ตอบ
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'server error' });
    else res.end();
  }
}

server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`arn-reels: http://127.0.0.1:${cfg.port}`);
});
