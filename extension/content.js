// Content script บน meta.ai — แผง “Arn Reels” มุมขวาล่าง (ระดับ 2: คุณกดสร้างเองทุกครั้ง)
//  1) ดึงช็อตถัดไปจาก Arn Reels → วาง prompt ลงช่องพิมพ์ของ Meta AI (ไม่กดส่งให้)
//  2) คุณกดสร้างใน Meta AI เอง
//  3) พอมีวิดีโอใหม่ขึ้นในหน้า แผงจะโชว์ตัวเลือก → คุณกด “ส่งเข้าช็อต” แล้วไฟล์จะถูกแนบกับช็อตนั้นใน Arn Reels
// ไม่กดปุ่มใด ๆ ของ Meta AI แทนคุณ ไม่อ่านแชต/ข้อมูลส่วนตัว ไม่ส่งอะไรออกนอกเครื่องนี้ (ยกเว้นดึงไฟล์วิดีโอจาก CDN ของ Meta ที่คุณเลือกส่ง)
// หมายเหตุ: โครงหน้าเว็บของ Meta AI เปลี่ยนได้เสมอ จึงหา “ช่องพิมพ์” และ “วิดีโอ” แบบกว้าง ๆ และมีปุ่ม “ตรวจหน้า” ไว้ดูว่าเจออะไร
(() => {
  if (window.__arnReelsLoaded) return;
  window.__arnReelsLoaded = true;

  const send = (type, extra = {}) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...extra }, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (r && r.ok) resolve(r.data); else reject(new Error((r && r.error) || 'ไม่มีคำตอบจากส่วนเสริม'));
    });
  });

  const st = {
    open: true, projects: [], projectId: null, next: null, msg: '', bad: false,
    waiting: false, baseline: new Set(), sent: new Set(), skipped: new Set(), cands: [], diag: '',
    auto: false, busy: false, seen: new Map(), mode: 'story', pq: null, pAuto: false, // pAuto = โหมดคลิปสินค้าอัตโนมัติ (เจ้าของเปิดเอง 1 พ.ย.): กดส่งให้ + ส่งวิดีโอกลับเอง + ทำชิ้นถัดไปในแชทใหม่ // mode: story = ช็อตของโปรเจกต์เรื่อง | product = คิวคลิปสินค้า; pq = คิวคลิปสินค้าจาก Arn Reels
    // auto = ส่งรูปเข้าช็อตเองเมื่อรูปนิ่งแล้ว (เปิดเอง ค่าเริ่มต้นปิด); seen = src → เวลาที่เห็นครั้งแรก
  };
  const setState = (s, extra = {}) => { host.dataset.state = s; for (const [k, v] of Object.entries(extra)) host.dataset[k] = String(v); }; // ให้ผู้ช่วย AI อ่านสถานะจาก DOM ได้

  // ---------- UI (shadow DOM กันสไตล์ชนกับหน้า Meta AI) ----------
  const host = document.createElement('div');
  host.id = 'arn-reels-host';
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('style');
  css.textContent = `
    * { box-sizing: border-box; font-family: "Leelawadee UI", Tahoma, sans-serif; }
    .box { width: 340px; max-height: 82vh; overflow: auto; background: #12152a; color: #e8eaf6; border: 1px solid #3b4170; border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.5); font-size: 13.5px; line-height: 1.5; }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; background: #1a1e3a; border-radius: 14px; font-weight: 700; }
    .box.open .head { border-radius: 14px 14px 0 0; }
    .head .t { flex: 1; } .body { padding: 10px 12px 12px; display: grid; gap: 8px; }
    select, textarea { width: 100%; background: #0c0e1d; color: #fff; border: 1px solid #343a5c; border-radius: 8px; padding: 6px 8px; font-size: 13px; }
    textarea { min-height: 96px; resize: vertical; }
    button { font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 1px solid #4a5190; background: #222750; color: #e8eaf6; cursor: pointer; }
    button.p { background: #7c83ff; border-color: #7c83ff; color: #0d0f24; font-weight: 700; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .hint { color: #9aa0c8; font-size: 12px; } .ok { color: #7be0a0; } .bad { color: #ff9b9b; }
    .cand { display: flex; gap: 8px; align-items: center; background: #0c0e1d; border: 1px solid #343a5c; border-radius: 10px; padding: 6px; }
    .cand canvas { width: 54px; height: 72px; border-radius: 6px; background: #000; object-fit: cover; }
    .cand .info { flex: 1; font-size: 12px; } pre { white-space: pre-wrap; word-break: break-all; font-size: 11px; background: #0c0e1d; padding: 6px; border-radius: 6px; max-height: 160px; overflow: auto; margin: 0; }
  `;
  const box = document.createElement('div');
  box.className = 'box open';
  shadow.append(css, box);
  document.documentElement.append(host);

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n[k] = v;
    }
    n.append(...kids);
    return n;
  };
  const setMsg = (text, bad = false) => { st.msg = text; st.bad = bad; render(); };
  const guard = (btn, fn) => async () => {
    btn.disabled = true;
    try { await fn(); } catch (e) { setMsg(e.message, true); } finally { btn.disabled = false; }
  };

  // ---------- หา "ช่องพิมพ์" และ "วิดีโอ" ในหน้า ----------
  const visible = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 40 && r.height > 16 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  function findPromptBox() {
    const list = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable=""], [contenteditable="true"], [role="textbox"]')]
      .filter((e) => !host.contains(e) && visible(e) && !e.readOnly && !e.disabled);
    list.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom || b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    return list[0] || null; // ช่องแชตมักอยู่ล่างสุดของหน้า
  }
  function setText(box, text) {
    box.focus();
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
      const proto = box.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      try { const dt = new DataTransfer(); dt.setData('text/plain', text); box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); } catch { /* ลองวิธีถัดไป */ }
      if (promptHas(box, text)) return true;
      const sel = getSelection(), range = document.createRange();
      range.selectNodeContents(box);
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('insertText', false, text);
      if (!(box.textContent || '').includes(text.slice(0, 20))) {
        box.textContent = text;
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
    return promptHas(box, text);
  }
  // อ่านกลับว่าในช่องมีหัว prompt จริง (เรียนจาก Pondy: เช็ก 30 ตัวแรก ห้ามเชื่อว่าวางลงช่องที่ถูก)
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  function promptHas(box, text) {
    const now = box.value !== undefined ? box.value : box.innerText || box.textContent;
    return norm(now).includes(norm(text).slice(0, 30));
  }
  const srcOf = (v) => v.currentSrc || v.src || (v.querySelector && v.querySelector('source') && v.querySelector('source').src) || '';
  // โปรเจกต์แบบ "ภาพนิ่ง" → มองหารูปใหญ่ (≥400px) ที่เพิ่งขึ้นในหน้า แทนวิดีโอ
  const stillMode = () => st.mode !== 'product' && !!(st.next && st.next.project && st.next.project.media === 'image');
  const noun = () => (stillMode() ? 'รูป' : 'วิดีโอ');
  const isGemini = location.hostname === 'gemini.google.com';
  const site = isGemini ? 'Gemini' : /(^|\.)google\.com$/.test(location.hostname) ? 'Google Flow' : 'Meta AI'; // ใช้ในข้อความบนแผง และเลือกวิธีเตรียม prompt
  const bigImg = (i) => i.complete && i.naturalWidth >= 400 && i.naturalHeight >= 400 && !/^data:/.test(i.currentSrc || i.src);
  const pageVideos = () => (stillMode()
    ? [...document.querySelectorAll('img')].filter((i) => !host.contains(i) && srcOf(i) && bigImg(i))
    : [...document.querySelectorAll('video')].filter((v) => !host.contains(v) && srcOf(v)));
  // เดาชนิดไฟล์จากไบต์แรก (ไม่เชื่อ content-type ของ CDN) — เซิร์ฟเวอร์ตรวจลายเซ็นอีกชั้น
  function sniffMime(b64, fallback) {
    const b = atob(b64.slice(0, 24));
    if (b.startsWith('\x89PNG')) return 'image/png';
    if (b.charCodeAt(0) === 0xff && b.charCodeAt(1) === 0xd8) return 'image/jpeg';
    if (b.startsWith('RIFF') && b.slice(8, 12) === 'WEBP') return 'image/webp';
    if (b.slice(4, 8) === 'ftyp') return 'video/mp4';
    if (b.charCodeAt(0) === 0x1a && b.charCodeAt(1) === 0x45) return 'video/webm';
    return fallback;
  }

  // ---------- ขั้นตอนหลัก ----------
  async function loadProjects() {
    const state = await send('getState');
    st.projects = await send('projects');
    st.projectId = (st.projects.find((p) => p.id === state.projectId) || st.projects.find((p) => p.done < p.shots) || st.projects[0] || {}).id || null;
    if (st.projectId) await loadNext(); else { st.next = null; render(); }
  }
  async function loadNext() {
    st.next = st.projectId ? await send('next', { projectId: st.projectId }) : null;
    render();
  }

  // Gemini: ตัดคำบรรยายไทยออก (กันภาพมีตัวอักษร) และขึ้นต้นสั่งสร้างรูป 9:16 — ข้อความอื่นคงเดิม
  const promptFor = (shot) => (isGemini
    ? 'Generate one vertical 9:16 image: ' + String(shot.prompt)
      .replace(/\s*Narration in Thai:\s*"[^"]*"\.?/g, '')
      .replace(/Look:\s*Each panel must be clearly separated and visually readable\.\s*/g, '')
      .replace(/\s+/g, ' ').trim()
    : shot.prompt);
  async function fillPrompt() {
    const shot = st.next && st.next.shot;
    if (!shot) throw new Error('ไม่มีช็อตที่ต้องสร้างแล้ว');
    const text = promptFor(shot);
    pageVideos().forEach((v) => st.baseline.add(srcOf(v))); // วิดีโอ/รูปที่มีอยู่ก่อนหน้านี้ ไม่นับเป็นผลของช็อตนี้
    st.cands = []; st.waiting = true; startScan();
    const box = findPromptBox();
    if (box && setText(box, text)) { setState('filled', { shot: shot.position }); return setMsg(`วาง prompt ช็อตที่ ${shot.position} แล้ว — ตรวจข้อความแล้วกดสร้างใน ${site} ได้เลย`); }
    await navigator.clipboard.writeText(text).catch(() => {});
    setMsg(`วางลงช่องอัตโนมัติไม่ได้ — คัดลอก prompt ไว้แล้ว กด Ctrl+V ในช่องพิมพ์ของ ${site} (กด “ตรวจหน้า” ถ้าอยากให้ผมปรับให้ตรงหน้านี้)`, true);
  }

  const STABLE_MS = 8000; // โหมดอัตโนมัติ: รูปต้องนิ่งกี่มิลลิวินาทีก่อนส่ง
  let timer = null;
  function startScan() {
    clearInterval(timer);
    timer = setInterval(scan, 2000);
    scan();
  }
  function scan() {
    if (!st.waiting) return;
    const found = pageVideos().filter((v) => {
      const s = srcOf(v);
      return !st.baseline.has(s) && !st.sent.has(s) && !st.skipped.has(s) && (stillMode() || (v.readyState >= 1 && v.duration > 0.5));
    });
    if (st.mode === 'product') productWatch(found);
    const key = (a) => a.map((v) => srcOf(v)).join('|');
    if (key(found) !== key(st.cands)) { st.cands = found; render(); }
    else drawThumbs();
    // ส่งเองเมื่อเปิดโหมดอัตโนมัติ: รูปล่าสุดต้องอยู่นิ่ง (src เดิม) นานพอ กันส่งรูปตัวอย่างที่ยังไม่เสร็จ
    const now = Date.now();
    found.forEach((v) => { const s = srcOf(v); if (!st.seen.has(s)) st.seen.set(s, now); });
    if (st.auto && stillMode() && found.length && !st.busy) {
      const last = found[found.length - 1];
      if (now - st.seen.get(srcOf(last)) >= STABLE_MS) {
        st.busy = true;
        sendVideo(last).catch((e) => { setState('error'); setMsg(e.message, true); }).finally(() => { st.busy = false; });
      }
    }
  }

  // โหมดคลิปสินค้า: แยกกรณีที่ไม่ได้วิดีโอ อย่ารอจนหมดเวลา (Pondy §2)
  function productWatch(found) {
    if (!st.filledAt) return;
    const age = Date.now() - st.filledAt;
    // อัตโนมัติ: วิดีโอที่เล่นได้ ยาว 3–60 วิ และนิ่ง (src เดิม) ≥ 6 วิ → ส่งเข้า Arn Reels เอง แล้วทำชิ้นถัดไป
    if (st.pAuto && found.length && !st.busy) {
      const v = found[found.length - 1], first = st.seen.get(srcOf(v)) || Date.now();
      if (v.readyState >= 3 && v.duration >= 3 && v.duration <= 60 && Date.now() - first >= 6000) {
        st.busy = true;
        sendProductVideo(v).then(() => {
          if (st.pAuto && st.pq && st.pq.next) setTimeout(() => { try { openFreshAndFill(); } catch (e) { setMsg(e.message, true); } }, 4000 + Math.random() * 4000);
        }).catch((e) => { setState('error'); setMsg(e.message, true); }).finally(() => { st.busy = false; });
        return;
      }
    }
    let w = '';
    if (found.length) w = '';
    else {
      const tail = tailText();
      const fresh = tail !== st.tail0 ? tail.slice(-600) : '';
      const bigImgs = shownImgs(220);
      if (fresh && REFUSE.test(fresh) && age > 15000) w = '⚠ Meta AI ตอบเป็นข้อความแทนวิดีโอ — มักเป็นโควต้าวิดีโอเต็มชั่วคราว รอ ~10 นาทีแล้วกด “🆕 แชทใหม่แล้ววาง”';
      else if (bigImgs > st.imgs0 && age > 90000) w = '⚠ ได้เป็นรูปนิ่ง ไม่ใช่วิดีโอ — เปิดแชทใหม่แล้ววางอีกครั้ง (ดูว่าเลือกโหมดวิดีโอ)';
      else if (age > 8 * 60000) w = '⚠ เกิน 8 นาทียังไม่มีวิดีโอ — ถ้ารูปยังหมุนอัปโหลดค้าง ให้เปิดแชทใหม่แล้ววางอีกครั้ง';
    }
    if (w !== st.warn) { st.warn = w; if (w) setState('no-video', { why: w.slice(2, 30) }); render(); }
  }

  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    r.readAsDataURL(blob);
  });

  // ดึงไฟล์ของวิดีโอ/รูปในหน้า → { mime, b64 } (ใช้ร่วมกันทั้งโหมดเรื่องและโหมดคลิปสินค้า)
  async function grabMedia(v) {
    const src = srcOf(v);
    let mime, b64;
    const sameOrigin = src.startsWith('blob:') || new URL(src, location.href).origin === location.origin;
    if (sameOrigin) {
      let blob;
      try { blob = await (await fetch(src)).blob(); } catch (e) {
        // หน้าเว็บบางหน้า (เช่น Gemini) บล็อก fetch ของ blob — รูปนิ่งวาดลงผืนผ้าใบแล้วเก็บเป็น PNG แทน
        if (v.tagName !== 'IMG') throw e;
        const cv = document.createElement('canvas'); cv.width = v.naturalWidth; cv.height = v.naturalHeight;
        cv.getContext('2d').drawImage(v, 0, 0);
        blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
        if (!blob) throw new Error('ดึงรูปจากหน้านี้ไม่ได้');
      }
      if (blob.size > 45_000_000) throw new Error(`${noun()}ใหญ่เกิน 45MB — ดาวน์โหลดแล้วแนบเองในหน้าโปรเจกต์แทน`);
      mime = blob.type.split(';')[0];
      b64 = await blobToB64(blob);
    } else {
      ({ mime, b64 } = await send('fetchRemote', { url: src }));
    }
    mime = sniffMime(b64, /^(video\/(mp4|webm)|image\/(png|jpeg|webp))$/.test(mime) ? mime : stillMode() ? 'image/jpeg' : 'video/mp4');
    return { mime, b64 };
  }

  async function sendVideo(v) {
    if (st.mode === 'product') return sendProductVideo(v);
    const shot = st.next && st.next.shot;
    if (!shot) throw new Error('ไม่มีช็อตปลายทาง');
    const src = srcOf(v);
    setMsg(`กำลังดึง${noun()}…`);
    const { mime, b64 } = await grabMedia(v);
    setMsg('กำลังส่งเข้า Arn Reels…');
    const res = await send('upload', { shotId: shot.id, mime, b64 });
    st.sent.add(src); st.cands = []; st.waiting = false; clearInterval(timer);
    setState('sent', { shot: shot.position, done: res.done, total: res.total });
    st.next = res;
    const pr = st.projects.find((p) => p.id === st.projectId);
    if (pr) pr.done = res.done; // ตัวเลขในรายการโปรเจกต์ขยับตาม
    const nx = res.shot;
    setMsg(`ส่งเข้าช็อตที่ ${shot.position} แล้ว ✓ ${nx ? `— ถัดไปช็อตที่ ${nx.position} กด “วาง prompt” ต่อได้` : '— ครบทุกช็อตแล้ว ไปรวมคลิปในหน้าโปรเจกต์ได้เลย'}`);
  }

  // ---------- โหมดคลิปสินค้า ----------
  // คิวจาก Arn Reels: คลิปสินค้าที่ยังไม่มีวิดีโอ → วาง prompt + แนบรูปสินค้า/รูปอ้างอิงตัวอักษร → คุณกดสร้างเอง → ส่งวิดีโอกลับ
  async function loadProductQueue() {
    st.pq = await send('productNext');
    render();
  }
  const b64ToFile = (b64, mime, name) => {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], name, { type: mime });
  };
  async function productFiles() {
    const job = st.pq && st.pq.next;
    if (!job) return [];
    const out = [], stamp = Date.now().toString(36); // ชื่อไฟล์ใหม่ทุกครั้ง กันเว็บหยิบรูปที่ cache ไว้ของสินค้าก่อน (Pondy)
    for (const [i, im] of job.images.entries()) {
      const { mime, b64 } = await send('productImage', { file: im.file });
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      out.push(b64ToFile(b64, mime, `${i === 0 ? 'product' : 'typography'}-${job.clip.id}-${stamp}.${ext}`));
    }
    return out;
  }
  // แนบไฟล์ลงช่องของหน้าเว็บ: ช่องเลือกไฟล์ที่รับรูป → ถ้าไม่มี ลอง "วาง" และ "ลากวาง" ลงช่องพิมพ์ (ยืนยันผลไม่ได้ 100% ให้ผู้ใช้ดูเอง)
  function attachFiles(files) {
    if (!files.length) return 'none';
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    const input = [...document.querySelectorAll('input[type="file"]')].filter((e) => !host.contains(e) && !e.disabled)
      .sort((a, b) => Number(/image/.test(b.accept || 'image')) - Number(/image/.test(a.accept || 'image')))[0];
    if (input) {
      try {
        input.files = input.multiple ? dt.files : (() => { const one = new DataTransfer(); one.items.add(files[0]); return one.files; })();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return input.multiple || files.length === 1 ? 'input' : 'input-first';
      } catch { /* ลองวิธีถัดไป */ }
    }
    const box = findPromptBox();
    if (!box) return 'fail';
    box.focus();
    try { box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return 'paste'; } catch { /* ลองลากวาง */ }
    try { for (const t of ['dragenter', 'dragover', 'drop']) box.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); return 'drop'; } catch { return 'fail'; }
  }
  function downloadFiles(files) {
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    }
  }
  // ขนาดที่แสดงจริงบนจอ (โลโก้ SVG ของ Meta มี naturalWidth 800 แต่แสดงแค่ 30px — ห้ามนับเป็นสื่อ)
  const shown = (i, min) => { const r = i.getBoundingClientRect(); return r.width >= min && r.height >= min; };
  const shownImgs = (min) => [...document.querySelectorAll('img')].filter((i) => !host.contains(i) && shown(i, min)).length;
  // คัดลอกลงคลิปบอร์ดแบบมีเพดานเวลา (writeText ค้างได้ถ้าหน้าไม่ได้โฟกัส — เจอจริง 1 พ.ย.)
  const copyText = (t) => Promise.race([navigator.clipboard.writeText(t).then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 1500))]);
  // ปุ่มส่งของช่องแชต (โหมดอัตโนมัติเท่านั้น): ปุ่มที่มีป้าย ส่ง/Send ใกล้ช่องพิมพ์ ไม่ถูกปิด
  function findSendButton() {
    const box = findPromptBox(), comp = composerOf(box);
    const scope = comp ? (comp.parentElement || comp) : document;
    const btns = [...scope.querySelectorAll('button,[role="button"]')].filter((b) => !host.contains(b) && visible2(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    return btns.find((b) => /^(ส่ง|send|submit)/i.test((b.getAttribute('aria-label') || b.title || '').trim()))
      || btns.filter((b) => b.querySelector('svg') && !(b.innerText || '').trim()).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0] || null;
  }
  const visible2 = (e) => { const r = e.getBoundingClientRect(); return r.width > 10 && r.height > 10 && getComputedStyle(e).visibility !== 'hidden'; };

  // ---- ตรวจแบบ Pondy: แชทต้องว่าง / รูปต้องติดในช่อง / ตอบเป็นข้อความหรือรูปแทนวิดีโอ ----
  // สื่อเก่าในแชท (วิดีโอ หรือรูปใหญ่ที่ไม่ใช่รูปในช่องแนบ) → อาจหยิบคลิปของสินค้าก่อนหน้า
  function oldMedia() {
    const box = findPromptBox(), comp = composerOf(box);
    const vids = [...document.querySelectorAll('video')].filter((v) => !host.contains(v) && srcOf(v));
    const imgs = [...document.querySelectorAll('img')].filter((i) => !host.contains(i) && shown(i, 150) && !(comp && comp.contains(i)));
    return vids.length + imgs.length;
  }
  // กล่องที่ครอบช่องพิมพ์ (ปีนขึ้นไปจนเจอ form หรือไม่เกิน 6 ชั้น) — รูปที่แนบจะโผล่เป็น thumbnail ในนี้
  function composerOf(box) {
    if (!box) return null;
    let n = box;
    for (let i = 0; i < 6 && n.parentElement; i++) { n = n.parentElement; if (n.tagName === 'FORM') break; }
    return n;
  }
  const thumbsIn = (comp) => (comp ? [...comp.querySelectorAll('img')].filter((i) => !host.contains(i) && (/^(blob:|data:)/.test(i.currentSrc || i.src) || (i.naturalWidth > 20 && i.naturalWidth < 400 && !!i.closest('[role="button"],button,figure,li')))).length : 0);
  async function waitThumbs(comp, before, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (thumbsIn(comp) > before) return true; await new Promise((r) => setTimeout(r, 400)); }
    return false;
  }
  const newChatUrl = () => (site === 'Meta AI' ? `${location.origin}/` : null);
  // เปิดแชทใหม่ (โหลดหน้าแรกของ Meta AI ใหม่ทั้งหน้า) แล้ววางให้เองหลังโหลดเสร็จ — ไม่กดสร้างให้
  function openFreshAndFill() {
    const job = st.pq && st.pq.next, url = newChatUrl();
    if (!job || !url) throw new Error('เปิดแชทใหม่เองในหน้านี้ แล้วกดวางอีกครั้ง');
    try { sessionStorage.setItem('arnFillClip', String(job.clip.id)); } catch { /* ไม่เป็นไร */ }
    location.assign(url);
  }
  // คำตอบที่ไม่ใช่วิดีโอ (Pondy: Meta ตอบเป็นข้อความ = โควต้าวิดีโอเต็มชั่วคราว รอ ~10 นาที)
  const REFUSE = /ขออภัย|ขัดข้อง|ไม่สามารถสร้าง|ลองใหม่ภายหลัง|sorry|I can.t|I.m unable|unable to (create|generate)|isn.t available for your account|try again later|limit/i;
  function tailText() { return norm((document.querySelector('main') || document.body).innerText).slice(-1500); }

  async function fillProduct(opts = {}) {
    const job = st.pq && st.pq.next;
    if (!job) throw new Error('ไม่มีคลิปสินค้าในคิวแล้ว');
    // 1) แชทต้องว่าง — มีสื่อเก่า = เสี่ยงได้คลิปผิดสินค้า (กับดักข้อ 1 ของ Pondy)
    const old = oldMedia();
    if (old && !opts.force) {
      st.needFresh = true;
      setState('chat-not-empty', { media: old });
      setMsg(`แชทนี้มีรูป/วิดีโอเก่า ${old} ชิ้น — กด “🆕 แชทใหม่แล้ววาง” กันได้คลิปของสินค้าก่อนหน้า (หรือ “วางในแชทนี้” ถ้าแน่ใจ)`, true);
      return;
    }
    st.needFresh = false;
    pageVideos().forEach((v) => st.baseline.add(srcOf(v)));
    st.cands = []; st.waiting = true; st.filledClip = job.clip.id; st.filledAt = Date.now(); st.tail0 = tailText(); st.warn = ''; st.imgs0 = shownImgs(220); startScan();
    setMsg('กำลังเตรียมรูปสินค้า…');
    const files = await productFiles();
    let box = findPromptBox();
    const comp = composerOf(box), before = thumbsIn(comp);
    const how = attachFiles(files);
    const seen = files.length && how !== 'fail' ? await waitThumbs(comp, before) : false; // รอให้ thumbnail ขึ้น (ไม่เกิน 8 วิ)
    await new Promise((r) => setTimeout(r, 600)); // บางหน้าล้างช่องพิมพ์ตอนแนบไฟล์ → วางข้อความทีหลัง
    box = findPromptBox();
    let textOk = !!(box && setText(box, job.prompt));
    if (box && !textOk) { await new Promise((r) => setTimeout(r, 800)); textOk = setText(box, job.prompt); } // ลองอีกรอบ (แทนที่ ไม่ต่อท้าย)
    if (!textOk) await copyText(job.prompt);
    const still = seen ? thumbsIn(composerOf(findPromptBox())) > before : false; // วางข้อความแล้วรูปยังติดอยู่ไหม
    setState('filled', { clip: job.clip.id, text: textOk, img: still ? 'ok' : seen ? 'lost' : how });
    const imgNote = !files.length ? '⚠ สินค้านี้ยังไม่มีรูป — ใส่รูปในคลังสินค้าของ Arn Reels จะได้ภาพตรงสินค้า'
      : how === 'fail' ? '⚠ แนบรูปอัตโนมัติไม่ได้ — กด “⬇ ดาวน์โหลดรูป” แล้วลากใส่ช่องเอง'
        : seen && !still ? '⚠ รูปหายจากช่องหลังวางข้อความ — ลากรูปใส่ใหม่ (กด “⬇ ดาวน์โหลดรูป”)'
          : still ? `เห็นรูปในช่องแล้ว ✓${how === 'input-first' ? ' (แนบได้แค่รูปแรก รูปอ้างอิงลากใส่เอง)' : ''}`
            : `แนบรูป ${files.length} รูปแล้ว แต่ยังไม่เห็นในช่อง — ดูให้แน่ใจ ถ้าไม่ขึ้นกด “⬇ ดาวน์โหลดรูป” แล้วลากใส่เอง`;
    const bad = !textOk || how === 'fail' || (seen && !still);
    if (st.pAuto && !opts.noSend) {
      if (bad || !files.length) { setMsg(`โหมดอัตโนมัติหยุด: ${!textOk ? 'วาง prompt ไม่ได้' : 'รูปไม่ติดในช่อง'} — แก้แล้วกดสร้างเอง`, true); return; }
      await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1500));
      const btn = findSendButton();
      if (!btn) { setMsg('โหมดอัตโนมัติ: ไม่เจอปุ่มส่งของ Meta AI — กดส่งเองได้ แผงจะรับวิดีโอให้', true); return; }
      btn.click();
      st.filledAt = Date.now(); st.tail0 = tailText();
      setState('generating', { clip: job.clip.id });
      setMsg(`🤖 ส่งให้ Meta AI แล้ว — รอวิดีโอ (ปกติ ~1–3 นาที) แล้วจะส่งเข้า Arn Reels เอง`);
      return;
    }
    setMsg(`${textOk ? 'วาง prompt แล้ว (อ่านกลับตรง ✓)' : 'วาง prompt ไม่ได้ — คัดลอกไว้แล้ว กด Ctrl+V'} · ${imgNote} · ตรวจแล้วกดสร้างใน ${site} เอง`, bad);
  }
  async function sendProductVideo(v) {
    const job = st.pq && st.pq.next;
    if (!job) throw new Error('ไม่มีคลิปสินค้าปลายทาง');
    if (st.filledClip && st.filledClip !== job.clip.id) throw new Error('คิวเปลี่ยนไปหลังวาง prompt — กด ↻ แล้ววางใหม่ กันวิดีโอเข้าผิดคลิป');
    if (v.tagName === 'VIDEO' && !(v.duration >= 3 && v.duration <= 60)) throw new Error(`วิดีโอนี้ยาว ${Math.round(v.duration || 0)} วิ — ยังเรนเดอร์ไม่เสร็จหรือไม่ใช่คลิปที่สั่ง`);
    const src = srcOf(v);
    setMsg('กำลังดึงวิดีโอ…');
    const { mime, b64 } = await grabMedia(v);
    if (!/^video\//.test(mime)) throw new Error('ไฟล์นี้ไม่ใช่วิดีโอ');
    setMsg('กำลังส่งเข้า Arn Reels…');
    const res = await send('uploadRaw', { clipId: job.clip.id, mime, b64 });
    st.sent.add(src); st.cands = []; st.waiting = false; st.filledClip = null; st.warn = ''; clearInterval(timer);
    setState('sent', { clip: job.clip.id });
    st.pq = res;
    setMsg(`ส่ง “${job.clip.title}” เข้า Arn Reels แล้ว ✓ ${res.next ? `— ถัดไป “${res.next.clip.title}” กด “วาง prompt + แนบรูป” ต่อได้` : '— ครบคิวแล้ว กลับไปกด “ใส่ข้อความ + ทำคลิปเสร็จ” ในคลัง Arn Reels'}`);
  }

  async function diagnose() {
    const edit = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable=""], [contenteditable="true"], [role="textbox"]')]
      .filter((e) => !host.contains(e)).slice(0, 8)
      .map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : ''}${e.isContentEditable ? '[editable]' : ''} visible=${visible(e)} ph=${(e.getAttribute('placeholder') || e.getAttribute('aria-label') || '').slice(0, 40)}`);
    const vids = [...document.querySelectorAll('video')].filter((v) => !host.contains(v))
      .map((v) => `video src=${srcOf(v) ? new URL(srcOf(v), location.href).host : '(none)'} dur=${Math.round(v.duration || 0)} ready=${v.readyState}`)
      .concat([...document.querySelectorAll('img')].filter((i) => !host.contains(i) && i.naturalWidth >= 300)
        .map((i) => `img ${i.naturalWidth}x${i.naturalHeight} src=${srcOf(i) ? new URL(srcOf(i), location.href).host : '(none)'}`).slice(0, 8));
    const btns = [...document.querySelectorAll('button, [role="button"]')].filter((b) => !host.contains(b) && /send|generate|submit|create|animate|สร้าง|ส่ง/i.test(`${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`)).slice(0, 6)
      .map((b) => `${b.tagName.toLowerCase()} "${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)}"`);
    const files = [...document.querySelectorAll('input[type="file"]')].filter((e) => !host.contains(e)).slice(0, 6).map((e) => `input[file] accept=${e.accept || '*'} multiple=${e.multiple}`);
    st.diag = [`หน้า: ${location.host}${location.pathname}`, `ช่องแนบไฟล์ (${files.length}):`, ...files, `ช่องพิมพ์ที่พบ (${edit.length}):`, ...edit, `วิดีโอในหน้า (${vids.length}):`, ...vids, `ปุ่มที่ดูเหมือนส่ง/สร้าง (${btns.length}):`, ...btns].join('\n');
    render();
  }

  // ---------- วาด UI ----------
  function drawThumbs() {
    box.querySelectorAll('canvas[data-i]').forEach((c) => {
      const v = st.cands[Number(c.dataset.i)];
      if (!v || (v.readyState !== undefined && v.readyState < 2)) return;
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch { /* ข้ามถ้าวาดไม่ได้ */ }
    });
  }

  function render() {
    box.className = `box${st.open ? ' open' : ''}`;
    const toggle = el('div', { class: 'head', onclick: () => { st.open = !st.open; render(); } }, el('span', { class: 't', textContent: '🎞 Arn Reels' }), el('span', { textContent: st.open ? '▾' : '▸' }));
    const kids = [toggle];
    if (st.open) {
      const body = el('div', { class: 'body' });
      const setMode = (m) => async () => { st.mode = m; st.msg = ''; st.cands = []; st.waiting = false; chrome.storage.local.set({ mode: m }).catch(() => {}); render(); if (m === 'product') await loadProductQueue().catch((e) => setMsg(e.message, true)); };
      const mStory = el('button', { textContent: '🎞 เรื่อง', class: st.mode === 'story' ? 'p' : '', onclick: () => setMode('story')() });
      const mProd = el('button', { textContent: '🛍 คลิปสินค้า', class: st.mode === 'product' ? 'p' : '', onclick: () => setMode('product')() });
      body.append(el('div', { class: 'row' }, mStory, mProd));
      if (st.mode === 'product') { renderProduct(body); kids.push(body); box.replaceChildren(...kids); drawThumbs(); return; }
      const sel = el('select', { onchange: async () => { st.projectId = Number(sel.value); await send('setProject', { projectId: st.projectId }).catch(() => {}); await loadNext().catch((e) => setMsg(e.message, true)); } },
        ...st.projects.map((p) => el('option', { value: String(p.id), textContent: `${p.title} · ${p.done}/${p.shots}`, selected: p.id === st.projectId })));
      const reload = el('button', { textContent: '↻', title: 'โหลดใหม่', onclick: () => loadProjects().catch((e) => setMsg(e.message, true)) });
      body.append(el('div', { class: 'row' }, sel, reload));
      const n = st.next;
      if (n && n.shot) {
        body.append(el('div', { class: 'hint', textContent: `ช็อตที่ ${n.shot.position} จาก ${n.total} · ส่งแล้ว ${n.done} ช็อต${n.shot.status === 'rejected' ? ' · ต้องสร้างใหม่ (ถูกรีวิว ❌)' : ''}` }));
        body.append(el('textarea', { readOnly: true, value: n.shot.prompt }));
        const fill = el('button', { class: 'p', textContent: '1. วาง prompt ลงช่อง' });
        fill.onclick = guard(fill, fillPrompt);
        const copy = el('button', { textContent: 'คัดลอก' });
        copy.onclick = guard(copy, async () => { await navigator.clipboard.writeText(n.shot.prompt); setMsg('คัดลอก prompt แล้ว'); });
        body.append(el('div', { class: 'row' }, fill, copy));
        const auto = el('input', { type: 'checkbox', checked: st.auto, onchange: () => { st.auto = auto.checked; chrome.storage.local.set({ auto: st.auto }).catch(() => {}); } });
        body.append(el('label', { class: 'hint' }, auto, ' ส่งรูปเข้าช็อตให้เองเมื่อรูปเสร็จ (เฉพาะโหมดภาพนิ่ง)'));
        body.append(el('div', { class: 'hint', textContent: `${stillMode() ? `2. ตั้งโหมดสร้างรูป/สัดส่วนใน ${site} แล้วกดสร้างเอง` : `2. กดสร้างใน ${site} เอง`} · 3. พอได้${noun()} ตัวเลือกจะขึ้นด้านล่าง` }));
      } else if (n) {
        body.append(el('div', { class: 'ok', textContent: `✓ ครบทุกช็อตแล้ว (${n.total} ช็อต) — ไปรวมคลิปในหน้าโปรเจกต์ของ Arn Reels` }));
      } else if (!st.msg) {
        body.append(el('div', { class: 'hint', textContent: 'ยังไม่มีโปรเจกต์ — สร้างโปรเจกต์เรื่องและแบ่งช็อตใน Arn Reels ก่อน' }));
      }
      st.cands.forEach((v, i) => {
        const c = el('canvas', { width: 54, height: 72 }); c.dataset.i = String(i);
        const go = el('button', { class: 'p', textContent: `✅ ส่งเข้าช็อต ${n && n.shot ? n.shot.position : ''}` });
        go.onclick = guard(go, () => sendVideo(v));
        const skip = el('button', { textContent: 'ข้าม', onclick: () => { st.skipped.add(srcOf(v)); scan(); render(); } });
        body.append(el('div', { class: 'cand' }, c, el('div', { class: 'info', textContent: stillMode() ? `รูป ${i + 1} · ${v.naturalWidth}×${v.naturalHeight}` : `วิดีโอ ${i + 1} · ${Math.round(v.duration)} วิ` }), el('div', { class: 'row' }, go, skip)));
      });
      if (st.msg) body.append(el('div', { class: st.bad ? 'bad' : 'ok', textContent: st.msg }));
      const dg = el('button', { textContent: 'ตรวจหน้า', title: 'ดูว่าแผงเจอช่องพิมพ์/วิดีโอในหน้านี้ไหม' });
      dg.onclick = guard(dg, diagnose);
      body.append(el('div', { class: 'row' }, dg));
      if (st.diag) body.append(el('pre', { textContent: st.diag }));
      kids.push(body);
    }
    box.replaceChildren(...kids);
    drawThumbs();
  }

  function renderProduct(body) {
    const q = st.pq, job = q && q.next;
    const reload = el('button', { textContent: '↻', title: 'โหลดคิวใหม่', onclick: () => loadProductQueue().catch((e) => setMsg(e.message, true)) });
    body.append(el('div', { class: 'row' }, el('span', { class: 'hint', textContent: q ? `คิวคลิปสินค้า: รอ ${q.waiting} · ได้วิดีโอแล้ว ${q.done} จาก ${q.total}` : 'กำลังโหลดคิว…' }), reload));
    if (job) {
      body.append(el('div', { textContent: `🛍 ${job.clip.title}` }));
      if (job.product && job.product.brand) body.append(el('div', { class: 'hint', textContent: `แบรนด์: ${job.product.brand}` }));
      body.append(el('div', { class: job.images.length ? 'hint' : 'bad', textContent: job.images.length ? `รูปที่จะแนบ: ${job.images.map((i) => i.label).join(' + ')}` : '⚠ ยังไม่มีรูปสินค้า (ใส่ได้ที่คลังสินค้าใน Arn Reels)' }));
      body.append(el('textarea', { readOnly: true, value: job.prompt }));
      const fill = el('button', { class: 'p', textContent: '1. วาง prompt + แนบรูป' });
      fill.onclick = guard(fill, fillProduct);
      const copy = el('button', { textContent: 'คัดลอก' });
      copy.onclick = guard(copy, async () => { setMsg((await copyText(job.prompt)) ? 'คัดลอก prompt แล้ว' : 'คัดลอกไม่ได้ — คลิกที่หน้าเว็บก่อนแล้วลองใหม่', false); });
      const dl = el('button', { textContent: '⬇ ดาวน์โหลดรูป', title: 'ดาวน์โหลดรูปสินค้า/รูปอ้างอิง ไว้ลากใส่ช่องเอง' });
      dl.onclick = guard(dl, async () => { const f = await productFiles(); if (!f.length) throw new Error('สินค้านี้ยังไม่มีรูป'); downloadFiles(f); setMsg(`ดาวน์โหลด ${f.length} รูปแล้ว — ลากใส่ช่องของ ${site}`); });
      const fresh = el('button', { class: st.needFresh ? 'p' : '', textContent: '🆕 แชทใหม่แล้ววาง', title: 'โหลดหน้าแรกของ Meta AI ใหม่ (แชทว่าง) แล้ววาง prompt + แนบรูปให้เอง — ไม่กดสร้างให้' });
      fresh.onclick = guard(fresh, async () => openFreshAndFill());
      body.append(el('div', { class: 'row' }, fill, fresh));
      if (st.needFresh) { const here = el('button', { textContent: 'วางในแชทนี้' }); here.onclick = guard(here, () => fillProduct({ force: true })); body.append(el('div', { class: 'row' }, here)); }
      body.append(el('div', { class: 'row' }, copy, dl));
      const au = el('input', { type: 'checkbox', checked: st.pAuto, onchange: () => { st.pAuto = au.checked; chrome.storage.local.set({ pAuto: st.pAuto }).catch(() => {}); render(); } });
      body.append(el('label', { class: 'hint' }, au, ' 🤖 อัตโนมัติ: กดส่งให้ Meta AI + ส่งวิดีโอกลับเอง + ทำชิ้นถัดไปในแชทใหม่'));
      body.append(el('div', { class: 'hint', textContent: `2. ตั้งเป็นโหมดวิดีโอแล้วกดสร้างใน ${site} เอง · 3. พอได้วิดีโอ ตัวเลือกจะขึ้นด้านล่าง` }));
    } else if (q) {
      body.append(el('div', { class: 'ok', textContent: q.total ? '✓ ทำครบคิวแล้ว — กลับไปกด “ใส่ข้อความ + ทำคลิปเสร็จ” ในคลัง Arn Reels' : 'ยังไม่มีคลิปสินค้าในคิว — ไปที่ Arn Reels → 🛍 สินค้า → ติ๊กสินค้า → “สร้างคลิปสินค้า”' }));
    }
    st.cands.forEach((v, i) => {
      const c = el('canvas', { width: 54, height: 72 }); c.dataset.i = String(i);
      const go = el('button', { class: 'p', textContent: '✅ ส่งเข้า Arn Reels' });
      go.onclick = guard(go, () => sendProductVideo(v));
      const skip = el('button', { textContent: 'ข้าม', onclick: () => { st.skipped.add(srcOf(v)); scan(); render(); } });
      body.append(el('div', { class: 'cand' }, c, el('div', { class: 'info', textContent: `วิดีโอ ${i + 1} · ${Math.round(v.duration)} วิ${v.videoHeight && v.videoHeight < v.videoWidth * 1.2 ? ' · ⚠ ไม่ใช่แนวตั้ง' : ''}` }), el('div', { class: 'row' }, go, skip)));
    });
    if (st.msg) body.append(el('div', { class: st.bad ? 'bad' : 'ok', textContent: st.msg }));
    if (st.warn) body.append(el('div', { class: 'bad', textContent: st.warn }));
    const dg = el('button', { textContent: 'ตรวจหน้า', title: 'ดูว่าแผงเจอช่องพิมพ์/วิดีโอ/ช่องแนบไฟล์ในหน้านี้ไหม' });
    dg.onclick = guard(dg, diagnose);
    body.append(el('div', { class: 'row' }, dg));
    if (st.diag) body.append(el('pre', { textContent: st.diag }));
  }

  // หลังกด “แชทใหม่แล้ววาง”: รอช่องพิมพ์ขึ้น (ไม่เกิน 20 วิ) แล้ววางให้คลิปเดิม
  async function resumeFill() {
    let id = null;
    try { id = sessionStorage.getItem('arnFillClip'); sessionStorage.removeItem('arnFillClip'); } catch { /* ไม่เป็นไร */ }
    if (!id) return;
    const job = st.pq && st.pq.next;
    if (!job || String(job.clip.id) !== id) { setMsg('คิวเปลี่ยนไประหว่างเปิดแชทใหม่ — กดวางอีกครั้ง', true); return; }
    setMsg('เปิดแชทใหม่แล้ว รอช่องพิมพ์…');
    for (let i = 0; i < 40 && !findPromptBox(); i++) await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => setTimeout(r, 1500));
    await fillProduct();
  }

  // คำสั่งจากภายนอกผ่านเหตุการณ์ DOM (ผู้ช่วย AI ที่ควบคุมเบราว์เซอร์ใช้แทนการคลิกในแผง): arn-fill = วาง prompt ช็อตถัดไป, arn-reload = โหลดโปรเจกต์ใหม่
  document.addEventListener('arn-fill', () => { fillPrompt().catch((e) => { setState('error'); setMsg(e.message, true); }); });
  document.addEventListener('arn-reload', () => { loadProjects().catch((e) => setMsg(e.message, true)); });
  chrome.storage.local.get(['auto', 'mode', 'pAuto']).then((v) => { st.auto = v.auto === true; st.pAuto = v.pAuto === true; if (v.mode === 'product') { st.mode = 'product'; loadProductQueue().then(resumeFill).catch((e) => setMsg(e.message, true)); } render(); }).catch(() => {});
  setState('idle');
  render();
  loadProjects().catch((e) => setMsg(e.message, true));
})();
