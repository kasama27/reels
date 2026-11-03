// หน้าคลังคลิป — รองรับคลิปจำนวนมาก:
//  - แสดงทีละ PAGE รายการ (โหลดเพิ่ม) + ค้นหา/เรียง/กรองสถานะที่เซิร์ฟเวอร์
//  - แถวย่อมีแค่หน้าปก (รูป JPEG เล็ก) ไม่มี <video> ต่อแถว — คลิกเพื่อเปิดตัวเล่นตัวเดียวที่ใช้ร่วมกัน
//  - อัปเดตแถวแบบ keyed (ไม่ re-render innerHTML ทั้งก้อน) ไม่ทับข้อความที่ผู้ใช้กำลังพิมพ์
const $ = (id) => document.getElementById(id);
const PAGE = 24;
const cards = new Map(); // id -> { el, stamp, refs, videoFile, thumbKey }
let status = null;
let theme = 'stars';
let filter = '', query = '', sort = 'new', limit = PAGE, kind = '';

// งานที่ใช้เวลานาน (AI/ดึงข่าว) ขึ้นแถบความคืบหน้าอัตโนมัติ — ไม่รู้ % จริง จึงเป็นแถบวิ่ง + เวลาที่ผ่านไป
// (งานที่รู้ขั้นตอนชัด เช่น เรนเดอร์ ใช้ task.start/set/end เองเพื่อโชว์ %)
// [รูปแบบ URL, ข้อความบนการ์ดลอย, ข้อความสั้นบนปุ่ม]
const TASK_LABELS = [
  [/^\/api\/clips\/\d+\/script$/, 'AI กำลังเขียนข้อความบนจอ', 'AI กำลังเขียน'],
  [/^\/api\/clips\/\d+\/caption$/, 'AI กำลังเขียนแคปชัน', 'AI กำลังเขียน'],
  [/^\/api\/clips\/\d+\/image-prompts$/, 'AI กำลังคิด prompt รูป', 'AI กำลังคิด'],
  [/^\/api\/clips\/\d+\/prompts$/, 'AI กำลังคิด prompt วิดีโอ', 'AI กำลังคิด'],
  [/^\/api\/knowledge$/, 'AI กำลังค้นความรู้จากเว็บ', 'AI กำลังค้น'],
  [/^\/api\/story\/projects\/\d+\/ai-bible$/, 'AI กำลังร่างตัวละคร/สถานที่', 'AI กำลังร่าง'],
  [/^\/api\/story\/projects\/\d+\/ai-shots$/, 'AI กำลังแบ่งช็อต', 'AI กำลังแบ่งช็อต'],
  [/^\/api\/story\/projects\/\d+\/ai-narration$/, 'AI กำลังเขียนคำบรรยาย', 'AI กำลังเขียนคำบรรยาย'],
  [/^\/api\/story\/from-topic$/, 'AI กำลังค้นข้อมูลและเขียนสตอรีบอร์ด', 'AI กำลังเขียน'],
  [/^\/api\/story\/fan-comedy$/, 'AI กำลังเขียนสคริปต์สายฮา', 'AI กำลังเขียน'],
  [/^\/api\/images\/auto$/, 'กำลังดึงรูปจากที่มา', 'กำลังดึงรูป'],
  [/^\/api\/images\/(search|pick)$/, 'กำลังดึงรูปจากเว็บ', 'กำลังดึงรูป'],
  [/^\/api\/extract$/, 'AI กำลังอ่านรูป', 'AI กำลังอ่านรูป'],
  [/^\/api\/news\/rewrite$/, 'AI กำลังเรียบเรียงข่าว', 'AI กำลังเรียบเรียง'],
  [/^\/api\/news\/article$/, 'กำลังดึงเนื้อข่าว', 'กำลังดึงข่าว'],
  [/^\/api\/news\/find$/, 'AI กำลังค้นข่าวจากเว็บ', 'AI กำลังค้นข่าว'],
  [/^\/api\/tts\/test$/, 'กำลังสร้างเสียงทดสอบ', 'กำลังสร้างเสียง'],
  [/^\/api\/feeds$/, 'กำลังตรวจฟีดข่าว', 'กำลังตรวจฟีด'],
  [/^\/api\/clips\/\d+\/products$/, 'กำลังเลือกสินค้า', 'กำลังเลือก'],
  [/^\/api\/products\/import$/, 'กำลังนำเข้าสินค้า', 'กำลังนำเข้า'],
  [/^\/api\/pondy\/preview$/, 'กำลังอ่านข้อมูลจากมือถือ', 'กำลังอ่านมือถือ'],
  [/^\/api\/pondy\/browse$/, 'กำลังอ่านสินค้าจากมือถือ', 'กำลังอ่านมือถือ'],
  [/^\/api\/pondy\/import$/, 'กำลังนำเข้าสินค้าจากมือถือ', 'กำลังนำเข้า'],
];

// opts.signal: ผู้เรียกที่จัดการงานหลายขั้นเอง (quiet) ส่ง signal ของตัวเองมาเพื่อให้กดหยุดได้
async function api(method, url, body, { quiet = false, signal } = {}) {
  const hit = !quiet && method === 'POST' ? TASK_LABELS.find(([re]) => re.test(url)) : null;
  // งาน AI/ดึงข้อมูลที่กินเวลานาน ยกเลิกได้ด้วยปุ่มหยุด (abort → ตัดการเชื่อมต่อ → เซิร์ฟเวอร์ฆ่าโปรเซส)
  const ctrl = hit ? new AbortController() : null;
  const tid = hit ? task.start(hit[1], null, hit[2], ctrl) : 0;
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal || ctrl?.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // หน้าเว็บใหม่กว่าเซิร์ฟเวอร์ที่รันอยู่ → บอกวิธีแก้ตรง ๆ แทน "ไม่มี endpoint นี้"
      if (res.status === 404 && data.error === 'ไม่มี endpoint นี้') throw new Error('โปรแกรมเบื้องหลังยังเป็นรุ่นเก่า — ดับเบิลคลิก restart.bat ในโฟลเดอร์ reels แล้วกด Ctrl+F5 ที่หน้านี้');
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(STOPPED);
    throw e;
  } finally { if (tid) task.end(tid); }
}

// แถบความคืบหน้างาน (มุมซ้ายล่าง): pct = 0..1 หรือ null (ไม่ทราบ → แถบวิ่ง + วินาทีที่ผ่านไป)
// งานที่เริ่มระหว่างที่ปุ่มกำลังทำงาน (guard) จะ "เกาะ" กับปุ่มนั้น: ข้อความบนปุ่มเปลี่ยนเป็น ⏳ ขั้นตอน + % (หรือวินาที)
// และมีแถบเติมในปุ่ม — ผู้ใช้เห็นทันทีว่าปุ่มไหนทำงานอยู่ ส่วนงานที่ไม่มีปุ่ม (เช่น วางรูป) ใช้การ์ดลอยมุมซ้ายล่าง
const busyStack = [];

// หน้าต่างแบบ modal (dialog.showModal) อยู่ชั้นบนสุดของหน้า บังทุกอย่างที่อยู่นอกมัน รวมการ์ดความคืบหน้าและ toast
// → ย้าย element ลอยพวกนี้เข้าไปใน dialog ที่เปิดอยู่บนสุด; ปิด dialog แล้วย้ายกลับ (position: fixed ยังอิงหน้าจอเหมือนเดิม)
const STOPPED = 'หยุดแล้ว';
function overlayHost() { const open = [...document.querySelectorAll('dialog[open]')]; return open[open.length - 1] || document.body; }
function liftOverlay(el) { const host = overlayHost(); if (el && el.parentElement !== host) host.append(el); }
// ดักทุกหน้าต่าง รวมที่สร้างทีหลัง (ฟอร์ม/เมนูใน story.js ที่ d.remove() ตอนปิด) — ไม่งั้นการ์ดงาน/toast ที่ย้ายเข้าไปอยู่ในหน้าต่างนั้นจะหายไปกับมัน
document.addEventListener('close', (e) => { if (e.target instanceof HTMLDialogElement) { liftOverlay($('task')); liftOverlay($('toast')); } }, true);

// งานที่หยุดได้ (มี AbortController): ปุ่มที่กดเริ่มงานกลายเป็นปุ่มหยุด — ชี้/โฟกัสแล้วขึ้น "✕ หยุด" กดแล้วยกเลิก
// (ปกติ guard ปิดปุ่มไว้กันกดซ้ำ → เปิดให้กดได้ แต่ดักคลิกไว้ก่อนถึงตัวจัดการเดิม จึงไม่เริ่มงานซ้ำ)
function stopClick(e) {
  e.preventDefault(); e.stopImmediatePropagation();
  this._stopCtrl?.abort();
}
const repaintBtn = (e) => e.currentTarget._paint?.();

function paintBtn(t) {
  const b = t.btn;
  const tail = t.pct == null ? `${Math.floor((Date.now() - t.t0) / 1000)} วิ` : `${Math.round(t.pct * 100)}%`;
  let line = `⏳ ${t.short || 'กำลังทำ'} · ${tail}`;
  const stoppable = !!t.ctrl && !b.dataset.status && b.tagName === 'BUTTON';
  if (stoppable && !b._stopCtrl) {
    b._stopCtrl = t.ctrl;
    b.disabled = false;
    b.classList.add('stoppable');
    b.title = 'กดเพื่อหยุดงานนี้';
    b.addEventListener('click', stopClick, true);
    for (const ev of ['mouseenter', 'mouseleave', 'focus', 'blur']) b.addEventListener(ev, repaintBtn);
  }
  if (!stoppable && b._stopCtrl) unStop(b); // งานถัดไปบนปุ่มเดียวกันหยุดไม่ได้
  if (stoppable) { b._stopCtrl = t.ctrl; b._paint = () => paintBtn(t); if (b.matches(':hover, :focus-visible')) line = `✕ หยุด · ${tail}`; }
  if (b.dataset.status) { const s = $(b.dataset.status); s.textContent = line; s.hidden = false; } // กล่องวางรูป: แสดงในบรรทัดสถานะของกล่องเอง
  else {
    if (b.dataset.orig === undefined) b.dataset.orig = b.textContent;
    b.textContent = line;
  }
  b.classList.add('working');
  b.classList.toggle('indet', t.pct == null);
  b.style.setProperty('--p', t.pct == null ? '0%' : `${Math.round(t.pct * 100)}%`);
}

function unStop(b) {
  delete b._stopCtrl; delete b._paint;
  b.classList.remove('stoppable');
  b.removeAttribute('title');
  b.removeEventListener('click', stopClick, true);
  for (const ev of ['mouseenter', 'mouseleave', 'focus', 'blur']) b.removeEventListener(ev, repaintBtn);
  if (busyStack.includes(b)) b.disabled = true; // guard ยังทำขั้นต่อไปอยู่ (เช่น อัปโหลด/รีเฟรช) — กันกดซ้ำเหมือนเดิม
}

function restoreBtn(b) {
  b.classList.remove('working', 'indet');
  b.style.removeProperty('--p');
  if (b._stopCtrl) unStop(b);
  if (b.dataset.status) $(b.dataset.status).hidden = true;
  if (b.dataset.orig !== undefined) { b.textContent = b.dataset.orig; delete b.dataset.orig; }
}

// ปุ่มยังเห็นอยู่บนจอไหม (ไม่ถูกซ่อน/ถูกแทนที่ และอยู่ในกรอบที่มองเห็น — ถ้าอยู่ใน dialog ใช้กรอบของ dialog ที่เลื่อนได้)
function onScreen(b) {
  if (!b?.isConnected || !b.getClientRects().length) return false;
  const r = b.getBoundingClientRect();
  const box = b.closest('dialog')?.getBoundingClientRect() || { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  return r.bottom > box.top + 4 && r.top < box.bottom - 4 && r.right > box.left && r.left < box.right
    && r.bottom > 0 && r.top < innerHeight;
}

const task = (() => {
  const el = $('task'), label = $('task-label'), pctEl = $('task-pct'), fill = $('task-fill'), stop = $('task-stop');
  const tasks = new Map();
  let seq = 0, timer = null;
  // ปุ่มหยุดบนการ์ด: ยกเลิกงานที่กำลังแสดงอยู่ (เรียก abort ของ AbortController ที่ผูกกับงานนั้น)
  let shown = null;
  if (stop) stop.addEventListener('click', () => { shown?.ctrl?.abort(); });
  // เลื่อนหน้า → ปุ่มอาจหลุด/กลับเข้าจอ: วาดการ์ดใหม่ทันที (ไม่รอรอบ 1 วินาที)
  let raf = 0;
  document.addEventListener('scroll', () => { if (tasks.size && !raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }, { capture: true, passive: true });
  function paint() {
    const all = [...tasks.values()];
    for (const t of all) if (t.btn) paintBtn(t); // ปุ่มที่กดอยู่โชว์ ⏳ + เวลา/% เสมอ
    // การ์ดมุมซ้ายล่าง: งานที่ไม่มีปุ่ม หรือปุ่มหลุดจอไปแล้ว (เลื่อนหน้า/ปุ่มถูกวาดใหม่) — ถ้ายังเห็นปุ่มอยู่ ปุ่มนั้นเป็นตัวบอกสถานะและปุ่มหยุดเองแล้ว
    const list = all.filter((t) => !t.btn || !onScreen(t.btn));
    if (!list.length) { el.hidden = true; shown = null; if (!all.length) { clearInterval(timer); timer = null; } return; }
    const t = list[list.length - 1]; // แสดงงานที่เริ่มล่าสุด
    shown = t;
    liftOverlay(el); // ถ้ามีหน้าต่าง (dialog) เปิดอยู่ ย้ายการ์ดเข้าไปในนั้น ไม่งั้นโดนบัง
    el.hidden = false;
    if (stop) stop.hidden = !t.ctrl;
    label.textContent = t.label + (list.length > 1 ? ` (+${list.length - 1})` : '');
    if (t.pct == null) {
      el.classList.add('indet');
      pctEl.textContent = `${Math.floor((Date.now() - t.t0) / 1000)} วิ`;
      fill.style.width = '';
      el.removeAttribute('aria-valuenow');
    } else {
      el.classList.remove('indet');
      const p = Math.max(0, Math.min(100, Math.round(t.pct * 100)));
      pctEl.textContent = `${p}%`;
      fill.style.width = `${p}%`;
      el.setAttribute('aria-valuenow', String(p));
    }
  }
  return {
    start(text, pct = null, short = '', ctrl = null) {
      const id = ++seq;
      tasks.set(id, { label: text, short, pct, t0: Date.now(), btn: busyStack[busyStack.length - 1] || null, ctrl });
      timer ||= setInterval(paint, 1000);
      paint();
      return id;
    },
    set(id, pct, text) {
      const t = tasks.get(id);
      if (!t) return;
      if (pct !== undefined) t.pct = pct;
      if (text) t.label = text;
      paint();
    },
    end(id, hold = 0) { // hold: ค้าง 100% ไว้ครู่หนึ่งให้เห็นว่าเสร็จ
      const drop = () => {
        const t = tasks.get(id);
        tasks.delete(id);
        if (t?.btn && ![...tasks.values()].some((x) => x.btn === t.btn)) restoreBtn(t.btn); // ไม่มีงานอื่นเกาะปุ่มนี้แล้ว
        paint();
      };
      if (hold) { this.set(id, 1); setTimeout(drop, hold); return; }
      drop();
    },
  };
})();

function say(text) { $('msg').textContent = text || ''; }

let toastTimer = null;
function toast(text, bad = false) {
  const t = $('toast');
  if (text === STOPPED) bad = false; // ผู้ใช้กดหยุดเอง ไม่ใช่ข้อผิดพลาด
  liftOverlay(t);
  t.textContent = text;
  t.className = `toast${bad ? ' bad' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ถามยืนยัน/ถามค่า ด้วยหน้าต่างในแอป — confirm()/prompt() ของเบราว์เซอร์ใช้ไม่ได้ในบางหน้าจอ ("prompt() is not supported")
// คืน { ok, value }; กด Esc/ยกเลิก = ok:false
function askDialog({ title = 'ยืนยัน', msg = '', ok = 'ตกลง', danger = false, input = false, placeholder = '', value = '' }) {
  return new Promise((resolve) => {
    const d = $('ask'), field = $('ask-in');
    $('ask-t').textContent = title;
    $('ask-msg').textContent = msg;
    $('ask-yes').textContent = ok;
    $('ask-yes').className = `btn ${danger ? 'danger' : 'primary'}`;
    field.hidden = !input;
    field.placeholder = placeholder;
    field.value = value;
    d.addEventListener('close', () => resolve({ ok: d.returnValue === 'yes', value: field.value.trim() }), { once: true });
    d.returnValue = '';
    d.showModal();
    (input ? field : $('ask-yes')).focus();
  });
}
$('ask-no').addEventListener('click', () => $('ask').close('no')); // ปุ่มยกเลิกไม่ใช่ submit — Enter ในช่องกรอกจึงเท่ากับ "ตกลง"
const uiConfirm = async (msg, opts = {}) => (await askDialog({ msg, ...opts })).ok;
// คืนข้อความที่กรอก (เว้นว่างได้ = '') หรือ null ถ้ายกเลิก
const uiPrompt = async (msg, opts = {}) => { const r = await askDialog({ msg, input: true, ...opts }); return r.ok ? r.value : null; };

// กันกดซ้ำระหว่างทำงาน; error ขึ้น toast (แถวอยู่ไกลจากช่องข้อความของสตูดิโอ)
async function guard(btn, fn, onError = (e) => toast(e.message, true)) {
  btn.disabled = true;
  busyStack.push(btn);
  try { await fn(); } catch (e) { onError(e); } finally {
    busyStack.splice(busyStack.lastIndexOf(btn), 1);
    btn.disabled = false;
  }
}

const STATUS_TH = { draft: 'ร่าง', rendering: 'กำลังเรนเดอร์…', ready: 'พร้อมโพสต์', failed: 'ล้มเหลว', posted: 'โพสต์แล้ว' };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el[k] = v;
  }
  el.append(...kids);
  return el;
}

// เรนเดอร์ในเบราว์เซอร์ (canvas + MediaRecorder) แล้วอัปโหลดเข้าคลัง — ต้องเปิดแท็บค้างไว้จนเสร็จ
async function renderInBrowser(id, onProgress, onStatus = say) {
  const clip = await api('GET', `/api/clips/${id}`);
  const th = status.themes.find((t) => t.id === clip.theme) || status.themes[0];
  const canvas = document.createElement('canvas');
  canvas.id = 'rec';
  document.body.append(canvas);
  // ความคืบหน้า: เตรียม 0–15% (เสียงพากย์/เพลง) → อัดคลิป 15–93% (วัดจากเส้นเวลาจริง) → บันทึก 95–100%
  const ctrl = new AbortController(); // ปุ่ม "หยุด" บนการ์ดความคืบหน้า → เลิกอัด คลิปคงสถานะร่าง
  const tid = task.start(`เรนเดอร์ “${clip.title}”`, 0.02, 'กำลังอัดคลิป', ctrl);
  let ok = false;
  try {
    const { blob, mime, duration, thumb, note } = await ReelRender.render(clip, th, {
      canvas, voice: !!clip.voice, tone: clip.narr_tone || '', music: clip.music, target: clip.target_sec || 0, signal: ctrl.signal,
      images: (() => { try { return JSON.parse(clip.images || '[]').map((p) => ({ url: `/clip-images/${p.file}`, credit: p.credit })); } catch { return []; } })(),
      logo: status.logo && status.brand?.logoOn !== false ? `/brand/logo.png?v=${status.logo.v}` : '',
      onProgress: (p) => { task.set(tid, 0.15 + p * 0.78, `กำลังอัดคลิป “${clip.title}”`); onProgress?.(p); },
      onStatus: (t) => { task.set(tid, /เสียง/.test(t) ? 0.07 : 0.11, t); onStatus?.(t); },
    });
    task.set(tid, 0.95, 'กำลังบันทึกคลิปลงคลัง…');
    if (note) toast(note, true);
    // หน้าปกขึ้นก่อนวิดีโอ: พอสถานะเปลี่ยนเป็น ready แถวจะโหลดรูปได้ทันที (พลาดก็ไม่เป็นไร แสดงปุ่ม ▶ แทน)
    if (thumb) {
      await fetch(`/api/clips/${id}/thumb`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: thumb }).catch(() => {});
    }
    const res = await fetch(`/api/clips/${id}/video`, {
      method: 'PUT', headers: { 'content-type': mime, 'x-duration': String(duration) }, body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    ok = true;
  } finally {
    canvas.remove();
    if (ok) task.set(tid, 1, 'เรนเดอร์เสร็จแล้ว ✓');
    task.end(tid, ok ? 700 : 0);
  }
}

// คลิปสินค้า: วิดีโอดิบจาก Meta AI → ใส่ข้อความแนะนำไทย (ถ้าเปิดไว้) + เพลง/โลโก้ → อัดเป็นคลิปจริงของคลัง แล้วเขียนแคปชัน/คอมเมนต์ให้
async function finishProduct(id) {
  const clip = await api('GET', `/api/clips/${id}`);
  if (!clip.raw_video) throw new Error('ยังไม่มีวิดีโอจาก Meta AI — ส่งเข้ามาด้วยส่วนเสริมบน meta.ai หรือกด “📎 แนบวิดีโอ Meta AI”');
  const ps = await api('GET', '/api/product-clips/settings');
  const th = status.themes.find((t) => t.id === clip.theme) || status.themes[0];
  const canvas = document.createElement('canvas');
  canvas.id = 'rec';
  document.body.append(canvas);
  const ctrl = new AbortController();
  const tid = task.start(`คลิปสินค้า “${clip.title}”`, 0.02, 'กำลังทำคลิป', ctrl);
  let ok = false;
  try {
    const { blob, mime, duration, thumb, cover } = await ReelRender.assemble([{ url: `/product-raw/${clip.raw_video}` }], {
      canvas, aspect: '9:16', theme: th, keepAudio: true, voice: false, subs: false, music: clip.music, signal: ctrl.signal,
      coverAt: ps.coverAt ?? 0.4, coverText: ps.coverText !== false, // หน้าปก Reels = เฟรมวินาทีที่ตั้ง (ค่าเริ่มต้น 0.4) + ข้อความแนะนำ
      logo: status.logo && status.brand?.logoOn !== false ? `/brand/logo.png?v=${status.logo.v}` : '',
      intro: ps.overlay ? { name: clip.title } : null,
      onProgress: (p) => task.set(tid, 0.1 + p * 0.8, `กำลังอัดคลิป “${clip.title}”`),
      onStatus: (t) => task.set(tid, 0.06, t),
    });
    task.set(tid, 0.92, 'กำลังบันทึกคลิปลงคลัง…');
    if (thumb) await fetch(`/api/clips/${id}/thumb`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: thumb }).catch(() => {});
    if (cover) await fetch(`/api/clips/${id}/cover`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: cover }).catch(() => {});
    const res = await fetch(`/api/clips/${id}/video`, { method: 'PUT', headers: { 'content-type': mime, 'x-duration': String(duration) }, body: blob });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    ok = true;
  } finally {
    canvas.remove();
    if (ok) task.set(tid, 1, 'ทำคลิปสินค้าเสร็จแล้ว ✓');
    task.end(tid, ok ? 700 : 0);
  }
  if (!clip.caption && status.ai) {
    await api('POST', `/api/clips/${id}/product-post`).catch((e) => toast(`ทำคลิปเสร็จแล้ว แต่ AI เขียนแคปชันไม่สำเร็จ: ${e.message}`, true));
  }
}

// แนบวิดีโอจาก Meta AI เอง (กรณีส่วนเสริมส่งไม่ได้) → เป็นวิดีโอดิบของคลิปสินค้า
function pickRawVideo(id) {
  return new Promise((resolve, reject) => {
    const inp = h('input', { type: 'file', accept: 'video/mp4,video/webm' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return resolve(false);
      try {
        const res = await fetch(`/api/clips/${id}/raw`, { method: 'PUT', headers: { 'content-type': f.type || 'video/mp4' }, body: f });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        resolve(true);
      } catch (e) { reject(e); }
    });
    inp.click();
  });
}

// คัดลอกลงคลิปบอร์ด: ใช้ Clipboard API ก่อน ถ้าถูกบล็อก (เช่น ไม่ใช่ https) ถอยไปใช้ execCommand
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* ลองทางสำรอง */ }
  const ta = h('textarea', { value: text });
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ไม่รองรับ */ }
  ta.remove();
  return ok;
}

// ---------- ตัวเลือกสไตล์เสียงพากย์ ----------
// รายการเดียวกับโปรเจกต์เรื่อง/ซีรีส์ (มาจากเซิร์ฟเวอร์) — เพิ่มสไตล์ใหม่ที่ story.NARR_TONES แล้วขึ้นที่นี่เอง
function fillTone(sel, value) {
  const tones = status.tones?.length ? status.tones : [{ id: 'plain', label: 'เล่าเรื่องธรรมดา' }];
  sel.replaceChildren(...tones.map((t) => new Option(`🎙 ${t.label}`, t.id)));
  sel.value = tones.some((t) => t.id === value) ? value : 'plain';
}

// ---------- ตัวเลือกเพลง ----------
function fillMusic(sel, value) {
  sel.replaceChildren(
    new Option('ไม่ใส่เพลง', 'none'),
    new Option('🎹 สงบ (สร้างสด)', 'calm'),
    new Option('🔮 ลึกลับ/ดูดวง (สร้างสด)', 'mystic'),
    new Option('🥁 สนุก จังหวะเร็ว (สร้างสด)', 'upbeat'),
    ...status.music.map((f) => new Option(`🎵 ${f}`, `file:${f}`)),
  );
  sel.value = [...sel.options].some((o) => o.value === value) ? value : 'none';
}

// ---------- ตัวเล่นวิดีโอร่วม ----------
function openPlayer(id, file) {
  if (!file) return;
  const v = $('player-v');
  v.src = `/media/${id}.mp4?v=${encodeURIComponent(file)}`;
  $('player').showModal();
  v.play().catch(() => {});
}
$('player').addEventListener('close', () => {
  const v = $('player-v');
  v.pause();
  v.removeAttribute('src');
  v.load();
});
$('player-x').addEventListener('click', () => $('player').close());
$('player').addEventListener('click', (e) => { if (e.target === $('player')) $('player').close(); });

// ---------- Prompt สร้างรูป ----------
// รูปปก + รายฉาก เก็บใน clips.image_prompts; อัตราส่วนเติมตอนแสดง/คัดลอก (เปลี่ยนได้โดยไม่ต้องให้ AI คิดใหม่)
let ipClip = null;
const ipList = (c) => { try { const a = JSON.parse(c.image_prompts || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
// ข้อความไทยที่จะขึ้นบนรูป: ปก = ชื่อคลิป, รูปที่ n = ข้อความบนจอบรรทัดที่ n ("หัวข้อ | รายละเอียด" → "หัวข้อ — รายละเอียด")
// ผู้ใช้แก้ข้อความของรูปนั้นเองได้ (เก็บในรูปนั้น) — ยังไม่เคยแก้ใช้ค่าตั้งต้น: ปกตัดวงเล็บท้ายชื่อออก
function ipOverlay(i) {
  const own = ipList(ipClip)[i]?.text;
  if (typeof own === 'string') return own;
  if (i === 0) return String(ipClip.title || '').replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim();
  const line = String(ipClip.script || '').split('\n').map((l) => l.trim()).filter(Boolean)[i - 1] || '';
  return line.split('|').map((s) => s.trim()).filter(Boolean).join(' — ');
}
// ใส่ข้อความไทยในรูปด้วย (ติ๊ก) = เติมคำสั่งให้โมเดลวาดข้อความนั้นลงในรูป; ไม่ติ๊ก = รูปไม่มีตัวหนังสือ ใส่ทับเองภายหลัง
function ipText(ta, i) {
  const base = ta.value.trim().replace(/[.\s]+$/, '');
  const live = ta.closest('li')?.querySelector('input.ip-text');
  const txt = $('ip-text').checked ? (live ? live.value.trim() : ipOverlay(i)) : '';
  const withText = txt ? `${base.replace(/,?\s*no text, no letters, no numbers, no logos, no watermark$/i, '')}. Add this exact Thai text on the image in a large, clean, bold, high-contrast font, spelled exactly as written, no other text: "${txt}"; no logos, no watermark` : base;
  return `${withText}, ${$('ip-ratio').value}.`;
}
const ipCurrent = () => [...$('ip-list').children].map((li) => ({ prompt: li.querySelector('textarea').value.trim(), note: li.dataset.note || '', text: li.querySelector('input.ip-text').value.trim() })).filter((p) => p.prompt);

function renderImgPrompts() {
  const list = ipList(ipClip);
  $('ip-sub').textContent = ipClip.title;
  $('ip-list').replaceChildren(...list.map((p, i) => {
    const ta = h('textarea', { rows: 4, value: p.prompt, spellcheck: false });
    ta.addEventListener('change', () => api('PATCH', `/api/clips/${ipClip.id}`, { image_prompts: ipCurrent() }).catch((e) => { $('ip-msg').textContent = e.message; }));
    const copy = h('button', { class: 'btn sm', type: 'button', textContent: '📋 คัดลอก' });
    copy.addEventListener('click', async () => {
      if (!(await copyText(ipText(ta, i)))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
      copy.textContent = 'คัดลอกแล้ว ✓';
      setTimeout(() => { copy.textContent = '📋 คัดลอก'; }, 1500);
    });
    const ov = h('input', { class: 'ip-text', maxLength: 200, value: ipOverlay(i), placeholder: 'ไม่ใส่ข้อความก็ได้' });
    ov.addEventListener('change', () => api('PATCH', `/api/clips/${ipClip.id}`, { image_prompts: ipCurrent() }).then((c) => { ipClip = c; }).catch((e) => { $('ip-msg').textContent = e.message; }));
    const li = h('li', { class: 'pr-item' },
      h('div', { class: 'pr-head' }, h('b', { textContent: list.length === 1 ? 'รูปเดียว (ทั้งโพสต์)' : i === 0 ? 'รูปปก' : `รูปที่ ${i}` }), h('span', { class: 'note', textContent: p.note || '', title: p.note || '' }), copy), ta,
      h('label', { class: 'ip-over' }, h('span', { class: 'cap-label', textContent: 'ข้อความบนรูป (แก้ได้ — ใช้เมื่อติ๊ก “ใส่ข้อความไทยในรูปด้วย”)' }), ov));
    li.dataset.note = p.note || '';
    return li;
  }));
  $('ip-empty').hidden = list.length > 0;
  $('ip-copyall').disabled = !list.length;
  $('ip-gen').textContent = list.length ? '↻ ให้ AI คิดใหม่' : '✨ ให้ AI คิด prompt รูป';
}

async function generateImgPrompts() {
  $('ip-msg').textContent = 'กำลังให้ AI คิด prompt รูป…';
  try {
    ipClip = await api('POST', `/api/clips/${ipClip.id}/image-prompts`, { single: $('ip-mode').value === 'single' });
    $('ip-msg').textContent = '';
    renderImgPrompts();
  } catch (e) { $('ip-msg').textContent = e.message; }
}

async function openImgPrompts(id, autoGenerate = false) {
  ipClip = await api('GET', `/api/clips/${id}`);
  $('ip-msg').textContent = '';
  renderImgPrompts();
  $('imgp').showModal();
  if (autoGenerate && !ipList(ipClip).length && status.ai) await generateImgPrompts();
}

$('ip-gen').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  if (ipList(ipClip).length && !(await uiConfirm('เขียนทับ prompt รูปเดิมทั้งหมด (รวมที่คุณแก้ไว้)?', { title: 'ให้ AI คิดใหม่', ok: 'เขียนทับ', danger: true }))) return;
  await generateImgPrompts();
}));
$('ip-copyall').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  const text = [...$('ip-list').children].map((li, i, all) => `${all.length === 1 ? 'รูปเดียว' : i === 0 ? 'รูปปก' : `รูปที่ ${i}`}\n${ipText(li.querySelector('textarea'), i)}`).join('\n\n');
  if (!text) return;
  if (!(await copyText(text))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
  b.textContent = 'คัดลอกแล้ว ✓';
  setTimeout(() => { b.textContent = '📋 คัดลอกทั้งหมด'; }, 1500);
});
$('ip-text').addEventListener('change', () => { /* คัดลอกครั้งถัดไปจะใช้ค่าใหม่ */ });
$('ip-x').addEventListener('click', () => $('imgp').close());
$('ip-close').addEventListener('click', () => $('imgp').close());

// ---------- Prompt สำหรับ Meta AI ----------
// meta.ai ฝังใน iframe ไม่ได้ (frame-ancestors 'self') → AI คิด prompt รายฉากให้ ผู้ใช้คัดลอกไปวางที่ meta.ai (แท็บใหม่)
let prClip = null;

function parsePrompts(c) {
  try { const a = JSON.parse(c.video_prompts || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

// prompt ตามที่เห็นในช่อง (รวมที่ผู้ใช้แก้แล้ว)
function currentPrompts() {
  return [...$('pr-list').children].map((li) => ({ prompt: li.querySelector('textarea').value.trim(), note: li.dataset.note || '' })).filter((p) => p.prompt);
}

function renderPrompts() {
  const list = parsePrompts(prClip);
  $('pr-sub').textContent = prClip.title;
  $('pr-list').replaceChildren(...list.map((p, i) => {
    const ta = h('textarea', { rows: 4, value: p.prompt, spellcheck: false });
    ta.addEventListener('change', () => { fillMerged(); return api('PATCH', `/api/clips/${prClip.id}`, { video_prompts: currentPrompts() }).catch((e) => { $('pr-msg').textContent = e.message; }); });
    const copy = h('button', { class: 'btn sm', type: 'button', textContent: '📋 คัดลอก' });
    copy.addEventListener('click', async () => {
      if (!(await copyText(ta.value))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
      copy.textContent = 'คัดลอกแล้ว ✓';
      setTimeout(() => { copy.textContent = '📋 คัดลอก'; }, 1500);
    });
    const li = h('li', { class: 'pr-item' },
      h('div', { class: 'pr-head' }, h('b', { textContent: `ฉาก ${i + 1}` }), h('span', { class: 'note', textContent: p.note || '', title: p.note || '' }), copy),
      ta);
    li.dataset.note = p.note || '';
    return li;
  }));
  $('pr-empty').hidden = list.length > 0;
  $('pr-merge').hidden = !list.length;
  if (list.length) fillMerged();
  $('pr-copyall').disabled = !list.length;
  $('pr-gen').textContent = list.length ? '↻ ให้ AI คิดใหม่' : '✨ ให้ AI คิด prompt';
}

// รวม prompt รายฉากเป็นอันเดียว: ตัดท้ายที่ซ้ำกันทุกฉาก (สไตล์/9:16/ห้ามตัวอักษร) ไว้ใส่ครั้งเดียวตอนท้าย
function mergePrompts(list) {
  const STYLE_AT = /Consistent visual style:|Cinematic, deep navy/i; // ท้าย prompt ที่เป็นสไตล์/ข้อห้ามซ้ำกันทุกฉาก
  const clean = (s) => s.replace(/Consistent visual style:/gi, '').replace(/,?\s*vertical 9:16\.?/gi, '').replace(/[,.]?\s*no text[^.]*\.?/gi, '').replace(/[\s,]+$/, '').replace(/\s+/g, ' ').trim();
  const split = (p) => { const k = p.search(STYLE_AT); return k < 0 ? [p.trim(), ''] : [p.slice(0, k).trim(), p.slice(k)]; };
  const parts = list.map((p) => split(p.prompt));
  const style = clean(parts.find((x) => x[1])?.[1] || '');
  return [parts.length === 1 ? 'One vertical 9:16 video shot, as described below.' : `One continuous vertical 9:16 video made of ${parts.length} consecutive shots, joined by smooth cuts in the order below.`,
    ...parts.map((x, i) => `Shot ${i + 1}: ${clean(x[0])}`),
    `Visual style for all shots: ${style || 'cinematic, consistent color palette and lighting'}. Keep the same visual style, color palette and lighting across all shots. Vertical 9:16. No text, no letters, no numbers, no logos, no watermark.`].join('\n');
}

// คำบรรยาย: จากข้อความบนจอ (หัวข้อ | รายละเอียด → ประโยคเดียว) ถ้าไม่มีใช้แคปชั่น
function narrationOf(c) {
  const lines = String(c.script || '').split('\n').map((l) => l.split('|').map((s) => s.trim()).filter(Boolean).join(' — ')).filter(Boolean);
  return lines.length ? lines.join('\n') : String(c.caption || '').trim();
}

// แบ่งฉากเป็นชุดตาม #pr-group (ค่าเริ่มต้น 2 ฉาก ≈ 10 วินาที ตามความยาวที่ Meta AI สร้างได้ต่อครั้ง) — 1 ชุด = 1 prompt = 1 คลิป
function fillMerged() {
  const all = currentPrompts();
  const size = Math.max(1, Number($('pr-group').value) || 2);
  const sets = [];
  for (let k = 0; k < all.length; k += size) sets.push(all.slice(k, k + size));
  $('pr-sets').replaceChildren(...sets.map((s, n) => {
    const from = n * size + 1, to = from + s.length - 1;
    const ta = h('textarea', { rows: 6, value: mergePrompts(s), spellcheck: false });
    const copy = h('button', { class: 'btn sm', type: 'button', textContent: '📋 คัดลอก' });
    copy.addEventListener('click', async () => {
      if (!(await copyText(ta.value))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
      copy.textContent = 'คัดลอกแล้ว ✓';
      setTimeout(() => { copy.textContent = '📋 คัดลอก'; }, 1500);
    });
    const label = sets.length === 1 ? `ทุกฉาก (${s.length} ฉาก)` : `คลิป ${n + 1}/${sets.length} · ฉาก ${from === to ? from : `${from}–${to}`} (~${s.length * 5} วิ)`;
    return h('div', { class: 'pr-set' }, h('div', { class: 'pr-head' }, h('b', { textContent: label }), copy), ta);
  }));
  $('pr-narr').value = narrationOf(prClip);
}
$('pr-group').addEventListener('change', fillMerged);
$('pr-narr-copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget, t0 = btn.textContent;
  if (!(await copyText($('pr-narr').value))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
  btn.textContent = 'คัดลอกแล้ว ✓';
  setTimeout(() => { btn.textContent = t0; }, 1500);
});

async function generatePrompts() {
  $('pr-msg').textContent = 'กำลังให้ AI คิด prompt…';
  try {
    prClip = await api('POST', `/api/clips/${prClip.id}/prompts`);
    $('pr-msg').textContent = '';
    renderPrompts();
  } catch (e) { $('pr-msg').textContent = e.message; }
}

async function openPrompts(id, autoGenerate = false) {
  prClip = await api('GET', `/api/clips/${id}`);
  $('pr-msg').textContent = '';
  renderPrompts();
  $('prompts').showModal();
  if (autoGenerate && !parsePrompts(prClip).length && status.ai) await generatePrompts();
}

$('pr-gen').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  if (parsePrompts(prClip).length && !(await uiConfirm('เขียนทับ prompt เดิมทั้งหมด (รวมที่คุณแก้ไว้)?', { title: 'ให้ AI คิดใหม่', ok: 'เขียนทับ', danger: true }))) return;
  await generatePrompts();
}));
$('pr-copyall').addEventListener('click', async (e) => {
  const text = currentPrompts().map((p, i) => `ฉาก ${i + 1}\n${p.prompt}`).join('\n\n');
  if (!text) return;
  const b = e.currentTarget;
  if (!(await copyText(text))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
  b.textContent = 'คัดลอกแล้ว ✓';
  setTimeout(() => { b.textContent = '📋 คัดลอกทั้งหมด'; }, 1500);
});
$('pr-x').addEventListener('click', () => $('prompts').close());
$('pr-close').addEventListener('click', () => $('prompts').close());

// ---------- แถวคลิป ----------
function buildCard(c) {
  const refs = {};
  const entry = { el: null, refs, stamp: 0, videoFile: null, thumbKey: null };

  // หน้าปก
  refs.img = h('img', { alt: '', loading: 'lazy', hidden: true });
  refs.ph = h('span', { class: 'ph' });
  refs.play = h('span', { class: 'play', textContent: '▶', hidden: true });
  refs.dur = h('span', { class: 'dur', hidden: true });
  refs.img.addEventListener('error', () => { refs.img.hidden = true; refs.ph.hidden = false; refs.ph.textContent = '▶ เล่น'; });
  refs.thumb = h('button', { class: 'thumb', type: 'button', title: 'เล่นคลิป' }, refs.img, refs.ph, refs.play, refs.dur);
  refs.thumb.addEventListener('click', () => (entry.photo ? window.open(`/photo/${entry.videoFile}`, '_blank', 'noopener') : openPlayer(c.id, entry.videoFile)));

  refs.title = h('div', { class: 'item-title' });
  refs.meta = h('div', { class: 'meta' });
  refs.source = h('div', { class: 'source' });
  refs.badge = h('span', { class: 'badge' });
  refs.snippet = h('p', { class: 'snippet' });
  refs.tagline = h('div', { class: 'tagline' });
  refs.titleIn = h('input', { maxLength: 200, placeholder: 'ชื่อคลิป' });
  refs.badgeIn = h('input', { maxLength: 40, placeholder: 'ป้ายมุมคลิป เช่น ตอนที่ 20 (เว้นว่าง = ไม่มีป้าย)' });
  refs.caption = h('textarea', { rows: 4, placeholder: 'แคปชัน — กด “AI แคปชัน” หรือพิมพ์เอง' });
  refs.tags = h('textarea', { rows: 2, placeholder: '#แฮชแท็ก' });
  refs.script = h('textarea', { rows: 5, placeholder: 'ข้อความบนจอ (บรรทัดละ 1 จอ)' });
  refs.voice = h('input', { type: 'checkbox' });
  refs.music = h('select');
  refs.tone = h('select', { title: 'สไตล์เสียงพากย์ (ชุดเดียวกับเรื่องหลายช็อต/ซีรีส์)' });
  refs.len = h('input', { type: 'number', min: 5, max: 90, step: 1, placeholder: 'อัตโนมัติ' });
  refs.err = h('div', { class: 'err' });

  const showText = () => {
    const cap = refs.caption.value.trim(), tags = refs.tags.value.trim();
    refs.snippet.textContent = cap || 'ยังไม่มีแคปชัน — กดแก้ไขเพื่อให้ AI เขียนหรือพิมพ์เอง';
    refs.snippet.classList.toggle('empty-cap', !cap);
    refs.tagline.textContent = tags;
    refs.tagline.hidden = !tags;
  };
  refs.showText = showText;
  refs.caption.addEventListener('input', showText);
  refs.tags.addEventListener('input', showText);

  const save = () => api('PATCH', `/api/clips/${c.id}`, {
    title: refs.titleIn.value.trim() || refs.title.textContent, // เว้นว่าง = คงชื่อเดิม
    badge: refs.badgeIn.value.trim(),
    script: refs.script.value, caption: refs.caption.value, hashtags: refs.tags.value,
    voice: refs.voice.checked, narr_tone: refs.tone.value, music: refs.music.value,
    target_sec: Math.round(Number(refs.len.value)) || 0,
  });
  const action = (label, fn, cls = '') => {
    const b = h('button', { class: `btn sm ${cls}`, type: 'button', textContent: label });
    b.addEventListener('click', () => guard(b, async () => { await fn(); await refresh(); }));
    return b;
  };

  // ปุ่มคัดลอก: ทั้งสองอย่าง / แคปชัน / แฮชแท็ก (ไว้วางตอนโพสต์เอง)
  const copyBtn = (label, getText, empty, primary = false) => {
    const b = h('button', { class: `btn sm${primary ? ' primary' : ''}`, type: 'button', textContent: label });
    b.addEventListener('click', async () => {
      const text = getText();
      if (!text) return toast(empty, true);
      if (!(await copyText(text))) return toast('คัดลอกไม่ได้ — ลองเลือกข้อความแล้วกด Ctrl+C', true);
      b.textContent = 'คัดลอกแล้ว ✓';
      setTimeout(() => { b.textContent = label; }, 1500);
    });
    return b;
  };
  const capText = () => refs.caption.value.trim();
  const tagText = () => refs.tags.value.trim();
  refs.btnCopyAll = copyBtn('📋 คัดลอกแคปชัน + แฮชแท็ก', () => [capText(), tagText()].filter(Boolean).join('\n\n'), 'ยังไม่มีแคปชัน — กด “AI แคปชัน” หรือพิมพ์เอง', true);
  refs.btnCopyCap = copyBtn('คัดลอกแคปชัน', capText, 'ยังไม่มีแคปชัน');
  refs.btnCopyTags = copyBtn('# คัดลอกแฮชแท็ก', tagText, 'ยังไม่มีแฮชแท็ก');
  // คลิปสินค้า: คอมเมนต์แรก (ลิงก์แอฟฟิลิเอต) · เขียนแคปชันสินค้าใหม่ · แนบวิดีโอดิบเอง
  refs.btnCopyCmt = copyBtn('💬 คัดลอกคอมเมนต์ (ลิงก์)', () => (entry.fbComment || '').trim(), 'ยังไม่มีคอมเมนต์ — กด “✍ แคปชันสินค้า”');
  refs.btnPPost = h('button', { class: 'btn sm', type: 'button', textContent: '✍ แคปชันสินค้า', title: 'ให้ AI เขียนแคปชันเพจ + คอมเมนต์แรกที่มีลิงก์แอฟฟิลิเอต' });
  refs.btnPPost.addEventListener('click', () => guard(refs.btnPPost, async () => {
    if ((refs.caption.value.trim()) && !(await uiConfirm('เขียนแคปชัน/แฮชแท็ก/คอมเมนต์ใหม่ทับของเดิม?', { title: 'แคปชันสินค้า', ok: 'เขียนใหม่' }))) return;
    await api('POST', `/api/clips/${c.id}/product-post`);
    await refresh();
  }));
  refs.btnRaw = h('button', { class: 'btn sm', type: 'button', textContent: '📎 แนบวิดีโอ Meta AI', title: 'แนบไฟล์วิดีโอที่ดาวน์โหลดจาก meta.ai เอง (ถ้าส่วนเสริมส่งให้ไม่ได้)' });
  refs.btnRaw.addEventListener('click', () => guard(refs.btnRaw, async () => {
    if (!(await pickRawVideo(c.id))) return;
    toast('แนบวิดีโอแล้ว — กำลังใส่ข้อความและทำคลิป…');
    await refresh();
    await finishProduct(c.id);
    await refresh();
  }));
  refs.download = h('a', { class: 'btn sm dl' });
  refs.btnPrompts = h('button', { class: 'btn sm', type: 'button', textContent: '🎬 Prompt Meta AI' });
  refs.btnPrompts.addEventListener('click', () => guard(refs.btnPrompts, () => openPrompts(c.id, true)));
  refs.btnImg = h('button', { class: 'btn sm', type: 'button', textContent: '🖼 Prompt รูป' });
  refs.btnImg.addEventListener('click', () => guard(refs.btnImg, () => openImgPrompts(c.id, true)));
  refs.btnProducts = h('button', { class: 'btn sm', type: 'button', textContent: '🛍 แนะนำสินค้า' });
  refs.btnProducts.addEventListener('click', () => guard(refs.btnProducts, () => openRecs(c.id)));
  // สะพานเชื่อม: ขยายคลิปเร็วนี้เป็นโปรเจกต์เรื่องหลายช็อต (ส่งชื่อ/เนื้อหา/ป้ายไปตั้งต้น)
  refs.btnExpand = h('button', { class: 'btn sm', type: 'button', textContent: '🎞 ขยายเป็นเรื่อง', title: 'สร้างโปรเจกต์เรื่องหลายช็อตจากคลิปนี้ (ทำรูป/คลิปทีละช็อตแล้วรวม)' });
  refs.btnExpand.addEventListener('click', () => guard(refs.btnExpand, () => expandToStory(c.id)));
  refs.btnPosted = h('button', { class: 'btn sm', type: 'button' });
  refs.btnPosted.addEventListener('click', () => guard(refs.btnPosted, async () => {
    if (refs.btnPosted.dataset.posted) {
      await api('POST', `/api/clips/${c.id}/unposted`);
    } else {
      const url = await uiPrompt('ใส่ลิงก์โพสต์บน Facebook ไว้ดูภายหลังก็ได้ (เว้นว่างได้) แล้วกด “ทำเครื่องหมายว่าโพสต์แล้ว”',
        { title: 'โพสต์แล้ว', ok: 'ทำเครื่องหมายว่าโพสต์แล้ว', placeholder: 'https://www.facebook.com/…' });
      if (url === null) return; // ยกเลิก
      await api('POST', `/api/clips/${c.id}/posted`, { fb_url: url });
    }
    await refresh();
  }));

  // ปุ่มใหม่ของการ์ดแบบ "ปุ่มหลักปุ่มเดียวตามขั้น"
  refs.btnMeta = h('a', { class: 'btn sm', href: 'https://www.meta.ai/', target: '_blank', rel: 'noopener noreferrer', textContent: '↗ เปิด meta.ai', title: 'แผง Arn Reels บน meta.ai (โหมด 🛍 คลิปสินค้า) วาง prompt + แนบรูปให้ คุณกดสร้างเอง' });
  refs.btnPost = h('button', { class: 'btn sm', type: 'button', textContent: '📤 โพสต์ลงเพจ' });
  refs.btnPost.addEventListener('click', () => openPostPanel(c.id));
  refs.fbLink = h('a', { class: 'btn sm', target: '_blank', rel: 'noopener noreferrer', textContent: '↗ ดูโพสต์' });
  refs.btnSave = action('💾 บันทึก', async () => { await save(); toast('บันทึกแล้ว'); });
  refs.btnCaption = action('✨ AI แคปชัน', async () => { await save(); await api('POST', `/api/clips/${c.id}/caption`); });
  const doRender = async () => {
    // มีวิดีโออยู่แล้ว → เรนเดอร์ใหม่จะทับไฟล์เดิม (และล้างสถานะ "โพสต์แล้ว") ถามก่อน
    const now = await api('GET', `/api/clips/${c.id}`);
    if (now.video_file && now.kind !== 'photo' && !(await uiConfirm(`เรนเดอร์ใหม่จะทับวิดีโอเดิมของ “${now.title}”${now.status === 'posted' ? ' และล้างสถานะ “โพสต์แล้ว”' : ''}?`, { title: 'เรนเดอร์ใหม่', ok: 'เรนเดอร์ทับ' }))) return;
    await save();
    if (c.kind === 'product') { await finishProduct(c.id); await refresh(); return; }
    if (c.kind === 'photo') { await makePhotoFile(await api('GET', `/api/clips/${c.id}`)); await refresh(); return; }
    await renderInBrowser(c.id); // ปุ่มแสดง ⏳ กำลังอัดคลิป · NN% ผ่านระบบ task เอง (กด ✕ หยุด ที่การ์ดได้)
    await refresh();
  };
  refs.btnRender = h('button', { class: 'btn sm', type: 'button', textContent: '🎞 เรนเดอร์ใหม่' });
  refs.btnRender.addEventListener('click', () => guard(refs.btnRender, doRender));
  // คลิปร่างที่ยังไม่มีวิดีโอ (เช่น หยุดเรนเดอร์กลางคัน) — ปุ่มเรนเดอร์ต้องเห็นเลย ไม่ต้องกดแก้ไขก่อน
  refs.btnRenderNow = h('button', { class: 'btn sm primary', type: 'button', textContent: '🎞 เรนเดอร์คลิป' });
  refs.btnRenderNow.addEventListener('click', () => guard(refs.btnRenderNow, doRender));
  refs.btnDel = action('🗑 ลบ', async () => {
    if (!(await uiConfirm(`ลบคลิป “${refs.title.textContent}” ?\n(รวมไฟล์วิดีโอ ลบแล้วกู้คืนไม่ได้)`, { title: 'ลบคลิป', ok: 'ลบ', danger: true }))) return;
    await api('DELETE', `/api/clips/${c.id}`);
  }, 'danger');

  fillMusic(refs.music, c.music);
  fillTone(refs.tone, c.narr_tone);
  refs.editBody = h('div', { class: 'edit-body', hidden: true },
    h('label', {}, h('span', { class: 'cap-label', textContent: 'ชื่อคลิป (แก้แล้วกด “💾 บันทึก”)' }), refs.titleIn),
    h('label', {}, h('span', { class: 'cap-label', textContent: 'ป้ายมุมคลิป' }), refs.badgeIn),
    h('label', {}, h('span', { class: 'cap-label', textContent: 'แคปชัน' }), refs.caption),
    h('label', {}, h('span', { class: 'cap-label', textContent: 'แฮชแท็ก' }), refs.tags),
    h('label', {}, h('span', { class: 'cap-label', textContent: 'ข้อความบนจอ (บรรทัดละ 1 จอ)' }), refs.script),
    h('div', { class: 'audio-row' },
      h('label', {}, refs.voice, '🎙 เสียงพากย์ไทย'),
      h('label', {}, refs.tone),
      h('label', {}, '🎵 เพลง', refs.music),
      h('label', { class: 'len-line' }, '⏱ ความยาวเป้าหมาย', refs.len, 'วินาที')),
    h('div', { class: 'actions' }, refs.btnSave, refs.btnRender, refs.btnCaption));

  refs.btnEdit = h('button', { class: 'btn sm ghost', type: 'button', textContent: '✎ แก้ไข', 'aria-expanded': 'false' });
  refs.btnEdit.addEventListener('click', () => {
    const open = refs.editBody.hidden;
    refs.editBody.hidden = !open;
    refs.btnEdit.textContent = open ? '▴ ซ่อน' : '✎ แก้ไข';
    refs.btnEdit.setAttribute('aria-expanded', String(open));
  });

  // แถวปุ่ม: [ปุ่มหลัก] [ปุ่มรอง] … [✎ แก้ไข] [⋯] — updateCard ย้ายปุ่มเข้า/ออกจากเมนูตามขั้นของคลิป
  refs.hint = h('div', { class: 'step-hint', hidden: true });
  refs.chans = h('div', { class: 'ch-chips', hidden: true, 'aria-label': 'สถานะแต่ละช่องทาง' });
  refs.main = h('div', { class: 'act-main' });
  refs.menuList = h('div', { class: 'more-list', role: 'menu' });
  refs.more = h('details', { class: 'card-more' }, h('summary', { class: 'btn sm ghost', title: 'คำสั่งอื่น', 'aria-label': 'คำสั่งอื่น', textContent: '⋯' }), refs.menuList);
  refs.menuList.addEventListener('click', (e) => { if (e.target.closest('button, a')) refs.more.open = false; });
  refs.actions = h('div', { class: 'actions' }, refs.main, h('span', { class: 'act-gap' }), refs.btnEdit, refs.more);
  entry.el = h('article', { class: 'item' },
    refs.thumb,
    h('div', { class: 'item-main' },
      h('div', { class: 'item-head' }, h('div', { class: 'item-titles' }, refs.title, refs.meta, refs.source), refs.badge),
      refs.snippet, refs.tagline,
      refs.chans, refs.hint, refs.actions,
      refs.err, refs.editBody));
  return entry;
}

// ---------- แผงโพสต์ลงเพจ (ทีละขั้น) ----------
let ppClip = null, ppCh = null;
let channels = [];
async function loadChannels() { channels = await api('GET', '/api/channels'); return channels; }
const chBadge = (ch) => h('span', { class: `ch-badge ${ch.kind}`, textContent: ch.kind === 'yt' ? 'YT' : 'FB' });
const postedOn = (c, chId) => (c.posts || []).some((p) => p.channel_id === chId);
const chFits = (ch, c) => (c.kind === 'photo' ? ch.kind === 'fb' : !ch.kinds || ch.kinds.split(',').includes(c.kind));
const ppMark = (k) => { const li = document.querySelector(`#pp2-steps li[data-k="${k}"]`); if (li) li.classList.add('done'); };
async function openPostPanel(id, channelId = null) {
  [ppClip] = await Promise.all([api('GET', `/api/clips/${id}`), loadChannels()]);
  if (ppClip.kind === 'photo') { // โพสต์รูป: เปิดหน้า "สร้างโพสต์" ของ Business Suite — แผง Arn Reels ในหน้านั้นแนบรูป + แคปชันให้
    window.open('https://business.facebook.com/latest/composer', '_blank', 'noopener');
    toast('เปิดหน้าสร้างโพสต์แล้ว — แผง Arn Reels มุมซ้ายล่าง: 📎 แนบรูป → ✍ วางแคปชัน');
    return;
  }
  const c = ppClip, isProd = c.kind === 'product';
  const act = channels.filter((x) => x.active);
  ppCh = act.find((x) => x.id === channelId) || act.find((x) => chFits(x, c) && !postedOn(c, x.id)) || act[0] || null;
  $('pp2-chs').replaceChildren(...act.map((x) => {
    const b = h('button', { type: 'button', class: 'pp2-ch', 'aria-pressed': String(x === ppCh) }, chBadge(x), `${x.name}${postedOn(c, x.id) ? ' ✓' : ''}`);
    b.addEventListener('click', () => openPostPanel(c.id, x.id));
    return b;
  }));
  $('pp2-chs').hidden = act.length < 2;
  const yt = ppCh && ppCh.kind === 'yt';
  $('pp2-steps').classList.toggle('yt', !!yt);
  $('pp2-cap-t').textContent = yt ? 'คัดลอกคำอธิบาย' : 'คัดลอกแคปชัน + แฮชแท็ก';
  $('pp2-yttext').textContent = ytTitle(c);
  $('pp2-up-t').textContent = yt ? 'อัปโหลด Shorts ที่ YouTube Studio' : `อัปโหลด Reels ที่เพจ ${ppCh ? ppCh.name : ''}`;
  $('pp2-open').textContent = yt ? '↗ เปิด YouTube Studio' : '↗ เปิด Meta Business Suite';
  $('pp2-open').href = yt ? 'https://studio.youtube.com/' : 'https://business.facebook.com/latest/home';
  $('pp2-up-h').textContent = yt ? 'Shorts กดลิงก์ในคำอธิบาย/คอมเมนต์ไม่ได้ — ใส่ลิงก์สินค้าไว้ที่หน้าช่องแทน' : 'แผง “🎬 Arn Reels · โพสต์” มุมซ้ายล่างช่วยแนบวิดีโอ + วางแคปชันให้ได้ (ส่วนเสริม v0.6)';
  $('pp2-done').textContent = ppCh ? `✅ โพสต์ลง ${ppCh.name} แล้ว` : '✅ โพสต์แล้ว';
  // เลขขั้นตามที่มองเห็น (YouTube มีขั้นชื่อคลิป / Facebook มีขั้นคอมเมนต์)
  [...$('pp2-steps').children].filter((li) => getComputedStyle(li).display !== 'none' && !li.hidden).forEach((li, i) => { li.querySelector('.dot').textContent = String(i + 1); });
  for (const li of document.querySelectorAll('#pp2-steps li')) li.classList.remove('done');
  $('pp2-sub').textContent = `${isProd ? '🛍 ' : ''}${c.title}${c.duration ? ` · ${Math.round(c.duration)} วิ` : ''}`;
  $('pp2-dl').href = `/media/${c.id}.mp4`;
  $('pp2-dl').download = `reel-${c.id}.mp4`;
  $('pp2-captext').textContent = ppText(c) || '(ยังไม่มีแคปชัน — กด ✎ แก้ไข → ✨ AI แคปชัน)';
  $('pp2-cmt-li').hidden = !isProd;
  $('pp2-cmttext').textContent = c.fb_comment || '(ยังไม่มีคอมเมนต์ — ⋯ → ✍ แคปชันสินค้า)';
  $('pp2-url').value = ((c.posts || []).find((p) => ppCh && p.channel_id === ppCh.id) || {}).url || '';
  $('pp2-url').placeholder = yt ? 'https://youtube.com/shorts/…' : 'https://www.facebook.com/…';
  $('pp2-msg').textContent = '';
  $('pp2-next').hidden = true;
  $('pp2-done').hidden = false;
  if (!$('postpanel').open) $('postpanel').showModal();
}
$('pp2-x').addEventListener('click', () => $('postpanel').close());
$('pp2-dl').addEventListener('click', () => ppMark('dl'));
$('pp2-open').addEventListener('click', () => ppMark('up'));
// ข้อความโพสต์ตามช่องทาง: Facebook = แคปชัน + แฮชแท็ก · YouTube = คำอธิบาย (+ บอกว่าลิงก์อยู่หน้าช่อง) + #Shorts
function ppText(c) {
  const cap = (c.caption || '').trim(), tags = (c.hashtags || '').trim();
  if (!ppCh || ppCh.kind !== 'yt') return [cap, tags].filter(Boolean).join('\n\n');
  const link = c.kind === 'product' ? 'ลิงก์สินค้าอยู่ที่หน้าช่อง (ลิงก์แอฟฟิลิเอต)' : '';
  return [cap, link, [tags, /#shorts/i.test(tags) ? '' : '#Shorts'].filter(Boolean).join(' ')].filter(Boolean).join('\n\n');
}
function ytTitle(c) {
  const t = `${(c.title || '').trim()} #Shorts`;
  return t.length <= 100 ? t : `${t.slice(0, 92).trim()}… #Shorts`;
}
$('pp2-ytt').addEventListener('click', async () => { if (await copyText(ytTitle(ppClip))) { ppMark('yttitle'); toast('คัดลอกชื่อคลิปแล้ว'); } else toast('คัดลอกไม่ได้', true); });
$('pp2-cap').addEventListener('click', async () => {
  const t = ppText(ppClip);
  if (!t) return toast('ยังไม่มีแคปชัน', true);
  if (await copyText(t)) { ppMark('cap'); toast('คัดลอกแคปชันแล้ว'); } else toast('คัดลอกไม่ได้', true);
});
$('pp2-cmt').addEventListener('click', async () => {
  if (!ppClip.fb_comment) return toast('ยังไม่มีคอมเมนต์', true);
  if (await copyText(ppClip.fb_comment)) { ppMark('cmt'); toast('คัดลอกคอมเมนต์แล้ว'); } else toast('คัดลอกไม่ได้', true);
});
$('pp2-done').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  ppClip = await api('POST', `/api/clips/${ppClip.id}/posted`, { fb_url: $('pp2-url').value.trim(), channel_id: ppCh ? ppCh.id : undefined });
  ppMark('url');
  // ถัดไป: ช่องทางอื่นที่คลิปนี้ยังไม่ได้ลง (ตรงชนิดคลิป) → ไม่มีแล้วค่อยคลิปพร้อมโพสต์ถัดไป
  const otherCh = channels.find((x) => x.active && chFits(x, ppClip) && !postedOn(ppClip, x.id));
  const left = await api('GET', '/api/clips?status=ready&sort=old&limit=1');
  $('pp2-msg').textContent = `บันทึกว่าโพสต์ลง ${ppCh ? ppCh.name : 'เพจ'} แล้ว ✓`;
  $('pp2-done').hidden = true;
  if (otherCh) { $('pp2-next').hidden = false; $('pp2-next').textContent = `ต่อ: โพสต์ลง ${otherCh.name} →`; $('pp2-next').dataset.id = String(ppClip.id); $('pp2-next').dataset.ch = String(otherCh.id); }
  else { $('pp2-next').hidden = !left.total; $('pp2-next').textContent = `คลิปถัดไป (${left.total}) →`; $('pp2-next').dataset.id = left.items[0] ? String(left.items[0].id) : ''; $('pp2-next').dataset.ch = ''; }
  await refresh();
}, (err) => { $('pp2-msg').textContent = err.message; }));
$('pp2-next').addEventListener('click', (e) => guard(e.currentTarget, () => openPostPanel(Number($('pp2-next').dataset.id), Number($('pp2-next').dataset.ch) || null)));

// ขยายคลิปเร็ว → โปรเจกต์เรื่องหลายช็อต: สร้างโปรเจกต์ใหม่ตั้งต้นจากคลิป แล้วเปิดหน้าโปรเจกต์เรื่อง
async function expandToStory(id) {
  const c = await api('GET', `/api/clips/${id}`);
  if (!(await uiConfirm(`สร้างโปรเจกต์เรื่องใหม่จาก “${c.title}” ? จะเอาชื่อและเนื้อหาไปตั้งต้น แล้วให้คุณแบ่งช็อต/สร้างรูปทีละช็อต (คลิปเดิมไม่เปลี่ยน)`, { title: 'ขยายเป็นเรื่อง', ok: 'สร้างโปรเจกต์เรื่อง' }))) return;
  const premise = [c.brief, c.script, c.badge ? `(ป้าย: ${c.badge})` : ''].map((s) => (s || '').trim()).filter(Boolean).join('\n\n').slice(0, 29000);
  const p = await api('POST', '/api/story/projects', { title: c.title, premise, media: 'image', generator: 'flow' });
  toast('สร้างโปรเจกต์เรื่องแล้ว — แบ่งช็อตและสร้างรูปทีละช็อตได้เลย');
  if (window.openStoryProject) await window.openStoryProject(p.id);
}

function fmt(ts) { return new Date(ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }); }

function updateCard(entry, c) {
  const { refs } = entry;
  const busy = c.status === 'rendering';
  refs.title.textContent = c.title;
  if (document.activeElement !== refs.titleIn) refs.titleIn.value = c.title;
  if (document.activeElement !== refs.badgeIn) refs.badgeIn.value = c.badge || '';
  const st = stageOf(c);
  refs.badge.textContent = st.label;
  refs.badge.className = `badge ${st.cls}`;
  refs.err.textContent = c.error || '';
  // ที่มาของข่าว: ลิงก์ในข้อความกดได้ (สร้างด้วย DOM ไม่ใช้ innerHTML กัน XSS)
  // ที่มา: แสดงชื่อเว็บสั้น ๆ (สูงสุด 2 + จำนวนที่เหลือ) ลิงก์เต็มอยู่ใน title
  refs.source.replaceChildren();
  if (c.source) {
    const links = c.source.match(/https?:\/\/\S+/g) || [];
    refs.source.append('ที่มา: ');
    if (!links.length) refs.source.append(c.source);
    links.slice(0, 2).forEach((u, i) => {
      if (i) refs.source.append(', ');
      refs.source.append(h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', title: u, textContent: hostOf(u).replace(/^www\./, '') }));
    });
    if (links.length > 2) refs.source.append(h('span', { title: links.slice(2).join('\n'), textContent: ` +${links.length - 2}` }));
  }
  refs.source.hidden = !c.source;
  refs.meta.textContent = [
    c.duration ? `${Math.round(c.duration)} วิ` : '',
    c.posted_at ? `โพสต์ ${fmt(c.posted_at)}` : `สร้าง ${fmt(c.created_at)}`,
  ].filter(Boolean).join(' · ');

  // อย่าทับช่องที่ผู้ใช้กำลังแก้อยู่
  for (const [key, field] of [['script', refs.script], ['caption', refs.caption], ['hashtags', refs.tags]]) {
    if (document.activeElement !== field) field.value = c[key] || '';
  }
  refs.showText();
  if (document.activeElement !== refs.len) refs.len.value = c.target_sec || '';
  if (document.activeElement !== refs.voice) refs.voice.checked = !!c.voice;
  refs.voice.disabled = !status.tts && !c.voice;
  if (document.activeElement !== refs.tone) refs.tone.value = [...refs.tone.options].some((o) => o.value === c.narr_tone) ? c.narr_tone : 'plain';
  if (document.activeElement !== refs.music) refs.music.value = [...refs.music.options].some((o) => o.value === c.music) ? c.music : 'none';

  // หน้าปก: เปลี่ยนรูปเฉพาะเมื่อไฟล์คลิปเปลี่ยน
  const isPhoto = c.kind === 'photo';
  entry.photo = isPhoto;
  const want = busy ? null : (isPhoto ? c.photo_file || null : c.video_file || null);
  entry.videoFile = want;
  const key = want ? `${c.id}:${want}` : '';
  if (entry.thumbKey !== key) {
    entry.thumbKey = key;
    if (want) {
      refs.ph.hidden = true;
      refs.img.hidden = false;
      refs.img.src = `/thumb/${c.id}.jpg?v=${encodeURIComponent(want)}`;
    } else {
      refs.img.hidden = true;
      refs.img.removeAttribute('src');
      refs.ph.hidden = false;
      refs.ph.textContent = busy ? 'กำลังเรนเดอร์…' : isPhoto ? 'ยังไม่มีรูป' : 'ยังไม่มีคลิป';
    }
  }
  refs.thumb.disabled = !want;
  refs.play.hidden = !want || isPhoto;
  refs.dur.hidden = !want || !c.duration;
  refs.dur.textContent = c.duration ? `${Math.round(c.duration)}″` : '';

  refs.btnRender.disabled = busy;
  const isProd = c.kind === 'product';
  entry.fbComment = c.fb_comment || '';
  refs.btnRenderNow.hidden = (isPhoto ? !!c.photo_file : !!c.video_file) || busy || (isProd && !c.raw_video);
  refs.btnRenderNow.textContent = isPhoto ? '🖼 ทำรูปโพสต์' : isProd ? '🎞 ใส่ข้อความ + ทำคลิปเสร็จ' : '🎞 เรนเดอร์คลิป';
  refs.btnRender.textContent = isPhoto ? '🖼 ทำรูปใหม่' : '🎞 เรนเดอร์ใหม่';
  refs.btnRaw.hidden = !isProd || busy;
  refs.btnRaw.textContent = c.raw_video ? '📎 เปลี่ยนวิดีโอ Meta AI' : '📎 แนบวิดีโอ Meta AI';
  refs.btnCopyCmt.hidden = !(isProd || (isPhoto && c.fb_comment));
  refs.btnPPost.hidden = !isProd;
  refs.btnExpand.hidden = isProd || isPhoto;
  refs.btnProducts.hidden = isProd || isPhoto; // คลิปสินค้าผูกสินค้าไว้แล้ว
  if (isPhoto) { refs.btnRaw.hidden = true; refs.btnPPost.hidden = true; refs.btnPrompts.hidden = true; refs.btnImg.hidden = true; }
  refs.hint.hidden = !(isProd && !c.raw_video && !c.video_file && !busy);
  refs.hint.textContent = 'ขั้นต่อไป: เปิด meta.ai → แผง Arn Reels (🛍 คลิปสินค้า) วาง prompt + แนบรูปให้ → คุณกดสร้างเอง → “ส่งเข้า Arn Reels” (หรือแนบวิดีโอเอง)';
  refs.btnCaption.disabled = busy;
  refs.btnDel.disabled = busy;
  refs.btnPosted.disabled = !(isPhoto ? c.photo_file : c.video_file) || busy;
  refs.btnPosted.dataset.posted = c.status === 'posted' ? '1' : '';
  refs.btnPosted.textContent = c.status === 'posted' ? '↩ ยังไม่ได้โพสต์' : '✅ โพสต์แล้ว';
  if (isPhoto && c.photo_file && !busy) {
    refs.download.hidden = false;
    refs.download.href = `/photo/${c.photo_file}`;
    refs.download.download = `post-${c.id}.jpg`;
    refs.download.textContent = '⬇ ดาวน์โหลดรูป';
  } else if (c.video_file && !busy) {
    refs.download.hidden = false;
    refs.download.href = `/media/${c.id}.mp4`;
    refs.download.download = `reel-${c.id}${c.video_file.endsWith('.webm') ? '.webm' : '.mp4'}`;
    refs.download.textContent = '⬇ ดาวน์โหลดวิดีโอ';
  } else {
    refs.download.hidden = true;
  }
  // ช่องทางที่ลงแล้ว (✓) / ยังไม่ลง (○) — แสดงเมื่อคลิปมีวิดีโอแล้ว
  const fit = channels.filter((x) => x.active && chFits(x, c));
  refs.chans.hidden = !(isPhoto ? c.photo_file : c.video_file) || !fit.length;
  refs.chans.replaceChildren(...fit.map((x) => h('span', { class: `ch-chip${postedOn(c, x.id) ? ' on' : ''}`, title: postedOn(c, x.id) ? 'โพสต์แล้ว' : 'ยังไม่ได้โพสต์' }, `${postedOn(c, x.id) ? '✓' : '○'} ${x.kind === 'yt' ? 'YouTube' : 'FB'} ${x.name}`)));
  if (st.key === 'posted') {
    const n = fit.filter((x) => postedOn(c, x.id)).length;
    if (fit.length > 1) refs.badge.textContent = `โพสต์แล้ว ${n}/${fit.length}`;
  }
  refs.fbLink.hidden = !c.fb_url;
  if (c.fb_url) refs.fbLink.href = c.fb_url;
  arrangeActions(entry, c, st);
  entry.stamp = c.updated_at;
}

// ขั้นของคลิป (ใช้ทั้งป้ายบนการ์ด ตัวกรอง และหน้าวันนี้) — คลิปสินค้าแยก "รอวิดีโอ Meta AI" กับ "รอใส่ข้อความ" ออกจาก "ร่าง"
function stageOf(c) {
  if (c.status === 'rendering') return { key: 'rendering', label: 'กำลังทำคลิป…', cls: 'rendering' };
  if (c.status === 'failed') return { key: 'failed', label: 'ล้มเหลว', cls: 'failed' };
  if (c.status === 'posted') return { key: 'posted', label: 'โพสต์แล้ว', cls: 'posted' };
  if (c.kind === 'photo') return c.photo_file ? { key: 'ready', label: 'โพสต์รูป · พร้อมโพสต์', cls: 'ready' } : { key: 'draft', label: 'โพสต์รูป · รอทำรูป', cls: 'draft' };
  if (c.video_file) return { key: 'ready', label: 'พร้อมโพสต์', cls: 'ready' };
  if (c.kind === 'product') return c.raw_video ? { key: 'text', label: 'รอใส่ข้อความ', cls: 'text' } : { key: 'wait', label: 'รอวิดีโอ Meta AI', cls: 'wait' };
  return { key: 'draft', label: 'ร่าง', cls: 'draft' };
}

// ปุ่มหลัก 1 ปุ่ม (สีม่วง) + ปุ่มรอง 1 ปุ่มตามขั้น ที่เหลือเข้าเมนู ⋯
function arrangeActions(entry, c, st) {
  const r = entry.refs;
  const isProd = c.kind === 'product';
  let primary = null, secondary = null;
  if (st.key === 'wait') { primary = r.btnMeta; secondary = r.btnRaw; }
  else if (st.key === 'text') { primary = r.btnRenderNow; secondary = r.btnRaw; }
  else if (st.key === 'draft' || (st.key === 'failed' && !c.video_file)) { primary = r.btnRenderNow; secondary = null; }
  else if (st.key === 'ready' || (st.key === 'failed' && c.video_file)) { primary = r.btnPost; secondary = r.download; }
  else if (st.key === 'posted') {
    const missing = channels.filter((x) => x.active && chFits(x, c) && !postedOn(c, x.id)).length;
    if (missing) { primary = r.btnPost; r.btnPost.textContent = `📤 โพสต์ช่องทางที่เหลือ (${missing})`; secondary = c.fb_url ? r.fbLink : r.download; }
    else { primary = c.fb_url ? r.fbLink : null; secondary = r.download; }
  }
  if (st.key !== 'posted') r.btnPost.textContent = '📤 โพสต์';
  for (const b of [r.btnRenderNow, r.btnRaw, r.btnMeta, r.btnPost, r.download, r.fbLink, r.btnCopyAll]) b.classList.remove('primary');
  if (primary) { primary.classList.add('primary'); primary.hidden = false; }
  r.main.replaceChildren(...[primary, secondary].filter(Boolean));
  // เมนู ⋯ : ทุกอย่างที่ไม่ได้อยู่บนแถวหลัก (ปุ่มที่ hidden ด้วยเงื่อนไขเดิมจะไม่แสดง)
  const menu = [r.btnCopyAll, r.btnCopyCap, r.btnCopyTags, r.btnCopyCmt, r.btnPPost, r.download, r.btnRaw, r.btnPrompts, r.btnImg, r.btnExpand, r.btnProducts, r.btnPosted, r.btnDel]
    .filter((b) => b !== primary && b !== secondary);
  r.menuList.replaceChildren(...menu);
  r.btnRenderNow.textContent = c.kind === 'photo' ? '🖼 ทำรูปโพสต์' : isProd ? '🎞 ใส่ข้อความ + ทำคลิปเสร็จ' : (st.key === 'failed' ? '↻ เรนเดอร์ใหม่' : '🎞 เรนเดอร์คลิป');
  if (st.key === 'failed' && !c.video_file) r.btnRenderNow.hidden = false;
}

// ---------- รายการ / ตัวกรอง ----------
let refreshSeq = 0;
async function refresh() {
  const seq = ++refreshSeq;
  const qs = new URLSearchParams({ sort, limit: String(limit) });
  if (filter) qs.set('status', filter);
  if (kind) qs.set('kind', kind);
  if (query) qs.set('q', query);
  const [{ items, total }, stats] = await Promise.all([api('GET', `/api/clips?${qs}`), api('GET', '/api/stats')]);
  if (seq !== refreshSeq) return; // มีคำขอใหม่กว่าแล้ว ทิ้งผลเก่า

  const seen = new Set();
  const grid = $('grid');
  items.forEach((c, i) => {
    seen.add(c.id);
    let entry = cards.get(c.id);
    if (!entry) { entry = buildCard(c); cards.set(c.id, entry); }
    if (entry.stamp !== c.updated_at) updateCard(entry, c);
    if (grid.children[i] !== entry.el) grid.insertBefore(entry.el, grid.children[i] || null);
  });
  for (const [id, entry] of cards) {
    if (!seen.has(id)) { entry.el.remove(); cards.delete(id); }
  }

  for (const b of $('filter').children) b.querySelector('.n').textContent = stats[b.dataset.v || 'all'] ?? 0;
  $('b-clear-posted').hidden = !stats.posted;
  $('b-clear-posted').textContent = `🗑 ล้างที่โพสต์แล้ว (${fmtNum(stats.posted || 0)})`;
  $('count').textContent = total ? `(${total})` : '';
  const filtered = !!(filter || query || kind);
  $('empty').hidden = total > 0;
  $('empty-t').textContent = filtered ? 'ไม่พบคลิปที่ตรงกับตัวกรอง' : 'ยังไม่มีคลิปในคลัง';
  $('empty-s').textContent = filtered ? 'ลองเปลี่ยนคำค้นหรือสถานะ' : 'เริ่มจากทางซ้าย: วางรูปหรือพิมพ์เนื้อหา แล้วกด “สร้างคลิป”';
  $('clear-filter').hidden = !filtered;
  $('more').hidden = items.length >= total;
  $('more').textContent = `โหลดเพิ่ม (แสดง ${items.length} จาก ${total})`;
  schedulePoll(items.some((c) => c.status === 'rendering'));
  $('tab-count').textContent = stats.all ? fmtNum(stats.all) : '';
  if (view === 'today') renderToday().catch(() => {});
}

let pollTimer = null;
function schedulePoll(active) {
  clearTimeout(pollTimer);
  if (active) pollTimer = setTimeout(() => refresh().catch(() => schedulePoll(true)), 1500);
}

function resetPage() { limit = PAGE; }
let searchTimer = null;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { query = $('q').value.trim(); resetPage(); refresh().catch((e) => toast(e.message, true)); }, 250);
});
$('sort').addEventListener('change', () => { sort = $('sort').value; resetPage(); refresh(); });
$('filter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  filter = b.dataset.v;
  for (const x of $('filter').children) x.setAttribute('aria-pressed', String(x === b));
  resetPage();
  refresh();
});
$('kindfilter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  kind = b.dataset.k;
  for (const x of $('kindfilter').children) x.setAttribute('aria-pressed', String(x === b));
  resetPage();
  refresh();
});
$('more').addEventListener('click', (e) => guard(e.currentTarget, async () => { limit += PAGE; await refresh(); }));
$('b-clear-posted').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const n = (await api('GET', '/api/stats')).posted || 0;
  if (!n) return toast('ไม่มีคลิปที่โพสต์แล้ว');
  if (!(await uiConfirm(`ลบคลิปที่ทำเครื่องหมาย “โพสต์แล้ว” ทั้งหมด ${n} คลิป ออกจากคลัง?\n(รวมไฟล์วิดีโอและหน้าปก ลบแล้วกู้คืนไม่ได้ — คลิปที่ยังไม่โพสต์ไม่ถูกลบ)`, { title: 'ล้างคลิปที่โพสต์แล้ว', ok: `ลบ ${n} คลิป`, danger: true }))) return;
  const r = await api('POST', '/api/clips/clear-posted');
  toast(`ลบคลิปที่โพสต์แล้ว ${fmtNum(r.removed)} คลิป`);
  await refresh();
}));
$('clear-filter').addEventListener('click', () => {
  filter = ''; query = ''; kind = ''; $('q').value = '';
  for (const x of $('filter').children) x.setAttribute('aria-pressed', String(x.dataset.v === ''));
  for (const x of $('kindfilter').children) x.setAttribute('aria-pressed', String(x.dataset.k === ''));
  resetPage();
  refresh();
});

// ---------- สถานะ / สตูดิโอ ----------
// ป้ายที่ไม่พร้อม (สีแดง) กดแล้วเปิดหน้าตั้งค่าได้เลย
function chip(ok, text) {
  if (ok) return h('span', { class: 'chip ok', textContent: text });
  const b = h('button', { class: 'chip bad', type: 'button', textContent: text, title: 'เปิดตั้งค่า' });
  b.addEventListener('click', () => guard(b, openSettings));
  return b;
}

async function loadStatus() {
  status = await api('GET', '/api/status');
  const mime = ReelRender.pickMime();
  const chipList = [
    [!!mime, mime ? `เรนเดอร์ (${mime.split(';')[0].replace('video/', '')})` : 'เรนเดอร์ไม่ได้'],
    [!!status.ai, status.ai ? `AI พร้อม (${status.aiProvider === 'cli' ? 'Claude Code' : 'API'})` : (status.aiProvider === 'cli' ? 'ยังไม่ล็อกอิน Claude Code' : 'ยังไม่มีคีย์ AI')],
    [!!status.tts, status.tts ? `พากย์ (${{ google: 'Google', gemini: 'Gemini' }[status.ttsProvider] || 'Windows'})` : 'พากย์ไม่พร้อม'],
  ];
  const bad = chipList.filter(([ok]) => !ok);
  const one = bad.length ? bad.map(([ok, t]) => chip(ok, t)) : [chip(true, 'ระบบพร้อม')];
  if (!bad.length) one[0].title = chipList.map(([, t]) => t).join(' · ');
  $('chips').replaceChildren(...one);
  buildThemes();
  fillMusic($('f-music'), $('f-music').value || 'mystic');
  fillTone($('f-tone'), $('f-tone').value || 'plain');
  $('f-voice').disabled = !status.tts;
  if (!status.tts) $('f-voice').checked = false;
  $('voice-note').textContent = status.tts
    ? 'อ่านข้อความทีละฉาก'
    : 'ไม่พร้อมใช้งาน — เปิด “ตั้งค่า” เพื่อเลือกแหล่งเสียง';
  for (const entry of cards.values()) entry.stamp = 0; // ให้แถวอัปเดตสถานะเสียงใหม่ตอน refresh
}

function setTheme(id) {
  theme = id;
  for (const el of $('themes').children) el.setAttribute('aria-checked', String(el.dataset.id === theme));
}

function buildThemes() {
  const box = $('themes');
  if (box.children.length) return;
  if (status.brand?.theme) theme = status.brand.theme; // ธีมสีตั้งต้นตามโทนประจำเพจ
  for (const t of status.themes) {
    const art = h('div', { class: 'art', textContent: 'Aa' });
    art.style.background = `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})`;
    art.style.color = t.accent;
    const b = h('button', { class: 'swatch', type: 'button', role: 'radio', title: t.label },
      art, h('div', { class: 'name', textContent: t.label }));
    b.dataset.id = t.id;
    b.setAttribute('aria-checked', String(t.id === theme));
    b.addEventListener('click', () => {
      theme = t.id;
      for (const el of box.children) el.setAttribute('aria-checked', String(el.dataset.id === theme));
    });
    box.append(b);
  }
}

// ---------- รูปประกอบจากเว็บ ----------
// imSel = รูปที่เลือกไว้ใช้เป็นพื้นหลังฉาก (เรียงตามลำดับ → ฉากที่ 1, 2, … วนซ้ำ) — ไฟล์ถูกดาวน์โหลดเก็บในเครื่องแล้ว
let imSel = [];
const autoImgOn = () => $('im-auto').checked;
try { $('im-auto').checked = localStorage.getItem('reels.autoimg') !== '0'; } catch { $('im-auto').checked = true; }
$('im-auto').addEventListener('change', () => { try { localStorage.setItem('reels.autoimg', autoImgOn() ? '1' : '0'); } catch { /* ไม่เก็บค่า */ } });
const urlsIn = (s) => [...new Set((String(s || '').match(/https?:\/\/[^\s<>"']+/g) || []).map(cleanLink))].slice(0, 3);

function renderImSel() {
  $('im-count').textContent = imSel.length ? `· เลือกแล้ว ${imSel.length} รูป` : '';
  $('im-sel').replaceChildren(...imSel.map((p, i) => {
    const b = h('button', { class: 'im-th on', type: 'button', title: 'คลิกเพื่อเอาออก' }, h('img', { src: `/clip-images/${p.file}`, alt: '' }), h('span', { class: 'no', textContent: String(i + 1) }), h('span', { class: 'x', textContent: '✕' }));
    b.addEventListener('click', () => { imSel.splice(i, 1); renderImSel(); paintGrid(); });
    return b;
  }));
}
function setImages(list) { imSel = list.slice(0, 8); renderImSel(); paintGrid(); }

// ดึงรูปจากลิงก์ที่มาอัตโนมัติ (พลาด = ข้าม ไม่ทำให้งานหลักล้ม) — คืนรายการรูป [{file, credit, src}]
async function autoImages(urls) {
  if (!autoImgOn() || !urls.length) return [];
  try { return (await api('POST', '/api/images/auto', { urls, max: 5 }, { quiet: true })).images; } catch (e) { toast(`ดึงรูปจากที่มาไม่ได้ (${e.message}) — ใช้พื้นหลังธีมแทน`, true); return []; }
}

let imCands = [], imPage = '';
function paintGrid() {
  $('im-grid').replaceChildren(...imCands.map((c) => {
    const picked = imSel.some((p) => p.src === c.url);
    const b = h('button', { class: `im-th${picked ? ' on' : ''}`, type: 'button', title: c.alt || c.url },
      h('img', { src: `/api/images/proxy?u=${encodeURIComponent(c.url)}&ref=${encodeURIComponent(imPage)}`, alt: '', loading: 'lazy' }));
    if (picked) b.append(h('span', { class: 'no', textContent: String(imSel.findIndex((p) => p.src === c.url) + 1) }));
    b.addEventListener('click', () => guard(b, async () => {
      const at = imSel.findIndex((p) => p.src === c.url);
      if (at >= 0) { imSel.splice(at, 1); } else {
        if (imSel.length >= 8) throw new Error('เลือกได้สูงสุด 8 รูป');
        imSel.push(await api('POST', '/api/images/pick', { url: c.url, ref: imPage }));
      }
      renderImSel(); paintGrid();
    }, (e) => { $('im-msg').textContent = e.message; }));
    return b;
  }));
}
$('im').addEventListener('toggle', () => { if ($('im').open && !$('im-url').value) $('im-url').value = urlsIn($('f-source').value)[0] || ''; });
$('im-go').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  $('im-msg').textContent = '';
  const r = await api('POST', '/api/images/search', { url: $('im-url').value });
  imCands = r.images; imPage = r.page; paintGrid();
  $('im-msg').textContent = `พบ ${r.images.length} รูปจาก ${r.host} — คลิกรูปที่ต้องการ (เรียงตามลำดับที่คลิก)`;
}, (e) => { $('im-msg').textContent = e.message; }));

// เว็บสร้างรูป (แคตตาล็อกร่วมกับโปรเจกต์เรื่อง จาก generators.js) — จำค่าที่เลือกไว้ในเครื่อง
const imgenGen = () => $('imgen-gen').value || 'flow';
(function initImgenGen() {
  const sel = $('imgen-gen');
  sel.replaceChildren(...window.ARN_GEN_IMAGE.map((k) => new Option(window.ARN_GEN[k].name, k)));
  try { sel.value = localStorage.getItem('reels.imgen') || 'flow'; } catch { sel.value = 'flow'; }
  if (!sel.value) sel.value = 'flow';
  const paint = () => {
    const g = window.ARN_GEN[imgenGen()];
    const a = $('imgen-open'); a.textContent = `↗ เปิด ${g.short}`; a.href = g.url;
    $('imgen-tip').textContent = g.tip('9:16', 'image');
  };
  sel.addEventListener('change', () => { try { localStorage.setItem('reels.imgen', sel.value); } catch { /* ไม่เก็บ */ } paint(); });
  paint();
})();
// สร้างรูปเอง: อัปโหลดไฟล์รูปที่สร้างจากเว็บที่เลือก → เป็นพื้นหลังฉาก (เรียงตามชื่อไฟล์)
$('imgen-up').addEventListener('click', () => $('imgen-file').click());
$('imgen-file').addEventListener('change', (e) => guard($('imgen-up'), async () => {
  const files = [...e.target.files].sort((a, b) => new Intl.Collator('en', { numeric: true }).compare(a.name, b.name));
  e.target.value = '';
  if (!files.length) return;
  const byExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  let n = 0;
  for (const f of files) {
    if (imSel.length >= 8) { toast('ใช้พื้นหลังได้สูงสุด 8 รูป — ส่วนที่เหลือไม่ได้ใช้', true); break; }
    const type = f.type || byExt[(/\.(\w+)$/.exec(f.name) || [])[1]?.toLowerCase()] || '';
    if (!byExt[type.split('/')[1]] && !['image/png', 'image/jpeg', 'image/webp'].includes(type)) { $('imgen-msg').textContent = `ข้าม ${f.name} (ไม่ใช่ png/jpg/webp)`; continue; }
    $('imgen-msg').textContent = `กำลังอัปโหลด ${n + 1}/${files.length}…`;
    const res = await fetch('/api/images/upload', { method: 'PUT', headers: { 'content-type': type }, body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { $('imgen-msg').textContent = `${f.name}: ${data.error || res.status}`; continue; }
    imSel.push(data); n++;
  }
  renderImSel(); paintGrid();
  $('imgen-count').textContent = imSel.length ? `· เลือกแล้ว ${imSel.length} รูป` : '';
  $('imgen-msg').textContent = n ? `อัปโหลดแล้ว ${n} รูป — เป็นพื้นหลังฉากเรียงตามลำดับ` : $('imgen-msg').textContent;
}, (err) => { $('imgen-msg').textContent = err.message; }));
// คิด prompt รูปจากเนื้อหา (สร้างคลิปร่างชั่วคราวเพื่อเรียก AI แล้วลบทิ้ง) → คัดลอกไปสร้างรูปที่ Flow/ChatGPT/Meta
$('imgen-prompt').addEventListener('click', (ev) => guard(ev.currentTarget, async () => {
  const d = formData();
  if (!d.title.trim() && !d.brief.trim() && !d.script.trim()) throw new Error('ใส่เนื้อหาหรือสคริปต์ก่อน');
  const clip = await api('POST', '/api/clips', { ...d, title: d.title.trim() || 'ร่าง prompt รูป (ชั่วคราว)' }); // เซิร์ฟเวอร์บังคับต้องมีชื่อ — ร่างนี้ถูกลบทันทีหลังได้ prompt
  try {
    const r = await api('POST', `/api/clips/${clip.id}/image-prompts`, { single: true });
    let prompts = [];
    try { prompts = JSON.parse(r.image_prompts || '[]'); } catch { /* ข้อมูลเสีย */ }
    const text = prompts.map((p, i) => `${prompts.length > 1 ? `รูป ${i + 1}: ` : ''}${(p.prompt || '').trim()}, ${$('ip-ratio')?.value || '9:16'}.`).filter((s) => s.trim().length > 3).join('\n\n') || 'ไม่ได้ prompt';
    const ta = $('imgen-pt'); ta.value = text; ta.hidden = false;
    if (await copyText(text)) $('imgen-msg').textContent = `คัดลอก prompt แล้ว — เปิด ${window.ARN_GEN[imgenGen()].short} แล้ววางสร้างรูป เสร็จแล้วกดอัปโหลด`;
    else $('imgen-msg').textContent = 'คิด prompt เสร็จ — เลือกข้อความแล้ว Ctrl+C';
  } finally { await api('DELETE', `/api/clips/${clip.id}`); }
}, (e) => { $('imgen-msg').textContent = e.message; }));

function formData() {
  return {
    images: imSel.map(({ file, credit, src }) => ({ file, credit, src })), badge: $('f-badge').value,
    title: $('f-title').value, brief: $('f-brief').value, script: $('f-script').value, theme,
    voice: $('f-voice').checked, narr_tone: $('f-tone').value, music: $('f-music').value, target_sec: targetSec(),
    caption: $('f-caption').value, hashtags: $('f-tags').value, source: $('f-source').value,
  };
}

// ล้างฟอร์มสตูดิโอหลังบันทึก (สไตล์/เสียง/ความยาว คงค่าเดิมไว้ให้คลิปถัดไป)
function clearForm() {
  for (const id of ['f-title', 'f-brief', 'f-script', 'f-caption', 'f-tags', 'f-source', 'f-badge']) $(id).value = '';
  imCands = []; $('im-grid').replaceChildren(); $('im-msg').textContent = ''; setImages([]);
  $('drop-preview').hidden = true;
  $('facts').hidden = true;
  newsImage = '';
}

// ความยาวคลิป: ปุ่มสำเร็จรูป ↔ ช่องกรอกเอง (ว่าง/0 = อัตโนมัติ)
function targetSec() {
  const n = Math.round(Number($('f-len').value));
  return n >= 5 && n <= 90 ? n : 0;
}
function syncLenPresets() {
  const n = $('f-len').value ? Number($('f-len').value) : 0;
  for (const b of $('len-presets').children) b.setAttribute('aria-pressed', String(Number(b.dataset.s) === n));
}
$('len-presets').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-s]');
  if (!b) return;
  $('f-len').value = b.dataset.s === '0' ? '' : b.dataset.s;
  syncLenPresets();
});
$('f-len').addEventListener('input', syncLenPresets);

// รูป → ย่อเหลือ ≤1600px เป็น JPEG แล้วให้ AI อ่านเนื้อหา (ไม่เก็บรูปไว้ที่ไหน)
function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้')); };
    img.src = url;
  });
}

let newsImage = ''; // โหมดข่าว: รูปแคปข่าวที่วางไว้ (ส่งให้ AI เรียบเรียงตอนกดปุ่ม)

async function readImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const dataUrl = await toDataUrl(file);
    $('drop-preview').src = dataUrl;
    $('drop-preview').hidden = false;
    if ($('studio').dataset.mode === 'news') {
      newsImage = dataUrl;
      say('วางรูปข่าวแล้ว — ใส่แหล่งที่มา แล้วกด “เรียบเรียงข่าว”');
      return;
    }
    say('กำลังให้ AI อ่านเนื้อหาจากรูป…');
    busyStack.push(drop); // ให้ความคืบหน้าไปเกาะที่กล่องวางรูปเอง
    let r;
    try { r = await api('POST', '/api/extract', { image: dataUrl, target_sec: targetSec() }); } finally { busyStack.splice(busyStack.lastIndexOf(drop), 1); }
    $('f-title').value = r.title;
    $('f-brief').value = r.brief;
    $('f-script').value = r.script;
    say('อ่านรูปเสร็จแล้ว — ตรวจข้อความบนจอ เลือกสไตล์ แล้วกด “สร้างคลิป”');
  } catch (e) { say(e.message); }
}

const drop = $('drop');
drop.addEventListener('click', () => $('f-image').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('f-image').click(); } });
$('f-image').addEventListener('change', (e) => { readImage(e.target.files[0]); e.target.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readImage(e.dataTransfer.files[0]); });
document.addEventListener('paste', (e) => {
  if (e.target.closest?.('dialog')) return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); readImage(f); }
});

// คีย์เวิร์ด → AI ค้นเว็บ → ใส่ชื่อ/เนื้อหา(พร้อมแหล่งอ้างอิง)/สคริปต์ลงฟอร์ม — ผู้ใช้ตรวจแก้ก่อนสร้างคลิป
$('b-research').addEventListener('click', (ev) => guard(ev.currentTarget, async () => {
  const topic = $('f-kw').value.trim();
  if (!topic) throw new Error('ใส่คีย์เวิร์ดหรือหัวข้อก่อน');
  if ($('f-brief').value.trim() && !(await uiConfirm('ช่องเนื้อหามีข้อความอยู่แล้ว — เขียนทับด้วยผลค้นความรู้?', { title: 'ค้นความรู้', ok: 'เขียนทับ' }))) return;
  const r = await api('POST', '/api/knowledge', { topic, target_sec: targetSec() });
  $('f-title').value = r.title;
  $('f-brief').value = r.brief;
  $('f-script').value = r.script;
  const found = await autoImages(r.sources); // รูปจริงจากแหล่งอ้างอิงที่ค้นเจอ
  if (found.length) setImages(found);
  $('f-source').value = r.sources.reduce((s, u) => (s ? `${s} ${u}` : u).length <= 300 ? (s ? `${s} ${u}` : u) : s, ''); // ใส่ทีละลิงก์เท่าที่ไม่เกิน 300 ตัวอักษร ไม่ตัดลิงก์กลางคัน
  const note = $('kn-note');
  note.textContent = `ค้นเจอ ${r.sources.length} แหล่ง — ตรวจข้อเท็จจริงกับลิงก์ในช่องเนื้อหาก่อนโพสต์${r.caution ? ` · ⚠ ${r.caution}` : ''}`;
  note.hidden = false;
  say('ค้นความรู้เสร็จแล้ว — ตรวจข้อความบนจอ เลือกสไตล์ แล้วกด “สร้างคลิป”');
}, (e) => { $('kn-note').textContent = e.message; $('kn-note').hidden = false; }));

$('b-ai-script').addEventListener('click', (ev) => guard(ev.target, async () => {
  const d = formData();
  if (!d.title.trim() || !d.brief.trim()) throw new Error('ใส่ชื่อและเนื้อหาก่อน');
  say('กำลังให้ AI เขียนสคริปต์…');
  const clip = await api('POST', '/api/clips', d); // ร่างชั่วคราวเพื่อเรียก AI แล้วลบทิ้ง ไม่ทิ้งขยะในคลัง
  try {
    $('f-script').value = (await api('POST', `/api/clips/${clip.id}/script`)).script;
    say('');
  } finally { await api('DELETE', `/api/clips/${clip.id}`); }
}, (e) => say(e.message)));

// ---------- คลังสินค้าแอฟฟิลิเอต ----------
// เก็บลิงก์สินค้าที่ผู้ใช้มี (Shopee ฯลฯ) พร้อมแท็ก/โน้ต/ยอดขาย (ผู้ใส่เอง) — แถวคลิปกด "🛍 แนะนำสินค้า" ให้ AI เลือกให้
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };
const fmtNum = (n) => Number(n).toLocaleString('en-US');

// คลังอาจมีหลายพันรายการ: โหลดทีละ 50 (ปุ่ม "โหลดเพิ่ม") ค้นหา/เรียงที่เซิร์ฟเวอร์
const PD_PAGE = 50;
let pdLimit = PD_PAGE;
let pdTotal = 0;

async function loadProducts() {
  const q = $('pd-q').value.trim();
  const shop = $('pd-shop').value;
  const { items, total } = await api('GET', `/api/products?sort=${$('pd-sort').value}&limit=${pdLimit}${q ? `&q=${encodeURIComponent(q)}` : ''}${shop ? `&shop=${encodeURIComponent(shop)}` : ''}`);
  $('pd-list').replaceChildren(...items.map(productItem));
  pdTotal = total;
  $('pd-empty').hidden = total > 0;
  $('pd-count').textContent = total ? `แสดง ${items.length} จาก ${fmtNum(total)} รายการ` : '';
  $('pd-more').hidden = items.length >= total;
  $('pd-more').textContent = `โหลดเพิ่ม (แสดง ${items.length} จาก ${fmtNum(total)})`;
}

function productItem(p) {
  const li = h('li', { class: 'pd-item' });
  const view = h('div', { class: 'pd-view' });
  const edit = h('div', { class: 'pd-edit', hidden: true });
  const f = {
    name: h('input', { value: p.name, maxLength: 150, placeholder: 'ชื่อสินค้า' }),
    url: h('input', { value: p.url, maxLength: 500, type: 'url', placeholder: 'ลิงก์' }),
    tags: h('input', { value: p.tags, maxLength: 200, placeholder: 'แท็ก' }),
    note: h('input', { value: p.note, maxLength: 300, placeholder: 'โน้ต' }),
    sales: h('input', { value: p.sales || '', type: 'number', min: 0, step: 1, placeholder: 'ยอดขาย' }),
    brand: h('input', { value: p.brand || '', maxLength: 80, placeholder: 'แบรนด์ (คลิปสินค้า)' }),
    clip_name: h('input', { value: p.clip_name || '', maxLength: 60, placeholder: 'ชื่อในคลิป สั้น ๆ เช่น ครีมกันแดดสูตรเย็น' }),
    say: h('input', { value: p.say || '', maxLength: 120, placeholder: 'คำอ่าน (ถ้าอ่านยาก) เช่น ลา-โรช-โพเซย์' }),
  };
  const copy = h('button', { class: 'btn sm', type: 'button', textContent: '📋 คัดลอกลิงก์' });
  copy.addEventListener('click', async () => {
    if (!(await copyText(p.url))) return toast('คัดลอกไม่ได้', true);
    copy.textContent = 'คัดลอกแล้ว ✓';
    setTimeout(() => { copy.textContent = '📋 คัดลอกลิงก์'; }, 1500);
  });
  const editBtn = h('button', { class: 'btn sm ghost', type: 'button', textContent: '✎ แก้ไข' });
  editBtn.addEventListener('click', () => { view.hidden = true; edit.hidden = false; li.classList.add('editing'); });
  const delBtn = h('button', { class: 'btn sm danger', type: 'button', textContent: '🗑 ลบ' });
  delBtn.addEventListener('click', () => guard(delBtn, async () => {
    if (!(await uiConfirm(`ลบสินค้า “${p.name}” ออกจากคลังสินค้า?`, { title: 'ลบสินค้า', ok: 'ลบ', danger: true }))) return;
    await api('DELETE', `/api/products/${p.id}`);
    await loadProducts();
  }));
  view.append(
    h('div', { class: 'nm', textContent: p.name }),
    ...(p.tags ? [h('div', { class: 'tg', textContent: p.tags })] : []),
    ...(p.shop ? [h('button', { class: 'linkbtn pd-shop', type: 'button', textContent: `🏪 ${p.shop}`, title: 'ดูเฉพาะสินค้าร้านนี้', onclick: () => pdPickShop(p.shop) })] : []),
    ...(p.note ? [h('div', { class: 'nt', textContent: p.note })] : []),
    h('div', { class: 'lk', textContent: `${hostOf(p.url)}${p.sales ? ` · ยอดขาย ${fmtNum(p.sales)}` : ''}` }),
    h('div', { class: 'row' }, copy, editBtn, delBtn));
  const save = h('button', { class: 'btn sm primary', type: 'button', textContent: 'บันทึก' });
  save.addEventListener('click', () => guard(save, async () => {
    await api('PATCH', `/api/products/${p.id}`, { name: f.name.value, url: f.url.value, tags: f.tags.value, note: f.note.value, sales: f.sales.value, brand: f.brand.value, clip_name: f.clip_name.value, say: f.say.value });
    await loadProducts();
  }, (e) => { $('pd-msg').textContent = e.message; }));
  const cancel = h('button', { class: 'btn sm ghost', type: 'button', textContent: 'ยกเลิก' });
  cancel.addEventListener('click', () => { edit.hidden = true; view.hidden = false; li.classList.remove('editing'); });
  edit.append(f.name, f.url, f.tags, f.note, f.sales, f.brand, f.clip_name, f.say, h('div', { class: 'row' }, save, cancel));
  // คลิปสินค้า: ติ๊กเลือก + รูปสินค้าจริง (กดเพื่ออัปโหลด/เปลี่ยน) + ข้อมูลที่จะเติมลง prompt
  const pick = h('input', { type: 'checkbox', class: 'pc-pick', checked: pcSel.has(p.id), title: 'เลือกทำคลิปสินค้า' });
  pick.dataset.id = String(p.id);
  pick.addEventListener('change', () => { if (pick.checked) pcSel.add(p.id); else pcSel.delete(p.id); pcUpdateSel(); });
  const imgBtn = h('button', { class: 'pc-img', type: 'button', title: p.image ? 'เปลี่ยนรูปสินค้า' : 'อัปโหลดรูปสินค้าจริง (ใช้แนบให้ Meta AI)' });
  if (p.image) imgBtn.append(h('img', { src: `/clip-images/${p.image}`, alt: '' })); else imgBtn.textContent = '📷 รูปสินค้า';
  imgBtn.addEventListener('click', () => guard(imgBtn, async () => {
    const file = await pickImageFile();
    if (!file) return;
    const up = await uploadImageFile(file);
    await api('PATCH', `/api/products/${p.id}`, { image: up.file });
    await loadProducts();
  }, (e) => { $('pd-msg').textContent = e.message; }));
  const promptBtn = h('button', { class: 'btn sm ghost', type: 'button', textContent: '📋 prompt Meta AI', title: 'คัดลอก prompt ของสินค้านี้ (เติมข้อมูลแล้ว)' });
  promptBtn.addEventListener('click', () => guard(promptBtn, async () => {
    const r = await api('GET', `/api/product-clips/preview/${p.id}`);
    if (!(await copyText(r.prompt))) throw new Error('คัดลอกไม่ได้');
    toast(`คัดลอก prompt แล้ว (ชื่อในคลิป: ${r.clip_name})`);
  }, (e) => { $('pd-msg').textContent = e.message; }));
  view.querySelector('.row').append(promptBtn);
  if (p.brand || p.clip_name || p.say) view.insertBefore(h('div', { class: 'pc-meta', textContent: [p.brand && `แบรนด์: ${p.brand}`, p.clip_name && `ชื่อในคลิป: ${p.clip_name}`, p.say && `คำอ่าน: ${p.say}`].filter(Boolean).join(' · ') }), view.querySelector('.row'));
  li.classList.add('pc-has');
  li.append(pick, imgBtn, h('div', {}, view, edit));
  return li;
}

// เปิดแท็บสินค้า (เรียกจาก setView)
const openProducts = () => guard($('b-products'), async () => {
  $('pd-msg').textContent = ''; $('pc-msg').textContent = '';
  pdLimit = PD_PAGE;
  pfRecent();
  pfGo(pfStep);
  await Promise.all([loadProducts(), pcLoad(), loadShops()]);
  if (!pdTotal) pfGo(1);
}, (err) => { $('pd-msg').textContent = err.message; });

// ---- 3 ขั้น: ① หาสินค้า ② เลือกสินค้า ③ ทำคลิป ----
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ไม่มีที่เก็บ ก็ไม่เป็นไร */ } };
let pfStep = Number(lsGet('pfStep', '1')) || 1;
function pfGo(n) {
  pfStep = Math.min(3, Math.max(1, n));
  lsSet('pfStep', String(pfStep));
  for (const b of document.querySelectorAll('#products .pf-step')) {
    const k = Number(b.dataset.step);
    b.setAttribute('aria-selected', String(k === pfStep));
    b.classList.toggle('done', k < pfStep);
  }
  for (const pane of document.querySelectorAll('#products .pf-pane')) pane.hidden = Number(pane.dataset.pane) !== pfStep;
  $('pf-back').hidden = pfStep === 1;
  $('pf-next').hidden = pfStep === 3;
  $('pf-next').textContent = pfStep === 1 ? 'มีสินค้าในคลังแล้ว → ไปเลือก' : (pcSel.size ? `ไปทำคลิป (${fmtNum(pcSel.size)} ชิ้น) →` : 'ไปทำคลิป →');
  $('pf-next').disabled = pfStep === 2 && !pcSel.size;
  window.scrollTo({ top: 0 });
}
for (const b of document.querySelectorAll('#products .pf-step')) b.addEventListener('click', () => pfGo(Number(b.dataset.step)));
for (const b of document.querySelectorAll('#products [data-goto]')) b.addEventListener('click', () => pfGo(Number(b.dataset.goto)));
$('pf-back').addEventListener('click', () => pfGo(pfStep - 1));
$('pf-next').addEventListener('click', () => pfGo(pfStep + 1));
$('pd-reload').addEventListener('click', (e) => guard(e.currentTarget, loadProducts, (err) => { $('pd-msg').textContent = err.message; }));

// คีย์เวิร์ด → เปิดเว็บ Shopee Affiliate (หน้า ข้อเสนอผลิตภัณฑ์) พร้อมส่งคีย์เวิร์ดให้แผงของส่วนเสริมทาง #arn_kw=…
const SHOPEE_OFFER = 'https://affiliate.shopee.co.th/offer/product_offer';
const pfRecentList = () => { try { return JSON.parse(lsGet('pfRecent', '[]')).filter((x) => typeof x === 'string').slice(0, 6); } catch { return []; } };
function pfRecent() {
  const list = pfRecentList();
  if (!$('pf-kw').value) $('pf-kw').value = list[0] || 'ของใช้ในบ้าน';
  $('pf-recent').replaceChildren(...list.map((k) => {
    const c = h('button', { type: 'button', class: 'pf-chip', textContent: k });
    c.addEventListener('click', () => { $('pf-kw').value = k; $('pf-kw').focus(); });
    return c;
  }));
}
let pfWaitFrom = null; // จำนวนในคลังตอนออกไปหาที่ Shopee — กลับมาแล้วเพิ่มขึ้น = พาไปขั้น 2
let pfBy = lsGet('pfBy', 'kw') === 'shop' ? 'shop' : 'kw';
function pfSetBy(by) {
  pfBy = by; lsSet('pfBy', by);
  for (const b of document.querySelectorAll('.pf-by [data-by]')) b.setAttribute('aria-pressed', String(b.dataset.by === by));
  $('pf-kw-l').textContent = by === 'shop' ? 'พิมพ์ชื่อร้านค้าที่จะให้หาใน Shopee' : 'พิมพ์คีย์เวิร์ดที่จะให้หาใน Shopee';
  $('pf-kw').placeholder = by === 'shop' ? 'เช่น GUCUT, Xiaomi, Lock&Lock' : 'เช่น ของใช้ในบ้าน, ครีมกันแดด, กระเป๋า';
  $('pf-shop-note').hidden = by !== 'shop';
  $('pf-go').textContent = by === 'shop' ? '🏪 หาร้านใน Shopee' : '🔎 หาใน Shopee';
}
for (const b of document.querySelectorAll('.pf-by [data-by]')) b.addEventListener('click', () => { pfSetBy(b.dataset.by); $('pf-kw').value = ''; $('pf-kw').focus(); });
pfSetBy(pfBy);
const SHOPEE_SHOPS = 'https://affiliate.shopee.co.th/offer/brand_offer';
$('pf-go').addEventListener('click', async () => {
  const kw = $('pf-kw').value.trim();
  if (pfBy === 'shop') {
    if (!kw) { $('pf-kw').focus(); $('pd-msg').textContent = 'พิมพ์ชื่อร้านก่อน เช่น GUCUT'; return; }
    copyText(kw).catch(() => {});
    window.open(`${SHOPEE_SHOPS}#arn_kw=${encodeURIComponent(kw)}&arn_shop=1&arn_n=${$('pf-n').value}`, '_blank', 'noopener');
    pfWaitFrom = pdTotal;
    $('pd-msg').textContent = `เปิดข้อเสนอร้านค้าแล้ว — แผง Arn Reels หาร้าน “${kw}” และดึงสินค้าให้ ติ๊กแล้วกด “เพิ่มเข้า Arn Reels” แล้วกลับมาหน้านี้`;
    return;
  }
  if (!kw) { $('pf-kw').focus(); $('pd-msg').textContent = 'พิมพ์คีย์เวิร์ดก่อน เช่น ของใช้ในบ้าน'; return; }
  lsSet('pfRecent', JSON.stringify([kw, ...pfRecentList().filter((x) => x !== kw)].slice(0, 6)));
  pfRecent();
  copyText(kw).catch(() => {}); // สำรอง: ถ้าแผงไม่ได้รับคีย์เวิร์ด วางเองได้ด้วย Ctrl+V
  window.open(`${SHOPEE_OFFER}#arn_kw=${encodeURIComponent(kw)}&arn_n=${$('pf-n').value}`, '_blank', 'noopener');
  pfWaitFrom = pdTotal;
  $('pd-msg').textContent = `เปิด Shopee Affiliate แล้ว — ค้น “${kw}” ในแผง Arn Reels มุมขวาล่าง (คัดลอกคีย์เวิร์ดไว้ให้ด้วย) เพิ่มเสร็จแล้วกลับมาหน้านี้`;
});
$('pf-kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('pf-go').click(); } });
window.addEventListener('focus', () => {
  if (view !== 'products' || pfWaitFrom === null) return;
  loadProducts().then(() => {
    if (pdTotal > pfWaitFrom) {
      $('pd-msg').textContent = `มีสินค้าใหม่เข้าคลัง ${fmtNum(pdTotal - pfWaitFrom)} ชิ้น — ติ๊กเลือกแล้วไปทำคลิปได้เลย`;
      pfWaitFrom = null;
      pdLimit = PD_PAGE;
      $('pd-sort').value = 'new';
      loadShops().then(loadProducts).then(() => pfGo(2)).catch(() => {});
    }
  }).catch(() => {});
});

let pdTimer = null;
$('pd-q').addEventListener('input', () => { clearTimeout(pdTimer); pdTimer = setTimeout(() => { pdLimit = PD_PAGE; loadProducts().catch((e) => { $('pd-msg').textContent = e.message; }); }, 250); });
$('pd-sort').addEventListener('change', () => { pdLimit = PD_PAGE; loadProducts(); });
// เลือกสินค้าจากร้านค้า: ตัวเลือกร้าน (ร้านที่มีในคลัง + จำนวน)
async function loadShops() {
  const shops = await api('GET', '/api/products/shops');
  const cur = $('pd-shop').value;
  $('pd-shop').replaceChildren(h('option', { value: '', textContent: `🏪 ทุกร้าน${shops.length ? ` (${shops.length} ร้าน)` : ''}` }), ...shops.map((x) => h('option', { value: x.shop, textContent: `${x.shop} (${fmtNum(x.n)})` })));
  $('pd-shop').value = shops.some((x) => x.shop === cur) ? cur : '';
  return shops;
}
function pdPickShop(name) {
  if (![...$('pd-shop').options].some((o) => o.value === name)) $('pd-shop').append(h('option', { value: name, textContent: name }));
  $('pd-shop').value = name; pdLimit = PD_PAGE; loadProducts();
}
$('pd-shop').addEventListener('change', () => { pdLimit = PD_PAGE; loadProducts(); });
$('pd-more').addEventListener('click', (e) => guard(e.currentTarget, async () => { pdLimit += PD_PAGE; await loadProducts(); }));

// ---- คลิปสินค้า (Meta AI) ----
const pcSel = new Set(); // id สินค้าที่ติ๊กไว้ (คงอยู่ข้ามการค้นหา/โหลดเพิ่ม)
function pcUpdateSel() {
  $('pc-sel').textContent = pcSel.size ? `เลือก ${fmtNum(pcSel.size)} สินค้า` : 'ยังไม่ได้เลือกสินค้า';
  $('pc-sel3').textContent = pcSel.size ? `เลือกไว้ ${fmtNum(pcSel.size)} สินค้า` : 'ยังไม่ได้เลือกสินค้า — กลับไปขั้น 2';
  $('pf-sel-badge').textContent = pcSel.size ? `(${fmtNum(pcSel.size)})` : '';
  if (typeof view !== 'undefined' && view === 'products') { $('pf-next').disabled = pfStep === 2 && !pcSel.size; if (pfStep === 2) $('pf-next').textContent = pcSel.size ? `ไปทำคลิป (${fmtNum(pcSel.size)} ชิ้น) →` : 'ไปทำคลิป →'; }
  $('pc-go').disabled = !pcSel.size;
  $('pc-go').textContent = pcSel.size ? `🎬 สร้างคลิปสินค้า (${fmtNum(pcSel.size)})` : '🎬 สร้างคลิปสินค้า';
}
function pickImageFile() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
    inp.addEventListener('change', () => resolve(inp.files[0] || null));
    inp.click();
  });
}
async function uploadImageFile(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('รองรับเฉพาะรูป png/jpg/webp');
  const res = await fetch('/api/images/upload', { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
let pcCfg = null;
async function pcLoad() {
  pcCfg = await api('GET', '/api/product-clips/settings');
  $('pc-overlay').checked = !!pcCfg.overlay;
  if (document.activeElement !== $('pc-tpl')) $('pc-tpl').value = pcCfg.template;
  $('pc-typo-img').hidden = !pcCfg.typoRef; $('pc-typo-del').hidden = !pcCfg.typoRef;
  if (pcCfg.typoRef) $('pc-typo-img').src = `/clip-images/${pcCfg.typoRef}`;
  const q = pcCfg.queue;
  $('pc-queue').textContent = q.waiting ? `(รอ ${fmtNum(q.waiting)})` : '';
  $('pc-queue').title = q.total ? `รอทำบน meta.ai ${fmtNum(q.waiting)} · ได้วิดีโอแล้ว ${fmtNum(q.done)}` : '';
  if (!$('pc-music').options.length) fillMusic($('pc-music'), 'none');
  pcUpdateSel();
}
$('pc-all').addEventListener('click', () => { for (const c of $('pd-list').querySelectorAll('.pc-pick')) { c.checked = true; pcSel.add(Number(c.dataset.id)); } pcUpdateSel(); });
$('pc-none').addEventListener('click', () => { pcSel.clear(); for (const c of $('pd-list').querySelectorAll('.pc-pick')) c.checked = false; pcUpdateSel(); });
$('pc-go').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const r = await api('POST', '/api/product-clips', { product_ids: [...pcSel], music: $('pc-music').value });
  pcSel.clear();
  for (const c of $('pd-list').querySelectorAll('.pc-pick')) c.checked = false;
  $('pc-msg').textContent = `สร้างคลิปสินค้า ${fmtNum(r.created)} รายการเข้าคิวแล้ว (รอทำบน meta.ai ${fmtNum(r.queue)})`
    + (r.noImage.length ? ` · ⚠ ยังไม่มีรูปสินค้า ${r.noImage.length} ชิ้น — Meta AI จะไม่มีภาพอ้างอิง: ${r.noImage.slice(0, 3).join(', ')}${r.noImage.length > 3 ? '…' : ''}` : '');
  await pcLoad();
  kind = 'product'; for (const x of $('kindfilter').children) x.setAttribute('aria-pressed', String(x.dataset.k === 'product'));
  resetPage(); await refresh();
  toast('เข้าคิวแล้ว — เปิด meta.ai แล้วใช้แผง Arn Reels โหมด “🛍 คลิปสินค้า”');
}, (err) => { $('pc-msg').textContent = err.message; }));
$('pc-save').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  await api('PUT', '/api/product-clips/settings', { template: $('pc-tpl').value, overlay: $('pc-overlay').checked });
  await pcLoad(); toast('บันทึกตั้งค่าคลิปสินค้าแล้ว');
}, (err) => { $('pc-msg').textContent = err.message; }));
$('pc-overlay').addEventListener('change', () => api('PUT', '/api/product-clips/settings', { overlay: $('pc-overlay').checked }).then(pcLoad).catch((err) => { $('pc-msg').textContent = err.message; }));
$('pc-reset').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  if (!(await uiConfirm('คืนค่าเทมเพลต prompt เป็น V4.0 ตั้งต้น? (ที่แก้ไว้จะหาย)', { title: 'คืนค่าเทมเพลต', ok: 'คืนค่า' }))) return;
  await api('PUT', '/api/product-clips/settings', { template: '' });
  $('pc-tpl').value = ''; await pcLoad();
}));
$('pc-typo-up').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const f = await pickImageFile(); if (!f) return;
  const up = await uploadImageFile(f);
  await api('PUT', '/api/product-clips/settings', { typoRef: up.file });
  await pcLoad();
}, (err) => { $('pc-msg').textContent = err.message; }));
$('pc-typo-del').addEventListener('click', (e) => guard(e.currentTarget, async () => { await api('PUT', '/api/product-clips/settings', { typoRef: '' }); await pcLoad(); }));

// ---- ดึงจากแอป Pondy บนมือถือ ----
let ppSerial = '';
function ppBody() {
  return { serial: ppSerial, q: $('pp-q').value, days: Number($('pp-days').value) || 0, limit: Number($('pp-limit').value) || 300 };
}
$('pp-scan').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const tid = task.start('กำลังตรวจมือถือ', null, 'กำลังตรวจ');
  let devs;
  try { devs = await api('GET', '/api/pondy/devices'); } finally { task.end(tid); }
  ppSerial = '';
  $('pp-opts').hidden = true;
  $('pp-info').textContent = '';
  $('pp-devs').replaceChildren(...(devs.length ? devs.map((d) => {
    const ok = d.hasApp && d.readable;
    const radio = h('input', { type: 'radio', name: 'pp-dev', value: d.serial, disabled: !ok });
    radio.addEventListener('change', () => { ppSerial = d.serial; $('pp-opts').hidden = false; $('pp-info').textContent = ''; $('pp-pick').hidden = true; });
    const why = d.state !== 'device' ? `สถานะ: ${d.state}` : !d.hasApp ? 'ไม่พบแอป Pondy' : !d.readable ? 'อ่านฐานข้อมูลไม่ได้ (แอปไม่ใช่ debug build)' : 'พร้อมอ่าน';
    const last = d.lastPostedAt ? ` · โพสต์ล่าสุด ${new Date(d.lastPostedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}${d.lastKeyword ? ` (คีย์เวิร์ด: ${d.lastKeyword})` : ''}` : '';
    const posted = d.posted != null ? ` · โพสต์แล้ว ${fmtNum(d.posted)} คลิป` : '';
    return h('label', { class: `pp-dev${ok ? '' : ' off'}` }, radio,
      h('span', {}, `${d.model || 'มือถือ'} `, h('small', { textContent: `${d.serial} · ${why}${posted}${last}` })));
  }) : [h('p', { class: 'hint', textContent: 'ไม่พบมือถือที่ต่ออยู่ — เสียบสาย USB และเปิด USB debugging' })]));
}, (err) => { $('pd-msg').textContent = err.message; }));
// ดูรายการที่โพสต์ล่าสุดให้ติ๊กเลือก (เทียบกับวิดีโอบนโปรไฟล์ Shopee Video ของคุณ) แล้วนำเข้าเฉพาะที่ติ๊ก
function ppUpdateSel() {
  const n = $('pp-list').querySelectorAll('input:checked').length;
  $('pp-sel').textContent = `เลือก ${n} จาก ${$('pp-list').children.length}`;
  $('pp-import').disabled = !n;
}
$('pp-all').addEventListener('click', () => { for (const c of $('pp-list').querySelectorAll('input')) c.checked = true; ppUpdateSel(); });
$('pp-none').addEventListener('click', () => { for (const c of $('pp-list').querySelectorAll('input')) c.checked = false; ppUpdateSel(); });

// แสดงทีละ 10 (ค่าเริ่มต้น) ใหม่สุดอยู่บน — "แสดงเพิ่มอีก 10" ขยายรายการโดยคงที่ติ๊กไว้ (แถวที่เพิ่มมาใหม่ไม่ติ๊กให้)
async function ppPreview(more = false) {
  const keep = more ? new Set([...$('pp-list').querySelectorAll('input:checked')].map((c) => c.dataset.url)) : null;
  if (more) $('pp-limit').value = String((Number($('pp-limit').value) || 10) + 10);
  const r = await api('POST', '/api/pondy/preview', ppBody());
  $('pp-more').hidden = r.rows.length >= r.total;
  $('pp-more').textContent = `＋ แสดงเพิ่มอีก 10 (แสดง ${fmtNum(r.rows.length)} จาก ${fmtNum(r.total)})`;
  $('pp-info').textContent = `ตรงเงื่อนไข ${fmtNum(r.total)} สินค้า — แสดง ${fmtNum(r.rows.length)} รายการล่าสุด (ใหม่สุดอยู่บน) ติ๊กอันที่ต้องการแล้วกด “นำเข้าที่เลือก”`;
  $('pp-list').replaceChildren(...r.rows.map((x) => {
    const cb = h('input', { type: 'checkbox', checked: more ? keep.has(x.url) : true });
    cb.dataset.url = x.url;
    cb.addEventListener('change', ppUpdateSel);
    const when = new Date(x.last_posted).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
    return h('li', {}, h('label', { class: 'pp-row' }, cb, h('span', {}, x.name, h('small', { textContent: `${when}${x.keyword ? ` · คีย์เวิร์ด: ${x.keyword}` : ''}` }))));
  }));
  $('pp-pick').hidden = !r.rows.length;
  ppUpdateSel();
}
$('pp-preview').addEventListener('click', (e) => guard(e.currentTarget, () => ppPreview(false), (err) => { $('pp-info').textContent = err.message; }));
$('pp-more').addEventListener('click', (e) => guard(e.currentTarget, () => ppPreview(true), (err) => { $('pp-info').textContent = err.message; }));
$('pp-clear').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  if (!(await uiConfirm('ลบสินค้าที่นำเข้าจากมือถือทั้งหมดออกจากคลัง?\n(สินค้าที่คุณเพิ่มเองไม่ถูกลบ และข้อมูลบนมือถือไม่ถูกแตะ)', { title: 'ล้างที่นำเข้า', ok: 'ล้าง', danger: true }))) return;
  const r = await api('POST', '/api/products/clear-imported');
  $('pp-info').textContent = `ลบที่นำเข้าแล้ว ${fmtNum(r.removed)} รายการ`;
  pdLimit = PD_PAGE;
  await loadProducts();
}, (err) => { $('pp-info').textContent = err.message; }));
$('pp-import').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const urls = [...$('pp-list').querySelectorAll('input:checked')].map((c) => c.dataset.url);
  const r = await api('POST', '/api/pondy/import', { ...ppBody(), urls });
  $('pp-info').textContent = `นำเข้า ${fmtNum(r.added)} รายการ${r.duplicates ? ` · ซ้ำ ${fmtNum(r.duplicates)} (ข้าม)` : ''}`;
  $('pd-sort').value = 'posted';
  pdLimit = PD_PAGE;
  await loadProducts();
  toast(`นำเข้าสินค้าจากมือถือ ${fmtNum(r.added)} รายการแล้ว`);
}, (err) => { $('pp-info').textContent = err.message; }));
$('pd-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard($('pd-add'), async () => {
    await api('POST', '/api/products', { name: $('pd-name').value, url: $('pd-url').value, tags: $('pd-tags').value, note: $('pd-note').value, sales: $('pd-sales').value });
    $('pd-form').reset();
    $('pd-msg').textContent = 'เพิ่มสินค้าแล้ว ✓ — ไปขั้น 2 เพื่อเลือกทำคลิป';
    await loadProducts();
    $('pd-name').focus();
  }, (err) => { $('pd-msg').textContent = err.message; });
});
$('pd-bulk-go').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const r = await api('POST', '/api/products/import', { text: $('pd-bulk').value });
  $('pd-bulk').value = '';
  $('pd-msg').textContent = `นำเข้า ${r.added} รายการ${r.duplicates ? ` · ซ้ำ ${r.duplicates}` : ''}${r.skipped ? ` · ข้าม ${r.skipped} (ไม่มีลิงก์/ไม่ถูกต้อง)` : ''}`;
  await loadProducts();
}, (err) => { $('pd-msg').textContent = err.message; }));

// ---------- แนะนำสินค้าให้คลิป ----------
let rcClip = null;
const RC_KEY = 'arn-rc-devs'; // จำมือถือที่เลือกไว้ครั้งก่อน (ติ๊กไว้ให้ แต่ยังไม่เริ่มค้นจนกว่าจะกดปุ่ม)
const rcSaved = () => { try { return JSON.parse(localStorage.getItem(RC_KEY) || '[]'); } catch { return []; } };
const rcSelected = () => [...$('rc-devs').querySelectorAll('input:checked')].map((c) => c.value);

function rcSyncGen() {
  const n = rcSelected().length;
  $('rc-gen').disabled = !n;
  $('rc-browse-btn').disabled = !n;
  $('rc-gen-hint').textContent = n ? `จาก ${n} เครื่อง · เลือกเองจากรายการ หรือให้ AI เลือกอันที่เข้ากับคลิป` : 'เลือกมือถืออย่างน้อย 1 เครื่องก่อน';
}

// ---- เลือกเองจากรายการสินค้าที่ลงไว้ (ใหม่สุดก่อน ทีละ 10) — มีช่องชื่อลิงก์/URL พร้อมปุ่มคัดลอกไปวางใน Facebook ----
let rcBrowseLimit = 10;
function rcFilters() {
  return { serials: rcSelected(), days: Number($('rc-days').value) || 0, q: $('rc-q').value, short: $('rc-short').checked };
}

function rcProductCard(r) {
  const nameInput = h('input', { value: r.name.slice(0, 40), maxLength: 80 }); // ชื่อลิงก์บน Facebook: แก้ได้
  const kind = r.link_kind;
  return h('div', { class: 'rc-card' },
    h('div', { class: 'nm', textContent: r.name }),
    h('div', { class: 'why', textContent: `โพสต์ ${new Date(r.last_posted).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}${r.keyword ? ` · คีย์เวิร์ด: ${r.keyword}` : ''}` }),
    h('span', {
      class: `link-badge ${kind === 'plain' ? 'plain' : 'short'}`,
      textContent: kind === 'plain' ? '⚠ ลิงก์สินค้าธรรมดา — ไม่มีตัวติดตามแอฟฟิลิเอต อาจไม่ได้ค่าคอม' : '✓ ลิงก์สั้น/มีตัวติดตาม — ปกติเป็นลิงก์แอฟฟิลิเอต (ยืนยันว่าเป็นของบัญชีคุณไม่ได้)',
    }),
    rcField('ชื่อลิงก์', nameInput),
    rcField('URL', h('input', { value: r.url, readOnly: true })));
}

async function rcBrowse(more = false) {
  if (more) rcBrowseLimit += 10; else rcBrowseLimit = 10;
  const r = await api('POST', '/api/pondy/browse', { ...rcFilters(), limit: rcBrowseLimit });
  $('rc-browse').hidden = false;
  $('rc-list').replaceChildren();
  $('rc-empty').hidden = true;
  $('rc-browse-list').replaceChildren(...r.rows.map(rcProductCard));
  $('rc-browse-info').textContent = r.total
    ? `สินค้าที่ลงไว้ ${fmtNum(r.total)} รายการตามเงื่อนไข — แสดง ${fmtNum(r.rows.length)} รายการล่าสุด (ใหม่สุดอยู่บน) เลือกอันที่ต้องการแล้วกดคัดลอก “ชื่อลิงก์” และ “URL” ไปวางบน Facebook`
    : 'ไม่มีสินค้าที่ตรงเงื่อนไข — ลองเลือกช่วงเวลา “ทั้งหมด” เอาติ๊กลิงก์สั้นออก หรือล้างคำค้น';
  $('rc-browse-more').hidden = r.rows.length >= r.total;
  $('rc-browse-more').textContent = `＋ แสดงเพิ่มอีก 10 (แสดง ${fmtNum(r.rows.length)} จาก ${fmtNum(r.total)})`;
}

// ตรวจมือถือที่ต่ออยู่ → รายการให้ติ๊กเลือก (อ่านไม่ได้ = กดเลือกไม่ได้ พร้อมบอกเหตุผล)
async function rcLoadDevices() {
  $('rc-devs').replaceChildren(h('p', { class: 'hint', textContent: 'กำลังตรวจมือถือ…' }));
  $('rc-gen').disabled = true;
  try {
    const devs = await api('GET', '/api/pondy/devices');
    const saved = new Set(rcSaved());
    $('rc-devs').replaceChildren(...(devs.length ? devs.map((d) => {
      const ok = d.hasApp && d.readable;
      const cb = h('input', { type: 'checkbox', value: d.serial, disabled: !ok, checked: ok && saved.has(d.serial) });
      cb.addEventListener('change', rcSyncGen);
      const why = d.state !== 'device' ? `สถานะ: ${d.state}` : !d.hasApp ? 'ไม่พบแอป Pondy' : !d.readable ? 'อ่านข้อมูลไม่ได้' : 'พร้อมอ่าน';
      const posted = d.posted != null ? ` · โพสต์แล้ว ${fmtNum(d.posted)} คลิป` : '';
      const last = d.lastPostedAt ? ` · ล่าสุด ${new Date(d.lastPostedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}${d.lastKeyword ? ` (${d.lastKeyword})` : ''}` : '';
      return h('label', { class: `pp-dev${ok ? '' : ' off'}` }, cb, h('span', {}, `${d.model || 'มือถือ'} `, h('small', { textContent: `${d.serial} · ${why}${posted}${last}` })));
    }) : [h('p', { class: 'hint', textContent: 'ไม่พบมือถือที่ต่ออยู่ — เสียบสาย USB เปิด USB debugging แล้วกด “ตรวจมือถือใหม่”' })]));
  } catch (e) {
    $('rc-devs').replaceChildren(h('p', { class: 'err', textContent: e.message }));
  }
  rcSyncGen();
}

function rcField(label, control, extra) {
  const copy = h('button', { class: 'btn sm', type: 'button', textContent: '📋 คัดลอก' });
  copy.addEventListener('click', async () => {
    if (!(await copyText(control.value))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
    copy.textContent = 'คัดลอกแล้ว ✓';
    setTimeout(() => { copy.textContent = '📋 คัดลอก'; }, 1500);
  });
  return h('div', { class: 'rc-field' }, h('span', { textContent: label }), control, h('div', { class: 'row' }, copy, ...(extra ? [extra] : [])));
}

function renderRecs(r) {
  $('rc-list').replaceChildren(...r.picks.map((p) => {
    const append = h('button', { class: 'btn sm', type: 'button', textContent: '＋ ต่อท้ายแคปชัน' });
    const cta = h('textarea', { rows: 2, value: p.cta });
    append.addEventListener('click', () => guard(append, async () => {
      const cur = await api('GET', `/api/clips/${rcClip.id}`);
      if (cur.caption.includes(cta.value.trim())) return toast('แคปชันมีประโยคนี้อยู่แล้ว');
      await api('PATCH', `/api/clips/${rcClip.id}`, { caption: `${cur.caption.trim()}\n${cta.value.trim()}`.trim() });
      toast('ต่อท้ายแคปชันแล้ว ✓');
      await refresh();
    }));
    const kind = p.product.link_kind;
    return h('div', { class: 'rc-card' },
      h('div', { class: 'nm', textContent: p.product.name }),
      ...(kind ? [h('span', {
        class: `link-badge ${kind === 'plain' ? 'plain' : 'short'}`,
        textContent: kind === 'plain' ? '⚠ ลิงก์สินค้าธรรมดา — ไม่มีตัวติดตามแอฟฟิลิเอต อาจไม่ได้ค่าคอม' : '✓ ลิงก์สั้น/มีตัวติดตาม — ปกติเป็นลิงก์แอฟฟิลิเอต (ยืนยันว่าเป็นของบัญชีคุณไม่ได้)',
      })] : []),
      h('div', { class: 'why', textContent: p.reason }),
      rcField('ชื่อลิงก์', h('input', { value: p.link_name, maxLength: 80 })),
      rcField('URL', h('input', { value: p.product.url, readOnly: true })),
      rcField('ประโยคชวน', cta, append));
  }));
  const none = !r.picks.length;
  $('rc-empty').hidden = !none;
  $('rc-empty').textContent = r.message || 'ไม่มีสินค้าที่เหมาะกับคลิปนี้';
}

async function runRecs() {
  $('rc-msg').textContent = '';
  const serials = rcSelected();
  try { localStorage.setItem(RC_KEY, JSON.stringify(serials)); } catch { /* ไม่มี storage ก็ไม่จำ */ }
  try {
    renderRecs(await api('POST', `/api/clips/${rcClip.id}/products`, {
      mode: 'fit', source: 'phones', serials, days: Number($('rc-days').value) || 0, q: $('rc-q').value, short: $('rc-short').checked,
    }));
  } catch (e) {
    $('rc-list').replaceChildren();
    $('rc-empty').hidden = true;
    $('rc-msg').textContent = e.message;
  }
}

// เปิดหน้าต่าง: ยังไม่ค้น — ให้เลือกมือถือ/เงื่อนไขก่อน แล้วกด "ค้นหา"
async function openRecs(id) {
  rcClip = await api('GET', `/api/clips/${id}`);
  $('rc-sub').textContent = rcClip.title;
  $('rc-list').replaceChildren();
  $('rc-empty').hidden = true;
  $('rc-browse').hidden = true;
  $('rc-msg').textContent = '';
  $('recs').showModal();
  await rcLoadDevices();
}

$('rc-gen').addEventListener('click', (e) => { $('rc-browse').hidden = true; return guard(e.currentTarget, runRecs); });
$('rc-browse-btn').addEventListener('click', (e) => guard(e.currentTarget, () => rcBrowse(false), (err) => { $('rc-msg').textContent = err.message; }));
$('rc-browse-more').addEventListener('click', (e) => guard(e.currentTarget, () => rcBrowse(true), (err) => { $('rc-msg').textContent = err.message; }));
$('rc-rescan').addEventListener('click', (e) => guard(e.currentTarget, rcLoadDevices));
$('rc-x').addEventListener('click', () => $('recs').close());
$('rc-close').addEventListener('click', () => $('recs').close());

// ---------- โหมดข่าว ----------
// 1) วางข้อความ/รูปข่าว + แหล่งที่มา → AI เรียบเรียงใหม่ (ถ้อยคำใหม่ ข้อเท็จจริงเดิม ใส่ที่มา)
// 2) ฟีด RSS: เลือกข่าว → ดึงเนื้อบทความ → เรียบเรียง → บันทึกลงคลังเป็นร่าง รอผู้ใช้คัดลอกไปโพสต์เอง
$('mode').addEventListener('click', (e) => {
  if (e.target.closest('button[data-go="products"]')) { location.hash = 'products'; return; }
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  // "เรื่องหลายช็อต" เป็นเวิร์กสเปซของตัวเอง (โปรเจกต์ถาวร) → เปิดหน้าโปรเจกต์เรื่อง ไม่สลับฟอร์มคลิปเร็ว
  if (b.dataset.m === 'story') { window.openStory?.(); return; }
  $('studio').dataset.mode = b.dataset.m;
  for (const x of $('mode').querySelectorAll('button[data-m]')) x.setAttribute('aria-pressed', String(x === b && x.dataset.m !== 'story'));
  say('');
  if (b.dataset.m === 'news' && !feedsLoaded) loadFeeds().catch((err) => say(err.message));
});

function showFacts(facts) {
  $('facts-list').replaceChildren(...(facts || []).map((f) => h('li', { textContent: f })));
  $('facts').hidden = !facts?.length;
}

$('b-news').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const text = $('f-brief').value.trim();
  if (!text && !newsImage) throw new Error('วางข้อความข่าว หรือรูปแคปข่าวก่อน');
  say('กำลังให้ AI เรียบเรียงข่าว…');
  const r = await api('POST', '/api/news/rewrite', { text, image: text ? '' : newsImage, source: $('f-source').value, target_sec: targetSec() });
  $('f-title').value = r.title;
  $('f-script').value = r.script;
  $('f-caption').value = r.caption;
  $('f-tags').value = r.hashtags;
  if (!text && r.original) $('f-brief').value = r.original; // ข่าวมาเป็นรูป: เก็บข้อความที่ถอดไว้เป็นต้นฉบับ
  const found = await autoImages(urlsIn($('f-source').value)); // รูปจริงจากลิงก์ที่มา → พื้นหลังคลิป
  if (found.length) setImages(found);
  showFacts(r.facts);
  say('เรียบเรียงเสร็จแล้ว — ตรวจข้อความบนจอ/แคปชัน แล้วกด “สร้างคลิป” หรือ “บันทึกร่างลงคลัง”');
}, (err) => say(err.message)));

// หัวข้อข่าว (หรือชื่อคลิปถ้าเว้นว่าง) → AI ค้นข่าวล่าสุด → ใส่เนื้อข่าว + ที่มาลงฟอร์ม แล้วผู้ใช้กด "เรียบเรียงข่าว" ต่อ
$('b-findnews').addEventListener('click', (ev) => guard(ev.currentTarget, async () => {
  const topic = ($('f-newsq').value.trim() || $('f-title').value.trim());
  if (!topic) throw new Error('พิมพ์หัวข้อข่าว (หรือชื่อคลิป) ก่อน');
  if ($('f-brief').value.trim() && !(await uiConfirm('ช่องข้อความข่าวมีข้อความอยู่แล้ว — เขียนทับด้วยข่าวที่ค้นเจอ?', { title: 'ค้นข่าว', ok: 'เขียนทับ' }))) return;
  const note = $('nf-note');
  note.hidden = true;
  say('AI กำลังค้นข่าว… (อาจใช้ 1–3 นาที)');
  const r = await api('POST', '/api/news/find', { topic });
  if (!$('f-title').value.trim()) $('f-title').value = r.title;
  $('f-brief').value = r.text;
  // ที่มา: "สำนัก ลิงก์" ทีละแหล่ง เท่าที่ไม่เกิน 300 ตัวอักษร ไม่ตัดลิงก์กลางคัน
  $('f-source').value = r.sources.reduce((s, x) => { const add = `${x.outlet ? `${x.outlet} ` : ''}${x.url}`; const n = s ? `${s} ${add}` : add; return n.length <= 300 ? n : s; }, '');
  newsImage = ''; $('drop-preview').hidden = true;
  for (const x of $('feed-items').children) x.classList.remove('picked');
  note.textContent = `เจอ ${r.sources.length} แหล่ง${r.event ? ` · ${r.event}` : ''} — ตรวจกับลิงก์ก่อนโพสต์${r.caution ? ` · ⚠ ${r.caution}` : ''}`;
  note.hidden = false;
  say('ใส่เนื้อข่าวแล้ว — กด “📰 เรียบเรียงข่าว” ต่อได้เลย');
}, (e) => { $('nf-note').textContent = e.message; $('nf-note').hidden = false; say(''); }));

// ลิงก์ข่าวจากฟีดมักมีพารามิเตอร์ติดตาม (utm_*, at_*) — ตัดทิ้งก่อนใส่เป็นที่มา
function cleanLink(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|at_|fbclid|gclid)/i.test(k)) x.searchParams.delete(k);
    return x.href;
  } catch { return u; }
}

let feedsLoaded = false;
let feedList = [];
async function loadFeeds(selectId) {
  feedList = await api('GET', '/api/feeds');
  feedsLoaded = true;
  const sel = $('feed-sel');
  sel.replaceChildren(...feedList.map((f) => new Option(f.name, String(f.id))));
  if (selectId) sel.value = String(selectId);
  $('feed-empty').hidden = feedList.length > 0;
  $('feed-del').disabled = $('feed-refresh').disabled = !feedList.length;
  await loadFeedItems();
}

let feedSeq = 0; // เปลี่ยนฟีดเร็ว ๆ แล้วผลของฟีดเก่าตอบช้ากว่า → ทิ้งผลเก่า ไม่ให้ทับรายการของฟีดใหม่
async function loadFeedItems(fresh = false) {
  const box = $('feed-items');
  const id = $('feed-sel').value;
  const seq = ++feedSeq;
  if (!id) { box.replaceChildren(); return; }
  box.replaceChildren(h('li', { class: 'hint', textContent: 'กำลังโหลดข่าว…' }));
  try {
    const { feed, items } = await api('GET', `/api/feeds/${id}/items${fresh ? '?fresh=1' : ''}`);
    if (seq !== feedSeq) return;
    box.replaceChildren(...items.map((it) => feedItem(feed, it)));
    if (!items.length) box.replaceChildren(h('li', { class: 'hint', textContent: 'ฟีดนี้ยังไม่มีข่าว' }));
  } catch (e) { if (seq === feedSeq) box.replaceChildren(h('li', { class: 'err', textContent: e.message })); }
}

// ดึงเนื้อบทความจริง (ย่อหน้าหลัก) — ถ้าอ่านไม่ได้/สั้นเกิน ใช้สรุปจากฟีดแทน
async function articleText(it, quiet = false, signal) {
  try {
    const a = await api('POST', '/api/news/article', { url: it.link }, { quiet, signal });
    if (a.text.length >= 200) return a.text;
  } catch { /* ใช้สรุปจากฟีดแทน */ }
  return [it.title, it.summary].filter(Boolean).join('\n');
}

function feedItem(feed, it) {
  const note = h('span', { class: 'm' });
  const when = it.date ? new Date(it.date).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const sourceLine = `${feed.name} ${cleanLink(it.link)}`;
  const li = h('li', { class: 'feed-item' });
  const useBtn = h('button', { class: 'btn sm', type: 'button', textContent: '📥 ใช้เนื้อหานี้' });
  useBtn.addEventListener('click', () => guard(useBtn, async () => {
    note.textContent = 'กำลังดึงเนื้อข่าว…';
    $('f-brief').value = await articleText(it);
    $('f-title').value = it.title.slice(0, 200);
    $('f-source').value = sourceLine;
    newsImage = ''; $('drop-preview').hidden = true;
    for (const x of $('feed-items').children) x.classList.remove('picked');
    li.classList.add('picked');
    note.textContent = '';
    say('ใส่เนื้อข่าวแล้ว — กด “เรียบเรียงข่าว”');
  }, (err) => { note.textContent = err.message; }));
  const quickBtn = h('button', { class: 'btn sm primary', type: 'button', textContent: '⚡ เรียบเรียง → ลงคลัง' });
  quickBtn.addEventListener('click', () => guard(quickBtn, async () => {
    // 3 ขั้น: ดึงเนื้อข่าว (→35%) → AI เรียบเรียง (→90%) → บันทึกลงคลัง (100%)
    const ctrl = new AbortController(); // ปุ่ม ✕ หยุด บนการ์ดความคืบหน้า — หยุดได้ทุกขั้น ไม่บันทึกอะไรลงคลัง
    const tid = task.start(`ข่าว: ${it.title.slice(0, 40)}…`, 0.05, 'กำลังทำ', ctrl);
    let done = false;
    try {
      note.textContent = 'กำลังดึงเนื้อข่าว…';
      const text = await articleText(it, true, ctrl.signal);
      task.set(tid, 0.35, 'AI กำลังเรียบเรียงข่าว…');
      note.textContent = 'AI กำลังเรียบเรียง…';
      const r = await api('POST', '/api/news/rewrite', { text, source: sourceLine, target_sec: targetSec() }, { quiet: true, signal: ctrl.signal });
      task.set(tid, 0.75, 'กำลังดึงรูปจากที่มา…');
      const imgs = await autoImages([cleanLink(it.link)]);
      if (ctrl.signal.aborted) throw new Error(STOPPED);
      task.set(tid, 0.9, 'กำลังบันทึกลงคลัง…');
      await api('POST', '/api/clips', {
        images: imgs,
        title: r.title, brief: text.slice(0, 12000), script: r.script, caption: r.caption, hashtags: r.hashtags, source: sourceLine,
        theme, voice: $('f-voice').checked, narr_tone: $('f-tone').value, music: $('f-music').value, target_sec: targetSec(),
      });
      task.set(tid, 1, 'บันทึกลงคลังแล้ว ✓');
      done = true;
    } finally { task.end(tid, done ? 600 : 0); }
    note.textContent = '✓ บันทึกลงคลังแล้ว (ร่าง)';
    toast('บันทึกข่าวลงคลังแล้ว — ไปคัดลอกแคปชันได้ที่คลัง');
    await refresh();
  }, (err) => { note.textContent = err.message; }));
  li.append(h('div', { class: 't', textContent: it.title }), h('div', { class: 'm', textContent: [when, feed.name].filter(Boolean).join(' · ') }),
    h('div', { class: 'acts' }, useBtn, quickBtn), note);
  return li;
}

$('feed-sel').addEventListener('change', () => loadFeedItems());
$('feed-refresh').addEventListener('click', (e) => guard(e.currentTarget, () => loadFeedItems(true)));
$('feed-add-toggle').addEventListener('click', () => { $('feed-add').hidden = !$('feed-add').hidden; if (!$('feed-add').hidden) $('feed-url').focus(); });
$('feed-add-go').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const f = await api('POST', '/api/feeds', { url: $('feed-url').value });
  $('feed-url').value = '';
  $('feed-add').hidden = true;
  await loadFeeds(f.id);
  toast(`เพิ่มฟีด “${f.name}” แล้ว`);
}, (err) => toast(err.message, true)));
$('feed-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('feed-add-go').click(); });
$('feed-del').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const f = feedList.find((x) => String(x.id) === $('feed-sel').value);
  if (!f || !(await uiConfirm(`ลบฟีดข่าว “${f.name}” ?`, { title: 'ลบฟีด', ok: 'ลบ', danger: true }))) return;
  await api('DELETE', `/api/feeds/${f.id}`);
  await loadFeeds();
}));

// คลิปที่ยังไม่มีแคปชัน/แฮชแท็ก → ให้ AI เขียนให้ทันทีหลังบันทึก (พลาดก็ไม่ล้มงาน แค่แจ้งเตือน — กด “✨ AI แคปชัน” ที่แถวคลิปได้ภายหลัง)
async function withCaption(clip) {
  if (clip.caption && clip.hashtags) return clip;
  if (!status.ai) { toast('ยังไม่มีแคปชัน — ต่อ AI ในตั้งค่าแล้วกด “✨ AI แคปชัน” ที่คลิป', true); return clip; }
  try { return await api('POST', `/api/clips/${clip.id}/caption`); } catch (e) { toast(`บันทึกแล้ว แต่ AI เขียนแคปชันไม่สำเร็จ: ${e.message}`, true); return clip; }
}

// บันทึกเป็นร่างลงคลังโดยไม่เรนเดอร์ — ไว้คัดลอกแคปชัน/แฮชแท็กไปโพสต์ก่อน เรนเดอร์ทีหลังได้
$('b-draft').addEventListener('click', (ev) => guard(ev.currentTarget, async () => {
  const d = formData();
  if (!d.title.trim()) d.title = (d.script.split('\n')[0] || d.brief.split('\n')[0] || '').trim().slice(0, 80);
  if (!d.title) throw new Error('ใส่ชื่อ เนื้อหา หรือสคริปต์อย่างน้อยหนึ่งอย่าง');
  const saved = await api('POST', '/api/clips', d);
  clearForm();
  say('');
  await withCaption(saved);
  toast('บันทึกร่างลงคลังแล้ว ✓ (มีแคปชันและแฮชแท็กให้คัดลอก)');
  await refresh();
}, (e) => say(e.message)));

// บันทึกเป็นร่าง (ไม่เรนเดอร์) แล้วเปิดหน้าต่าง prompt สำหรับ Meta AI
$('b-prompts').addEventListener('click', (ev) => guard(ev.currentTarget, async () => {
  const d = formData();
  if (!d.title.trim()) throw new Error('ใส่ชื่อคลิปก่อน');
  if (!d.script.trim() && !d.brief.trim()) throw new Error('ใส่เนื้อหาหรือสคริปต์อย่างน้อยหนึ่งอย่าง');
  const clip = await api('POST', '/api/clips', d);
  clearForm();
  say('');
  await withCaption(clip);
  await refresh(); // ร่างอยู่ในคลังแล้ว กลับมาแก้/เรนเดอร์ทีหลังได้
  await openPrompts(clip.id, true);
}, (e) => say(e.message)));

$('b-create').addEventListener('click', (ev) => guard(ev.target, async () => {
  const d = formData();
  if (!d.title.trim()) throw new Error('ใส่ชื่อคลิปก่อน');
  if (!d.script.trim() && !d.brief.trim()) throw new Error('ใส่เนื้อหาหรือสคริปต์อย่างน้อยหนึ่งอย่าง');
  // ติ๊ก "ดึงรูปจริงจากที่มาอัตโนมัติ" ไว้ แต่ยังไม่มีรูปที่เลือก → ดึงจากลิงก์ที่มาให้ตอนกดสร้างเลย
  if (autoImgOn() && !imSel.length) {
    const urls = urlsIn(d.source);
    if (urls.length) {
      say('กำลังดึงรูปจากที่มา…');
      const found = await autoImages(urls);
      if (found.length) { setImages(found); d.images = found.map(({ file, credit, src }) => ({ file, credit, src })); }
    }
  }
  let clip = await api('POST', '/api/clips', d);
  if (!clip.script) { say('กำลังให้ AI เขียนสคริปต์…'); clip = await api('POST', `/api/clips/${clip.id}/script`); }
  await refresh(); // ให้แถวโผล่ในคลังทันที (สถานะร่าง) ระหว่างอัด
  clip = await withCaption(clip);
  try {
    await renderInBrowser(clip.id, (p) => say(`กำลังอัดคลิป ${Math.round(p * 100)}% — เปิดแท็บนี้ค้างไว้`));
  } catch (e) {
    say(e.message === STOPPED ? 'หยุดเรนเดอร์แล้ว — คลิปเก็บเป็นร่างในคลัง กด “🎞 เรนเดอร์คลิป” ที่การ์ดในคลังได้ภายหลัง' : `เก็บเป็นร่างแล้ว แต่เรนเดอร์ไม่สำเร็จ: ${e.message}`);
    await refresh();
    return;
  }
  clearForm(); // ความยาว/สไตล์/เสียง คงค่าเดิมไว้ให้คลิปถัดไป
  say('');
  toast('สร้างคลิปเสร็จแล้ว ✓ — ดูได้ที่แท็บคลัง');
  await refresh();
  if (view === 'create') location.hash = 'library';
}, (e) => say(e.message)));

// ---------- ตั้งค่า ----------
const dlg = $('settings');
const clearFlags = { akey: false, gkey: false, mkey: false };

function keyHint(el, k, clearedKey) {
  el.textContent = clearedKey ? 'จะลบคีย์เมื่อกดบันทึก' : (k.set ? `ตั้งค่าแล้ว ${k.hint} — เว้นว่างไว้ถ้าไม่เปลี่ยน` : 'ยังไม่ได้ตั้งค่า');
}

function syncProvider() {
  const prov = document.querySelector('input[name="s-prov"]:checked')?.value;
  $('s-google').hidden = prov !== 'google';
  $('s-gemini').hidden = prov !== 'gemini';
  const ai = document.querySelector('input[name="s-aip"]:checked')?.value;
  $('s-cli').hidden = ai !== 'cli';
  $('s-api').hidden = ai !== 'api';
}

// สถานะ Claude Code ที่ล็อกอินไว้ (เจอโปรแกรมไหม / ล็อกอินหรือยัง)
function showCli(cliInfo) {
  const el = $('s-cli-status');
  if (!cliInfo.found) {
    el.className = 'cli-status bad';
    el.textContent = '⚠ ไม่พบโปรแกรม claude (Claude Code) ในเครื่อง — ติดตั้ง Claude Code หรือเลือกใช้ API key แทน';
    $('s-cli-login').hidden = true;
    return;
  }
  el.className = `cli-status ${cliInfo.loggedIn ? 'ok' : 'bad'}`;
  el.textContent = cliInfo.loggedIn ? '✓ พบโปรแกรมและล็อกอินแล้ว พร้อมใช้งาน' : '⚠ พบโปรแกรม แต่ยังไม่ได้ล็อกอิน';
  $('s-cli-login').hidden = cliInfo.loggedIn;
  $('s-cli-cmd').textContent = cliInfo.loginCommand;
}

// สไตล์ประจำเพจ: การ์ดโทนสำเร็จรูป (เลือกแล้วเติมช่องให้ แก้เองต่อได้ — ยังไม่บันทึกจนกด “บันทึก”)
let brandPresets = [], brandPrev = '';
function renderBrand(b, presets) {
  brandPresets = presets;
  brandPrev = b.preset || '';
  const opt = (id, name, desc) => h('label', { class: 'rc' }, h('input', { type: 'radio', name: 'br-p', value: id }), h('span', {}, h('b', { textContent: name }), h('small', { textContent: desc })));
  $('br-presets').replaceChildren(
    opt('', 'ไม่ใช้สไตล์ประจำเพจ', 'ให้ AI คิดโทนเองทุกคลิป (แบบเดิม)'),
    ...presets.map((p) => opt(p.id, p.name, p.desc)));
  const sel = document.querySelector(`input[name="br-p"][value="${b.preset || ''}"]`) || document.querySelector('input[name="br-p"][value=""]');
  sel.checked = true;
  $('br-visual').value = b.visual || '';
  $('br-voice').value = b.voice || '';
  $('br-tags').value = b.tags || '';
}
$('br-presets').addEventListener('change', (e) => {
  const p = brandPresets.find((x) => x.id === e.target.value);
  $('br-visual').value = p?.visual || '';
  $('br-voice').value = p?.voice || '';
  $('br-tags').value = p?.tags || '';
});

// โลโก้เพจ: เลือกไฟล์ → (ตัดพื้นหลังสีทึบด้วย flood-fill จากขอบภาพ) → PNG → อัปโหลด
function paintLogo() {
  const has = !!status.logo;
  $('br-logo-prev').hidden = !has;
  $('br-logo-none').hidden = has;
  $('br-logo-del').hidden = !has;
  if (has) $('br-logo-prev').src = `/brand/logo.png?v=${status.logo.v}`;
}

async function logoToPng(file, cut) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 700 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  if (cut) {
    const im = ctx.getImageData(0, 0, w, h), d = im.data;
    const at = (x, y) => (y * w + x) * 4;
    const corners = [at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)];
    const bg = [0, 1, 2].map((ch) => corners.reduce((a, p) => a + d[p + ch], 0) / 4);
    const near = (p, tol) => Math.hypot(d[p] - bg[0], d[p + 1] - bg[1], d[p + 2] - bg[2]) <= tol;
    const seen = new Uint8Array(w * h), stack = [];
    const push = (x, y) => { const i = y * w + x; if (!seen[i] && near(i * 4, 48)) { seen[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) { // ลบเฉพาะพื้นหลังที่ต่อกับขอบภาพ (สีเดียวกันที่อยู่ในตัวโลโก้ไม่โดนลบ)
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
    }
    for (let i = 0; i < seen.length; i++) if (seen[i]) d[i * 4 + 3] = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { // ขอบที่ติดพื้นหลังที่ลบ: ทำโปร่งครึ่งหนึ่งให้ขอบนุ่ม
      const i = y * w + x;
      if (!seen[i] && (seen[i - 1] || seen[i + 1] || seen[i - w] || seen[i + w])) d[i * 4 + 3] = Math.min(d[i * 4 + 3], 150);
    }
    ctx.putImageData(im, 0, 0);
  }
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

$('br-logo-pick').addEventListener('click', () => $('br-logo-file').click());
$('br-logo-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  guard($('br-logo-pick'), async () => {
    $('br-logo-msg').textContent = 'กำลังเตรียมโลโก้…';
    const png = await logoToPng(file, $('br-logo-cut').checked);
    const r = await fetch('/api/brand/logo', { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `อัปโหลดไม่สำเร็จ (${r.status})`);
    await loadStatus();
    paintLogo();
    $('br-logo-msg').textContent = 'บันทึกโลโก้แล้ว ✓';
  }, (err) => { $('br-logo-msg').textContent = err.message; });
});
$('br-logo-del').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  await api('DELETE', '/api/brand/logo');
  await loadStatus();
  paintLogo();
  $('br-logo-msg').textContent = 'ลบโลโก้แล้ว';
}));

// ส่วนเสริม Chrome: รหัสจับคู่ + โฟลเดอร์ที่ต้องเลือกตอนติดตั้ง
function paintPairing(p) {
  $('s-ext-token').value = p.token;
  $('s-ext-token').type = 'password';
  $('s-ext-show').textContent = 'แสดง';
  $('s-ext-dir').textContent = p.dir;
}
$('s-ext-show').addEventListener('click', () => {
  const on = $('s-ext-token').type === 'password';
  $('s-ext-token').type = on ? 'text' : 'password';
  $('s-ext-show').textContent = on ? 'ซ่อน' : 'แสดง';
});
for (const [btn, src] of [['s-ext-copy', () => $('s-ext-token').value], ['s-ext-dir-copy', () => $('s-ext-dir').textContent]]) {
  $(btn).addEventListener('click', async (e) => {
    const b = e.currentTarget, t0 = b.textContent;
    if (!(await copyText(src()))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
    b.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => { b.textContent = t0; }, 1500);
  });
}
$('s-ext-rotate').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  if (!(await uiConfirm('สร้างรหัสจับคู่ใหม่? ส่วนเสริมที่จับคู่ไว้จะใช้ไม่ได้จนกว่าจะวางรหัสใหม่', { title: 'สร้างรหัสใหม่', ok: 'สร้างใหม่', danger: true }))) return;
  paintPairing(await api('POST', '/api/ext/pairing/rotate'));
  toast('สร้างรหัสใหม่แล้ว — วางรหัสใหม่ในตั้งค่าของส่วนเสริม');
}));

async function openSettings() {
  const s = await api('GET', '/api/settings');
  api('GET', '/api/ext/pairing').then(paintPairing).catch(() => {});
  renderBrand(s.brand, s.brandPresets);
  $('br-logo-on').checked = s.brand.logoOn !== false;
  $('br-logo-msg').textContent = '';
  paintLogo();
  clearFlags.akey = clearFlags.gkey = clearFlags.mkey = false;
  $('s-akey').value = ''; $('s-gkey').value = ''; $('s-mkey').value = '';
  keyHint($('s-akey-hint'), s.anthropicKey);
  keyHint($('s-gkey-hint'), s.googleKey);
  keyHint($('s-mkey-hint'), s.geminiKey);
  $('s-mvoice').value = s.geminiVoice;
  $('s-mmodel').value = s.geminiModel;
  $('s-model').value = s.model;
  $('s-gvoice').value = s.googleVoice;
  $('s-rate').value = s.ttsRate;
  $('s-rate-out').textContent = `${Number(s.ttsRate).toFixed(2)}×`;
  document.querySelector(`input[name="s-prov"][value="${s.ttsProvider}"]`).checked = true;
  document.querySelector(`input[name="s-aip"][value="${s.aiProvider}"]`).checked = true;
  showCli(s.claudeCli);
  syncProvider();
  $('s-msg').textContent = '';
  $('s-audio').hidden = true;
  dlg.showModal();
}

function settingsBody() {
  const body = {
    aiProvider: document.querySelector('input[name="s-aip"]:checked').value,
    model: $('s-model').value.trim(),
    ttsProvider: document.querySelector('input[name="s-prov"]:checked').value,
    googleVoice: $('s-gvoice').value.trim(),
    geminiVoice: $('s-mvoice').value,
    geminiModel: $('s-mmodel').value.trim(),
    ttsRate: Number($('s-rate').value),
    brand: { preset: document.querySelector('input[name="br-p"]:checked')?.value || '', visual: $('br-visual').value, voice: $('br-voice').value, tags: $('br-tags').value, logoOn: $('br-logo-on').checked },
  };
  if (clearFlags.akey) body.anthropicKey = null; else if ($('s-akey').value.trim()) body.anthropicKey = $('s-akey').value.trim();
  if (clearFlags.mkey) body.geminiKey = null; else if ($('s-mkey').value.trim()) body.geminiKey = $('s-mkey').value.trim();
  if (clearFlags.gkey) body.googleKey = null; else if ($('s-gkey').value.trim()) body.googleKey = $('s-gkey').value.trim();
  return body;
}

async function saveSettings() {
  const s = await api('POST', '/api/settings', settingsBody());
  clearFlags.akey = clearFlags.gkey = clearFlags.mkey = false;
  $('s-akey').value = ''; $('s-gkey').value = ''; $('s-mkey').value = '';
  keyHint($('s-akey-hint'), s.anthropicKey);
  keyHint($('s-gkey-hint'), s.googleKey);
  keyHint($('s-mkey-hint'), s.geminiKey);
  await loadStatus();
  if (status.brand?.theme && (s.brand.preset || '') !== brandPrev) setTheme(status.brand.theme); // เปลี่ยนโทน → ธีมสีของคลิปใหม่ตามโทนนั้น
  brandPrev = s.brand.preset || '';
  await refresh();
  return s;
}

$('b-settings').addEventListener('click', (e) => guard(e.currentTarget, openSettings));
$('set-x').addEventListener('click', () => dlg.close());
$('s-cancel').addEventListener('click', () => dlg.close());
$('s-rate').addEventListener('input', () => { $('s-rate-out').textContent = `${Number($('s-rate').value).toFixed(2)}×`; });
for (const r of document.querySelectorAll('input[name="s-prov"], input[name="s-aip"]')) r.addEventListener('change', syncProvider);
$('s-cli-check').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  $('s-msg').textContent = 'กำลังตรวจสถานะ…';
  showCli((await api('POST', '/api/ai/check')).claudeCli);
  $('s-msg').textContent = '';
}, (err) => { $('s-msg').textContent = err.message; }));
// ล็อกอิน: สั่งเริ่ม → เบราว์เซอร์เด้งให้ผู้ใช้กดอนุญาตเอง → โพลสถานะจนล็อกอินสำเร็จหรือโปรแกรมจบ
let loginPoll = null;
async function startLogin() {
  const st = await api('POST', '/api/ai/login');
  $('s-cli-go').disabled = true;
  $('s-cli-wait').hidden = false;
  $('s-msg').textContent = '';
  clearInterval(loginPoll);
  let ticks = 0;
  loginPoll = setInterval(async () => {
    try {
      const s = await api('GET', '/api/ai/login');
      $('s-cli-fallback').hidden = !s.url;
      if (s.url) $('s-cli-url').href = s.url;
      if (s.loggedIn || (s.finished && !s.running) || ++ticks > 300) {
        clearInterval(loginPoll);
        $('s-cli-go').disabled = false;
        $('s-cli-wait').hidden = true;
        showCli((await api('POST', '/api/ai/check')).claudeCli);
        if (s.loggedIn) { toast('ล็อกอิน Claude Code สำเร็จ ✓'); await loadStatus(); }
        else $('s-msg').textContent = 'ยังไม่ได้ล็อกอิน — กดปุ่มล็อกอินแล้วทำตามในเบราว์เซอร์ให้จบ';
      }
    } catch (e) { clearInterval(loginPoll); $('s-cli-go').disabled = false; $('s-msg').textContent = e.message; }
  }, 2000);
  if (st.url) { $('s-cli-fallback').hidden = false; $('s-cli-url').href = st.url; }
}
$('s-cli-go').addEventListener('click', (e) => guard(e.currentTarget, startLogin, (err) => { $('s-msg').textContent = err.message; }));
dlg.addEventListener('close', () => clearInterval(loginPoll));

$('s-cli-copy').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  if (!(await copyText($('s-cli-cmd').textContent))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
  b.textContent = 'คัดลอกแล้ว ✓';
  setTimeout(() => { b.textContent = 'คัดลอก'; }, 1500);
});
$('s-akey-clear').addEventListener('click', () => { clearFlags.akey = true; $('s-akey').value = ''; $('s-akey-hint').textContent = 'จะลบคีย์เมื่อกดบันทึก'; });
$('s-mkey-clear').addEventListener('click', () => { clearFlags.mkey = true; $('s-mkey').value = ''; $('s-mkey-hint').textContent = 'จะลบคีย์เมื่อกดบันทึก'; });
$('s-gkey-clear').addEventListener('click', () => { clearFlags.gkey = true; $('s-gkey').value = ''; $('s-gkey-hint').textContent = 'จะลบคีย์เมื่อกดบันทึก'; });

$('set-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard($('s-save'), async () => {
    await saveSettings();
    $('s-msg').textContent = '';
    dlg.close();
    toast('บันทึกการตั้งค่าแล้ว ✓');
  }, (err) => { $('s-msg').textContent = err.message; });
});

$('s-test').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  $('s-msg').textContent = 'บันทึกค่าที่เห็นอยู่ แล้วกำลังสร้างเสียงทดสอบ…';
  await saveSettings(); // ทดสอบด้วยค่าที่เห็นอยู่ตอนนี้ (บันทึกจริง — บอกผู้ใช้ชัด ๆ กันสงสัยว่าคีย์หายหรือยัง)
  const r = await api('POST', '/api/tts/test');
  const a = $('s-audio');
  a.src = `${r.file}?t=${Date.now()}`;
  a.hidden = false;
  $('s-msg').textContent = '✓ บันทึกการตั้งค่าแล้ว — ฟังเสียงทดสอบด้านล่าง';
  a.play().catch(() => {});
}, (err) => { $('s-msg').textContent = err.message; }));

// เปิดแอปมาแล้ว AI ยังไม่พร้อม → เด้งหน้าตั้งค่าให้ล็อกอินเลย (ครั้งเดียวต่อการเปิดแท็บ ไม่เด้งซ้ำทุกรีเฟรช)
async function promptLoginOnce() {
  if (status.ai) return;
  try { if (sessionStorage.getItem('arn-login-prompted')) return; sessionStorage.setItem('arn-login-prompted', '1'); } catch { /* ไม่มี storage ก็เด้งตามปกติ */ }
  await openSettings();
}

// ---------- แท็บบน: วันนี้ / สร้างคลิป / คลัง (จำใน #hash) ----------
let view = 'today';
function setView(v) {
  view = ['today', 'products', 'create', 'library', 'schedule', 'series'].includes(v) ? v : 'today';
  document.body.dataset.view = view;
  for (const a of document.querySelectorAll('#tabs a[data-view]')) a.toggleAttribute('aria-current', a.dataset.view === view);
  if (view === 'today') renderToday().catch((e) => { $('td-next-t').textContent = e.message; });
  if (view === 'products') openProducts();
  if (view === 'schedule') renderSchedule().catch((e) => toast(e.message, true));
  if (view === 'series' && !$('series-frame').src) $('series-frame').src = '/series.html?embed=1';
}
window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
setView(location.hash.slice(1));

// ---------- หน้าวันนี้ ----------
const tdGoal = () => Math.max(1, Number(lsGet('tdGoal', '3')) || 3);
let tdBusy = false;
async function renderToday() {
  if (tdBusy) return;
  tdBusy = true;
  try {
    const { items } = await api('GET', '/api/clips?sort=old&limit=500');
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const by = { wait: [], text: [], ready: [], posted: [] };
    for (const c of items) {
      const k = stageOf(c).key;
      if (k === 'posted') { if (c.posted_at >= t0.getTime()) by.posted.push(c); }
      else if (by[k]) by[k].push(c);
    }
    by.ready.sort((a, b) => (a.kind === 'product' ? 0 : 1) - (b.kind === 'product' ? 0 : 1));
    await loadChannels();
    const act = channels.filter((x) => x.active);
    const goal = act.reduce((n, x) => n + x.goal, 0) || tdGoal(), done = act.reduce((n, x) => n + Math.min(x.today, x.goal), 0);
    renderQuests().catch(() => {});
    $('td-goals').replaceChildren(...act.map((x) => h('div', { class: 'td-gl' },
      h('div', { class: 'td-gl-h' }, chBadge(x), h('b', { textContent: x.name }), h('span', { class: 'td-gl-n' }, h('b', { textContent: String(x.today) }), ` / ${x.goal}`)),
      h('div', { class: 'td-bar' }, Object.assign(h('div'), { style: `width:${Math.min(100, Math.round(x.today / Math.max(1, x.goal) * 100))}%` })))));
    // ขั้นถัดไปที่ควรทำ: โพสต์ (ถ้ายังไม่ครบเป้า) → ทำคลิปเสร็จ → ไปทำวิดีโอบน meta.ai → หาสินค้า
    const go = $('td-next-go');
    let next;
    renderDue();
    if (by.ready.length && done < goal) next = [`พร้อมโพสต์ ${by.ready.length} คลิป — ถัดไป: ${by.ready[0].title}`, '📤 โพสต์ลงเพจ', () => openPostPanel(by.ready[0].id)];
    else if (by.text.length) next = [`มีวิดีโอจาก Meta AI รอใส่ข้อความ ${by.text.length} คลิป`, '🎞 ใส่ข้อความ + ทำคลิปเสร็จ', async () => { await finishProduct(by.text[0].id); await refresh(); }];
    else if (by.wait.length) next = [`รอทำวิดีโอบน meta.ai ${by.wait.length} ชิ้น`, '↗ เปิด meta.ai', () => window.open('https://www.meta.ai/', '_blank', 'noopener')];
    else next = ['คิวว่าง — หาสินค้ามาทำคลิปเพิ่ม', '🔎 หาสินค้าใน Shopee', () => $('td-kw-go').click()];
    $('td-next-t').textContent = next[0];
    go.hidden = false; go.textContent = next[1]; go.onclick = () => guard(go, next[2]);
    // สายพาน 4 ขั้น
    const col = (key, name, hint, list, btn, fn) => {
      const b = h('button', { class: 'btn sm', type: 'button', textContent: btn, disabled: !list.length && key !== 'wait' });
      b.addEventListener('click', () => guard(b, fn));
      return h('div', { class: `td-col ${key}` },
        h('div', { class: 'td-col-h' }, h('span', { class: 'dot' }), h('b', { textContent: name }), h('span', { class: 'td-n', textContent: String(list.length) })),
        h('div', { class: 'hint', textContent: hint }),
        h('ul', {}, ...list.slice(0, 3).map((c) => h('li', { textContent: c.title })), ...(list.length > 3 ? [h('li', { class: 'muted', textContent: `และอีก ${list.length - 3}` })] : [])),
        b);
    };
    const toLib = (st) => () => { filter = st; kind = ''; for (const x of $('filter').children) x.setAttribute('aria-pressed', String(x.dataset.v === st)); for (const x of $('kindfilter').children) x.setAttribute('aria-pressed', String(x.dataset.k === '')); resetPage(); location.hash = 'library'; refresh(); };
    $('td-pipe').replaceChildren(
      col('wait', 'รอวิดีโอ Meta AI', 'เปิด meta.ai แผง Arn Reels วาง prompt + รูปให้ คุณกดสร้างเอง', by.wait, '↗ เปิด meta.ai', () => window.open('https://www.meta.ai/', '_blank', 'noopener')),
      col('text', 'รอใส่ข้อความ', 'ได้วิดีโอดิบแล้ว — ใส่ข้อความไทย + แคปชัน', by.text, '🎞 ทำคลิปเสร็จ', async () => { await finishProduct(by.text[0].id); await refresh(); }),
      col('ready', 'พร้อมโพสต์', 'ดาวน์โหลด คัดลอกแคปชันและคอมเมนต์ลิงก์', by.ready, '📤 โพสต์', () => openPostPanel(by.ready[0].id)),
      col('posted', 'โพสต์แล้ววันนี้', 'นับรวมในเป้าวันนี้', by.posted, 'ดูในคลัง', toLib('posted')));
  } finally { tdBusy = false; }
}
$('td-goal-edit').addEventListener('click', () => openChannels());


// ---------- เควสเพจ (หน้าสถานะของ Facebook) + โพสต์รูป ----------
const PHOTO_ICON = { news: '📰', ask: '💬', product: '🛍' };
const PHOTO_TH = { news: 'การ์ดข่าว', ask: 'ชวนคุย', product: 'รูปสินค้า' };
async function renderQuests() {
  const qs = await api('GET', '/api/quests');
  const box = $('td-quests');
  if (!box) return;
  if (!qs.length) {
    box.replaceChildren(h('div', { class: 'td-label' }, 'เควสสัปดาห์นี้ของเพจ'),
      h('div', { class: 'hint' }, 'เปิดหน้า ', h('a', { href: 'https://www.facebook.com/professional_dashboard/status', target: '_blank', rel: 'noopener' }, 'แดชบอร์ดครีเอเตอร์ → สถานะ'), ' ใน Chrome (ใช้งานในนามเพจ) แล้วส่วนเสริมจะส่งเควสมาให้เอง'));
    return;
  }
  box.replaceChildren(...qs.map((q) => {
    const age = Math.round((Date.now() - q.updated_at) / 3600_000);
    const rows = q.items.filter((x) => x.total).map((x) => h('div', { class: `qs-row${x.complete ? ' done' : ''}` },
      h('span', { class: 'qs-l', textContent: `${x.complete ? '✓ ' : ''}${x.label}` }),
      h('span', { class: 'qs-n', textContent: `${x.done}/${x.total}` }),
      h('div', { class: 'td-bar' }, Object.assign(h('div'), { style: `width:${Math.min(100, Math.round(x.done / Math.max(1, x.total) * 100))}%` }))));
    const p = q.plan;
    const needR = Math.max(0, p.reel - p.todayReel), needP = Math.max(0, p.photo - p.todayPhoto);
    const mk = h('button', { class: 'btn sm primary', type: 'button', textContent: `🖼 ทำโพสต์รูปวันนี้ (${Math.max(needP, 1)})`, disabled: !needP });
    mk.addEventListener('click', () => guard(mk, () => makePhotoMix(needP)));
    return h('div', { class: 'qs' },
      h('div', { class: 'td-label', textContent: `เควสสัปดาห์นี้ · ${q.channel} · ${q.week} (เหลือ ${q.days} วัน)` }),
      ...rows,
      h('div', { class: 'qs-plan' }, `วันนี้ควรลง: 🎬 Reels ${p.reel} (ลงแล้ว ${p.todayReel}) · 🖼 โพสต์รูป ${p.photo} (ลงแล้ว ${p.todayPhoto})`),
      h('div', { class: 'row' }, mk, h('span', { class: 'hint', textContent: `อัปเดตจาก Facebook ${age < 1 ? 'เมื่อสักครู่' : `${age} ชม.ที่แล้ว`}` })));
  }));
}
// ผสมแบบโพสต์รูป: ข่าว → ชวนคุย → สินค้า วนไป
async function makePhotoMix(n) {
  const order = ['news', 'ask', 'product'];
  const want = { news: 0, ask: 0, product: 0 };
  for (let i = 0; i < Math.max(1, n); i++) want[order[i % 3]]++;
  let made = 0;
  for (const st of order) if (want[st]) { try { made += await makePhotos(st, want[st]); } catch (e) { toast(`${PHOTO_TH[st]}: ${e.message}`, true); } }
  toast(made ? `ทำโพสต์รูปแล้ว ${made} โพสต์ — กด “จัดอัตโนมัติ” ในตารางโพสต์เพื่อลงช่วงเวลา` : 'ยังทำโพสต์รูปไม่ได้', !made);
  await refresh();
}
async function makePhotos(style, count) {
  const tid = task.start(`โพสต์รูป: ${PHOTO_TH[style]}`, 0.05, style === 'news' ? 'AI กำลังหาข่าววันนี้…' : 'AI กำลังเขียนโพสต์…');
  let n = 0;
  try {
    const clips = await api('POST', '/api/photo-posts', { style, count });
    for (const [i, c] of clips.entries()) { task.set(tid, 0.4 + 0.6 * i / clips.length, `กำลังทำรูป ${i + 1}/${clips.length}`); await makePhotoFile(c); n++; }
  } finally { task.end(tid, 500); }
  return n;
}
const PHOTO_FONT = '"LINE Seed Sans TH", "LINESeedSansTH", "Leelawadee UI", "Noto Sans Thai", Tahoma, sans-serif';
function wrapTh(ctx, text, maxW) {
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((x) => x.segment) : text.split(/(\s+)/);
  const lines = []; let cur = '';
  for (const w of seg) { if (ctx.measureText(cur + w).width > maxW && cur.trim()) { lines.push(cur.trim()); cur = w.trimStart(); } else cur += w; }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
const loadImg = (src) => new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = src; });
function drawCover(ctx, im, x, y, w, hh, contain = false) {
  const r = contain ? Math.min(w / im.width, hh / im.height) : Math.max(w / im.width, hh / im.height);
  const dw = im.width * r, dh = im.height * r;
  ctx.drawImage(im, x + (w - dw) / 2, y + (hh - dh) / 2, dw, dh);
}
// วาดการ์ดโพสต์รูป 1080×1350 (4:5) → อัปโหลดรูป + หน้าปกเล็กของคลัง
async function makePhotoFile(c) {
  const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  let img = null;
  try { const f = JSON.parse(c.images || '[]')[0]; if (f && f.file) img = await loadImg(`/clip-images/${f.file}`); } catch { /* ไม่มีรูป */ }
  const logo = status.logo && status.brand?.logoOn !== false ? await loadImg(`/brand/logo.png?v=${status.logo.v}`) : null;
  const text = (c.brief || c.title || '').trim();
  const pill = (label, x, y, bg, fg) => { ctx.font = `800 40px ${PHOTO_FONT}`; const w = ctx.measureText(label).width + 56; ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, w, 72, 36); ctx.fill(); ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 28, y + 38); return w; };
  ctx.textBaseline = 'alphabetic';
  if (c.badge === 'news') {
    if (img) drawCover(ctx, img, 0, 0, W, H); else { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1e2a78'); g.addColorStop(1, '#c2185b'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,.72)'); g.addColorStop(1, 'rgba(0,0,0,.92)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.35, W, H * 0.65);
    ctx.font = `900 84px ${PHOTO_FONT}`;
    const lines = wrapTh(ctx, text, W - 140).slice(0, 4);
    let y = H - 150 - (lines.length - 1) * 104;
    pill('ข่าววันนี้', 70, y - 150, '#e53935', '#fff');
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 12;
    ctx.font = `900 84px ${PHOTO_FONT}`;
    for (const l of lines) { ctx.fillText(l, 70, y); y += 104; }
    ctx.shadowBlur = 0;
    let credit = ''; try { credit = JSON.parse(c.images || '[]')[0]?.credit || ''; } catch { /* ไม่มี */ }
    if (credit) { ctx.font = `500 30px ${PHOTO_FONT}`; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(`ภาพ: ${credit}`, 70, H - 56); }
  } else if (c.badge === 'product') {
    ctx.fillStyle = '#fff7f0'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffe0cc'; ctx.beginPath(); ctx.arc(W / 2, 560, 440, 0, Math.PI * 2); ctx.fill();
    if (img) drawCover(ctx, img, 120, 140, W - 240, 840, true);
    ctx.font = `900 76px ${PHOTO_FONT}`; ctx.fillStyle = '#222';
    const lines = wrapTh(ctx, text, W - 140).slice(0, 2);
    let y = 1080;
    for (const l of lines) { ctx.fillText(l, 70, y); y += 92; }
    pill('พิกัดในคอมเมนต์ 👇', 70, H - 130, '#ee4d2d', '#fff');
  } else { // ask
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#ffb3c7'); g.addColorStop(1, '#8c7bff'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.beginPath(); ctx.roundRect(80, 240, W - 160, 760, 48); ctx.fill();
    ctx.font = `900 88px ${PHOTO_FONT}`; ctx.fillStyle = '#2b2350'; ctx.textAlign = 'center';
    const lines = wrapTh(ctx, text, W - 300).slice(0, 5);
    let y = 620 - (lines.length - 1) * 54;
    for (const l of lines) { ctx.fillText(l, W / 2, y); y += 108; }
    ctx.textAlign = 'left';
    ctx.font = `800 52px ${PHOTO_FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('💬 ตอบในคอมเมนต์เลย', W / 2, 1150); ctx.textAlign = 'left';
  }
  if (logo) { const s = 120; ctx.save(); ctx.beginPath(); ctx.arc(W - 70 - s / 2, 70 + s / 2, s / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(logo, W - 70 - s, 70, s, s); ctx.restore(); }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
  const res = await fetch(`/api/clips/${c.id}/photo`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  const tc = document.createElement('canvas'); tc.width = 270; tc.height = Math.round(270 * H / W);
  tc.getContext('2d').drawImage(cv, 0, 0, tc.width, tc.height);
  const tb = await new Promise((r) => tc.toBlob(r, 'image/jpeg', 0.8));
  await fetch(`/api/clips/${c.id}/thumb`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: tb }).catch(() => {});
  return data;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-photo]');
  if (!b) return;
  const n = Number(($('ph-count') || {}).value) || 1;
  guard(b, async () => { const k = b.dataset.photo; const made = k === 'mix' ? (await makePhotoMix(n), 0) : await makePhotos(k, n); if (made) { toast(`ทำโพสต์รูปแล้ว ${made} โพสต์`); await refresh(); } });
});

// ---------- ช่องทางโพสต์ (หน้าต่าง) ----------
const KIND_TH = { product: 'สินค้า', quick: 'คลิปเร็ว/ข่าว', story: 'เรื่อง' };
async function openChannels() {
  await loadChannels();
  renderChannels();
  $('ch-msg').textContent = '';
  if (!$('channels').open) $('channels').showModal();
}
function renderChannels() {
  $('ch-list').replaceChildren(...channels.map((x) => {
    const f = {
      name: h('input', { value: x.name, maxLength: 80 }),
      url: h('input', { value: x.url, maxLength: 300, placeholder: x.kind === 'yt' ? 'https://www.youtube.com/@ชื่อช่อง' : 'https://www.facebook.com/ชื่อเพจ' }),
      goal: h('input', { type: 'number', min: 0, max: 50, value: x.goal }),
      times: h('input', { value: x.times.split(',').filter(Boolean).join(', '), placeholder: 'เช่น 09:00, 12:00, 19:00' }),
      photo_times: h('input', { value: (x.photo_times || '').split(',').filter(Boolean).join(', '), placeholder: 'เช่น 07:30, 15:00, 21:00' }),
      tone: h('input', { value: x.tone, maxLength: 120, placeholder: 'เช่น เป็นกันเอง ชวนซื้อ' }),
      active: h('input', { type: 'checkbox', checked: !!x.active }),
    };
    const kinds = Object.entries(KIND_TH).map(([k, t]) => { const cb = h('input', { type: 'checkbox', checked: x.kinds.split(',').includes(k), value: k }); return { cb, el: h('label', { class: 'check' }, cb, t) }; });
    const save = h('button', { class: 'btn sm primary', type: 'button', textContent: 'บันทึก' });
    save.addEventListener('click', () => guard(save, async () => {
      await api('PATCH', `/api/channels/${x.id}`, { name: f.name.value, url: f.url.value, goal: f.goal.value, times: f.times.value, photo_times: x.kind === 'fb' ? f.photo_times.value : undefined, tone: f.tone.value, active: f.active.checked, kinds: kinds.filter((k) => k.cb.checked).map((k) => k.cb.value) });
      await loadChannels(); renderChannels(); $('ch-msg').textContent = `บันทึก ${f.name.value} แล้ว ✓`;
      for (const e of cards.values()) e.stamp = 0; refresh();
    }, (e) => { $('ch-msg').textContent = e.message; }));
    const del = h('button', { class: 'btn sm danger', type: 'button', textContent: 'ลบ' });
    del.addEventListener('click', () => guard(del, async () => {
      if (!(await uiConfirm(`ลบช่องทาง “${x.name}”? (ประวัติการโพสต์และตารางของช่องทางนี้จะหายด้วย)`, { title: 'ลบช่องทาง', ok: 'ลบ', danger: true }))) return;
      await api('DELETE', `/api/channels/${x.id}`); await loadChannels(); renderChannels();
    }, (e) => { $('ch-msg').textContent = e.message; }));
    const fld = (label, el) => h('label', { class: 'field' }, label, el);
    return h('section', { class: 'ch-card' },
      h('div', { class: 'ch-card-h' }, chBadge(x), h('b', { textContent: x.name }), h('label', { class: 'check' }, f.active, 'ใช้งาน')),
      h('div', { class: 'ch-grid' }, fld('ชื่อที่แสดง', f.name), fld(x.kind === 'yt' ? 'ลิงก์ช่อง' : 'ลิงก์เพจ', f.url), fld('เป้าต่อวัน (คลิป)', f.goal), fld('เวลาลง Reels', f.times), ...(x.kind === 'fb' ? [fld('เวลาโพสต์รูป', f.photo_times)] : []), fld('สไตล์แคปชัน (โน้ต)', f.tone)),
      h('div', { class: 'row' }, h('span', { class: 'hint', textContent: 'ชนิดคลิปที่ลงช่องทางนี้:' }), ...kinds.map((k) => k.el)),
      h('div', { class: 'row' }, save, del));
  }));
}
const addChannel = (kind) => guard($(kind === 'yt' ? 'ch-add-yt' : 'ch-add-fb'), async () => {
  const name = await uiPrompt(kind === 'yt' ? 'ชื่อช่อง YouTube' : 'ชื่อเพจ Facebook', { title: 'เพิ่มช่องทาง', ok: 'เพิ่ม' });
  if (!name) return;
  await api('POST', '/api/channels', { kind, name, goal: kind === 'yt' ? 3 : 2, kinds: kind === 'yt' ? ['product', 'quick', 'story'] : ['quick'] });
  await loadChannels(); renderChannels();
}, (e) => { $('ch-msg').textContent = e.message; });
$('ch-add-fb').addEventListener('click', () => addChannel('fb'));
$('ch-add-yt').addEventListener('click', () => addChannel('yt'));
$('ch-x').addEventListener('click', () => $('channels').close());
$('ch-close').addEventListener('click', () => $('channels').close());
$('channels').addEventListener('close', () => { if (view === 'today') renderToday(); if (view === 'schedule') renderSchedule(); });

// ---------- ตารางโพสต์ ----------
const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let scDay = dayStr(new Date());
const SLOT_TH = { wait: 'รอถึงเวลา', set: 'ตั้งเวลาในเพจ/Studio แล้ว', done: 'โพสต์แล้ว', skip: 'ข้าม' };
async function renderSchedule() {
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  $('sc-days').replaceChildren(...days.map((d, i) => {
    const k = dayStr(d);
    const b = h('button', { type: 'button', 'aria-pressed': String(k === scDay), textContent: i ? d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric' }) : `วันนี้ ${d.getDate()}` });
    b.addEventListener('click', () => { scDay = k; renderSchedule(); });
    return b;
  }));
  const [sd, ready] = await Promise.all([api('GET', `/api/schedule?day=${scDay}`), api('GET', '/api/clips?sort=old&limit=200')]);
  const chs = sd.channels;
  $('sc-add-ch').replaceChildren(...chs.map((x) => h('option', { value: String(x.id), textContent: x.name })));
  const times = [...new Set(sd.slots.map((x) => x.time))].sort();
  const now = new Date(), nowT = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const isToday = scDay === dayStr(now);
  const pool = ready.items.filter((c) => (c.kind === 'photo' ? c.photo_file : c.video_file) && (c.status === 'ready' || c.status === 'posted'));
  const cell = (slot, ch) => {
    if (!slot) return h('td', { class: 'sc-none' }, h('span', { class: 'muted', textContent: '—' }));
    const dueNow = isToday && slot.time <= nowT && slot.state === 'wait';
    const isPh = slot.kind === 'photo';
    const opts = pool.filter((c) => (c.kind === 'photo') === isPh && chFits(ch, c) && (!postedOn(c, ch.id) || c.id === slot.clip_id));
    const pick = h('select', { 'aria-label': `คลิปเวลา ${slot.time} ${ch.name}` }, h('option', { value: '', textContent: opts.length ? (isPh ? '＋ เลือกโพสต์รูป' : '＋ เลือกคลิป') : (isPh ? '(ยังไม่มีโพสต์รูปพร้อม)' : '(ยังไม่มีคลิปพร้อมโพสต์)') }), ...opts.map((c) => h('option', { value: String(c.id), textContent: `${c.kind === 'photo' ? PHOTO_ICON[c.badge] || '🖼' : c.kind === 'product' ? '🛍' : '🎬'} ${c.title}`, selected: c.id === slot.clip_id })));
    pick.addEventListener('change', () => api('PATCH', `/api/schedule/${slot.id}`, { clip_id: pick.value || null }).then(renderSchedule).catch((e) => toast(e.message, true)));
    const kids = [h('span', { class: 'sc-kind', textContent: isPh ? '🖼 โพสต์รูป' : '🎬 Reels' }), pick];
    if (slot.clip_id) {
      kids.push(h('span', { class: `sc-st ${dueNow ? 'due' : slot.state}`, textContent: dueNow ? 'ถึงเวลาแล้ว — โพสต์เลย' : SLOT_TH[slot.state] }));
      const row = h('div', { class: 'row' });
      if (slot.state !== 'done') {
        const go = h('button', { class: `btn sm${dueNow ? ' primary' : ''}`, type: 'button', textContent: '📤 โพสต์' });
        go.addEventListener('click', () => openPostPanel(slot.clip_id, ch.id));
        const set = h('button', { class: 'btn sm ghost', type: 'button', textContent: slot.state === 'set' ? '↩ ยังไม่ได้ตั้ง' : 'ตั้งเวลาแล้ว', title: 'ตั้งเวลาโพสต์ใน Meta Business Suite / YouTube Studio เองแล้ว' });
        set.addEventListener('click', () => api('PATCH', `/api/schedule/${slot.id}`, { state: slot.state === 'set' ? 'wait' : 'set' }).then(renderSchedule));
        row.append(go, set);
      }
      kids.push(row);
    }
    const rm = h('button', { class: 'linkbtn sc-rm', type: 'button', textContent: 'ลบช่องนี้', title: 'ลบเวลานี้ออกจากวันนี้' });
    rm.addEventListener('click', () => api('DELETE', `/api/schedule/${slot.id}`).then(renderSchedule));
    kids.push(rm);
    return h('td', { class: `sc-cell ${slot.state}${dueNow ? ' due' : ''}` }, ...kids);
  };
  $('sc-table').replaceChildren(
    h('thead', {}, h('tr', {}, h('th', { textContent: 'เวลา' }), ...chs.map((x) => h('th', {}, chBadge(x), ` ${x.name}`)))),
    h('tbody', {}, ...(times.length ? times.map((t) => h('tr', { class: sd.slots.some((s) => s.time === t && s.kind === 'photo') ? 'sc-photo' : '' }, h('th', { textContent: t }), ...chs.map((x) => cell(sd.slots.find((s) => s.time === t && s.channel_id === x.id), x))))
      : [h('tr', {}, h('td', { colSpan: chs.length + 1, class: 'muted', textContent: 'ยังไม่มีเวลาโพสต์ — กด “ช่องทาง / เวลาประจำ” เพื่อตั้งเวลา หรือเพิ่มช่องด้านล่าง' }))])));
  renderDue();
}
$('sc-fill').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  const r = await api('POST', '/api/schedule/autofill', { day: scDay });
  toast(r.filled ? `จัดคลิปลง ${r.filled} ช่องแล้ว` : 'ไม่มีคลิปพร้อมโพสต์ที่ใส่ได้ (หรือช่องเต็มแล้ว)');
  await renderSchedule();
}));
$('sc-channels').addEventListener('click', () => openChannels());
$('sc-add').addEventListener('click', (e) => guard(e.currentTarget, async () => {
  await api('POST', '/api/schedule', { channel_id: Number($('sc-add-ch').value), day: scDay, time: $('sc-add-t').value });
  await renderSchedule();
}));

// แจ้งเตือนเมื่อถึงเวลาโพสต์ (เช็กทุก 1 นาทีขณะเปิดหน้าเว็บ)
let dueList = [];
const dueSeen = new Set();
async function checkDue() {
  try { dueList = await api('GET', '/api/schedule/due'); } catch { return; }
  renderDue();
  for (const d of dueList) {
    const k = `${d.id}`;
    if (dueSeen.has(k)) continue;
    dueSeen.add(k);
    toast(`ถึงเวลาโพสต์ ${d.time} · ${d.channel_name}${d.clip_title ? ` — ${d.clip_title}` : ' (ยังไม่ได้เลือกคลิป)'}`);
  }
}
function renderDue() {
  $('tab-due').hidden = !dueList.length;
  for (const id of ['sc-due', 'td-due']) {
    const box = $(id);
    box.hidden = !dueList.length;
    box.replaceChildren(...dueList.slice(0, 3).map((d) => {
      const b = h('button', { class: 'btn sm primary', type: 'button', textContent: d.clip_id ? 'เปิดแผงโพสต์' : 'เลือกคลิป' });
      b.addEventListener('click', () => { if (d.clip_id) openPostPanel(d.clip_id, d.channel_id); else location.hash = 'schedule'; });
      return h('div', { class: 'due-row' }, h('span', { class: 'dot' }), h('span', {}, h('b', { textContent: `ถึงเวลาแล้ว ${d.time} · ${d.channel_name}` }), d.clip_title ? ` — ${d.clip_title}` : ' — ยังไม่ได้เลือกคลิป'), b);
    }));
  }
}
setInterval(checkDue, 60_000);
$('td-kw').value = pfRecentList()[0] || 'ของใช้ในบ้าน';
$('td-kw-go').addEventListener('click', () => { $('pf-kw').value = $('td-kw').value.trim() || 'ของใช้ในบ้าน'; $('pf-go').click(); toast('เปิด Shopee Affiliate แล้ว — ค้นในแผง Arn Reels มุมขวาล่าง'); });
$('td-kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('td-kw-go').click(); } });
for (const b of document.querySelectorAll('[data-quick]')) b.addEventListener('click', () => { location.hash = 'create'; const m = $('mode').querySelector(`[data-m="${b.dataset.quick}"]`); if (m) m.click(); });

loadStatus().then(loadChannels).then(refresh).then(checkDue).then(promptLoginOnce).catch((e) => say(e.message));
