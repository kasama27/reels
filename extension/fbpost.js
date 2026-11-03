// แผง "Arn Reels · โพสต์" บน business.facebook.com / www.facebook.com
//  - ดึงคลิปพร้อมโพสต์ถัดไปจาก Arn Reels (คลิปสินค้าก่อน เก่าสุดก่อน)
//  - แนบไฟล์วิดีโอลงช่องอัปโหลดของหน้าสร้าง Reels (ดึงจาก Arn Reels ทีละชิ้นผ่าน service worker) + วางแคปชัน + คัดลอกคอมเมนต์แรก (ลิงก์)
//  - ไม่กดปุ่ม "แชร์/โพสต์/เผยแพร่" ของ Facebook แทนคุณ — คุณตรวจแล้วกดเอง จากนั้นกด "โพสต์แล้ว" เพื่อบันทึกใน Arn Reels
//  - สั่งงานจากภายนอกได้ด้วยเหตุการณ์ DOM: document.dispatchEvent(new CustomEvent('arn-post', { detail: 'load' | 'attach' | 'caption' | 'cover' }))
//    สถานะอ่านได้ที่ #arn-post-host: data-state (idle|loading|ready|attaching|attached|captioned|posted|error) data-clip data-msg
(() => {
  if (window.top !== window || window.__arnPostPanel) return;
  window.__arnPostPanel = true;

  const send = (type, extra = {}) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...extra }, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (r && r.ok) resolve(r.data); else reject(new Error((r && r.error) || 'ไม่มีคำตอบจากส่วนเสริม'));
    });
  });
  const b64ToBytes = (b64) => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  const CHUNK = 6_000_000;

  // photo = หน้า "สร้างโพสต์" ของ Business Suite (โพสต์รูป) · ไม่ใช่ = หน้า "สร้างคลิป Reels"
  const isPhotoPage = () => /\/latest\/composer/.test(location.pathname) && !/reels_composer/.test(location.pathname);
  const st = { open: false, clip: null, remaining: 0, file: null, state: 'idle', msg: '', bad: false, busy: false, photo: isPhotoPage() };

  // ---------- หน้าตาแผง (shadow DOM ไม่ปนกับสไตล์ของ Facebook) ----------
  const host = document.createElement('div');
  host.id = 'arn-post-host';
  host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483646';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box;font-family:"Leelawadee UI",Tahoma,sans-serif}
    .box{width:340px;max-height:80vh;overflow:auto;background:#12152a;color:#e8eaf6;border:1px solid #3b4170;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5);font-size:13px;line-height:1.5}
    .head{display:flex;gap:8px;align-items:center;padding:9px 12px;cursor:pointer;background:#1a1e3a;border-radius:14px}
    .box.open .head{border-radius:14px 14px 0 0}
    .t{flex:1;font-weight:700}
    .body{padding:10px 12px;display:grid;gap:8px}
    button{font:inherit;font-size:13px;border:1px solid #3b4170;background:#232850;color:#e8eaf6;border-radius:8px;padding:6px 10px;cursor:pointer}
    button.p{background:#7c83ff;color:#0b0d12;border:0;font-weight:700}
    button:disabled{opacity:.5;cursor:default}
    .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .cap{white-space:pre-wrap;background:#0b0d1a;border:1px solid #2a2f55;border-radius:8px;padding:6px 8px;max-height:110px;overflow:auto;font-size:12px;color:#c5c9e6}
    .hint{color:#9aa0c8;font-size:12px}
    .ok{color:#7ee2b0}.bad{color:#ff9a9a}
    input{font:inherit;font-size:12px;width:100%;padding:5px 8px;border-radius:8px;border:1px solid #3b4170;background:#0b0d1a;color:#e8eaf6}
  </style><div class="box"></div>`;
  const box = shadow.querySelector('.box');
  (document.body || document.documentElement).appendChild(host);

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n[k] = v; }
    n.append(...kids);
    return n;
  };
  const setState = (state, msg = '', bad = false) => {
    st.state = state; st.msg = msg; st.bad = bad;
    host.dataset.state = state; host.dataset.msg = msg; host.dataset.clip = st.clip ? String(st.clip.id) : '';
    render();
  };

  function render() {
    box.className = `box${st.open ? ' open' : ''}`;
    const head = el('div', { class: 'head', onclick: () => { st.open = !st.open; render(); } },
      el('span', { class: 't', textContent: `${st.photo ? '🖼' : '🎬'} Arn Reels · ${st.photo ? 'โพสต์รูป' : 'โพสต์'}${st.clip ? ` (#${st.clip.id})` : ''}` }), el('span', { textContent: st.open ? '▾' : '▸' }));
    if (!st.open) { box.replaceChildren(head); return; }
    const body = el('div', { class: 'body' });
    const load = el('button', { textContent: st.clip ? (st.photo ? '↻ โพสต์รูปถัดไป' : '↻ คลิปถัดไป') : (st.photo ? '📥 ดึงโพสต์รูปพร้อมโพสต์' : '📥 ดึงคลิปพร้อมโพสต์'), disabled: st.busy, onclick: () => run(doLoad) });
    body.append(el('div', { class: 'row' }, load, el('span', { class: 'hint', textContent: st.clip ? `เหลือพร้อมโพสต์ ${st.remaining} คลิป` : '' })));
    if (st.clip) {
      const c = st.clip;
      body.append(el('div', { textContent: `${c.kind === 'product' ? '🛍 ' : ''}${c.title}` }),
        el('div', { class: 'hint', textContent: `${c.duration ? `${Math.round(c.duration)} วิ · ` : ''}${(c.bytes / 1e6).toFixed(1)} MB` }));
      body.append(el('div', { class: 'hint', textContent: c.photo ? '1) หน้า “สร้างโพสต์” ของเพจ แล้วกด:' : '1) เปิดหน้าสร้าง Reels ของเพจ (ปุ่ม “สร้างรีล”) แล้วกด:' }));
      body.append(el('div', { class: 'row' },
        el('button', { class: 'p', textContent: st.state === 'attached' || st.state === 'captioned' ? (c.photo ? '✓ แนบรูปแล้ว' : '✓ แนบวิดีโอแล้ว') : (c.photo ? '📎 แนบรูป' : '📎 แนบวิดีโอ'), disabled: st.busy, onclick: () => run(doAttach) }),
        el('button', { textContent: '⬇ ดาวน์โหลดไฟล์', disabled: st.busy, title: 'ถ้าแนบอัตโนมัติไม่ติด ดาวน์โหลดแล้วลากใส่เอง', onclick: () => run(doDownload) })));
      if (!c.photo) body.append(el('div', { class: 'row' }, el('button', { textContent: st.coverDone ? '✓ ใส่หน้าปกแล้ว' : '🖼 ใส่หน้าปก', disabled: st.busy, title: 'อัปโหลดหน้าปกจาก Arn Reels (เฟรมวินาทีที่ตั้งไว้ + ข้อความแนะนำ) เป็นภาพขนาดย่อของ Reels', onclick: () => run(doCover) })));
      body.append(el('div', { class: 'hint', textContent: '2) คลิกในช่องคำบรรยายของ Facebook แล้วกด:' }));
      body.append(el('div', { class: 'cap', textContent: captionText() }));
      body.append(el('div', { class: 'row' },
        el('button', { class: 'p', textContent: '✍ วางแคปชัน', disabled: st.busy, onclick: () => run(doCaption) }),
        el('button', { textContent: '📋 คัดลอก', onclick: () => copy(captionText(), 'คัดลอกแคปชันแล้ว') })));
      if (c.fb_comment) {
        body.append(el('div', { class: 'hint', textContent: '3) กดเผยแพร่เอง แล้ววางคอมเมนต์แรก (ลิงก์) ใต้โพสต์:' }));
        body.append(el('div', { class: 'cap', textContent: c.fb_comment }));
        body.append(el('div', { class: 'row' }, el('button', { textContent: '💬 คัดลอกคอมเมนต์', onclick: () => copy(c.fb_comment, 'คัดลอกคอมเมนต์แล้ว') })));
      }
      const link = el('input', { placeholder: 'ลิงก์โพสต์ (ไม่ใส่ก็ได้)' });
      body.append(el('div', { class: 'hint', textContent: `${c.fb_comment ? '4' : '3'}) โพสต์เสร็จแล้วบันทึกใน Arn Reels:` }), link,
        el('div', { class: 'row' }, el('button', { class: 'p', textContent: '✅ โพสต์แล้ว', disabled: st.busy, onclick: () => run(() => doPosted(link.value)) })));
    }
    if (st.msg) body.append(el('div', { class: st.bad ? 'bad' : 'ok', textContent: st.msg }));
    box.replaceChildren(head, body);
  }

  const captionText = () => (st.clip ? [st.clip.caption, st.clip.hashtags].filter((x) => x && x.trim()).join('\n\n') : '');
  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); setState(st.state, okMsg); } catch { setState(st.state, 'คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C เอง', true); }
  }
  async function run(fn) {
    if (st.busy) return;
    st.busy = true; render();
    try { await fn(); } catch (e) { setState('error', e.message, true); } finally { st.busy = false; render(); }
  }

  // ---------- งาน ----------
  async function doLoad() {
    setState('loading', 'กำลังดึงคลิปจาก Arn Reels…');
    st.photo = isPhotoPage();
    const r = await send('postNext', { photo: st.photo });
    st.clip = r.clip; st.remaining = r.remaining; st.file = null; st.coverDone = false;
    if (!r.clip) return setState('idle', st.photo ? 'ไม่มีโพสต์รูปพร้อมโพสต์ — กด “ทำโพสต์รูป” ในหน้าวันนี้ของ Arn Reels ก่อน' : 'ไม่มีคลิปพร้อมโพสต์ — ทำคลิปให้เสร็จใน Arn Reels ก่อน', true);
    setState('ready', 'ได้คลิปแล้ว');
  }
  async function getFile() {
    if (st.file) return st.file;
    const c = st.clip;
    if (c.photo) { st.file = new File([b64ToBytes((await send('postPhoto', { clipId: c.id })).b64)], `arn-post-${c.id}.jpg`, { type: 'image/jpeg' }); return st.file; }
    const parts = [];
    for (let start = 0; start < c.bytes; start += CHUNK) {
      setState('attaching', `กำลังดึงวิดีโอ ${Math.min(100, Math.round(start / c.bytes * 100))}%…`);
      parts.push(b64ToBytes((await send('postChunk', { clipId: c.id, start, len: CHUNK })).b64));
    }
    st.file = new File(parts, `arn-reels-${c.id}.mp4`, { type: 'video/mp4' });
    return st.file;
  }
  // หา input ไฟล์ที่รับวิดีโอได้: ในหน้าต่าง (dialog) ที่เปิดอยู่ก่อน แล้วค่อยทั้งหน้า
  function findVideoInput() {
    const all = [...document.querySelectorAll('input[type=file]')];
    const okType = (i) => !i.accept || /video|mp4|\*/i.test(i.accept);
    const dlg = [...document.querySelectorAll('[role=dialog]')].pop();
    return (dlg && [...dlg.querySelectorAll('input[type=file]')].find(okType)) || all.find(okType) || null;
  }
  async function captureInput() {
    const re = st.clip && st.clip.photo ? /^(เพิ่มรูปภาพ\/?วิดีโอ|เพิ่มรูปภาพ|Add photo\/?video|Add photos?)$/i : /^(เพิ่มวิดีโอ|Add video)$/i;
    const btn = [...document.querySelectorAll('div[role=button],button,[role=button]')].find((x) => re.test((x.innerText || '').trim()));
    if (!btn) return null;
    const html = document.documentElement;
    html.dataset.arnCaptureFile = '1';
    try {
      btn.click();
      for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 150)); const got = document.querySelector('input[type=file][data-arn-captured="1"]'); if (got) return got; }
      return findVideoInput();
    } finally { delete html.dataset.arnCaptureFile; }
  }
  async function doAttach() {
    if (!st.clip) await doLoad();
    if (!st.clip) return;
    const file = await getFile();
    let input = st.clip.photo ? null : findVideoInput();
    if (!input) input = await captureInput(); // หน้าสร้าง Reels: กด "เพิ่มวิดีโอ" ให้ แล้วรับช่องอัปโหลดมาแทนหน้าต่างเลือกไฟล์ (fb-hook.js)
    const dt = new DataTransfer(); dt.items.add(file);
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return setState('attached', st.clip.photo ? 'แนบรูปแล้ว — ดูรูปในตัวอย่างโพสต์ด้านขวา' : 'แนบวิดีโอแล้ว — รอ Facebook อัปโหลดให้เสร็จ (ถ้าไม่ขึ้น กด “ดาวน์โหลดไฟล์” แล้วลากใส่เอง)');
    }
    // ไม่เจอช่องไฟล์: ลองปล่อยไฟล์ (drop) ลงหน้าต่างสร้างโพสต์
    const target = [...document.querySelectorAll('[role=dialog]')].pop() || document.body;
    for (const t of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    setState('attached', 'ไม่เจอช่องอัปโหลด — ลองปล่อยไฟล์ลงหน้าต่างแล้ว ถ้าไม่ติด เปิดหน้า “สร้างรีล” ก่อน หรือกด “ดาวน์โหลดไฟล์”', true);
  }
  async function doDownload() {
    if (!st.clip) await doLoad();
    if (!st.clip) return;
    const file = await getFile();
    const a = el('a', { href: URL.createObjectURL(file), download: file.name });
    document.body.appendChild(a); a.click(); a.remove();
    setState(st.state === 'attaching' ? 'ready' : st.state, `ดาวน์โหลด ${file.name} แล้ว`);
  }
  // วางแคปชัน: ช่องที่โฟกัสอยู่ หรือช่องพิมพ์ช่องแรกในหน้าต่างสร้างโพสต์
  function findCaptionBox() {
    const a = document.activeElement;
    if (a && (a.isContentEditable || a.tagName === 'TEXTAREA')) return a;
    const dlg = [...document.querySelectorAll('[role=dialog]')].pop() || document;
    return dlg.querySelector('[contenteditable=true][role=textbox], [contenteditable=true], textarea');
  }
  async function doCaption() {
    if (!st.clip) await doLoad();
    if (!st.clip) return;
    const text = captionText();
    const box = findCaptionBox();
    if (!box) { await copy(text, ''); return setState('error', 'ไม่เจอช่องคำบรรยาย — คัดลอกให้แล้ว คลิกในช่องแล้วกด Ctrl+V', true); }
    box.focus();
    let ok = false;
    if (box.tagName === 'TEXTAREA') {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(box, text); box.dispatchEvent(new Event('input', { bubbles: true })); ok = true;
    } else {
      // ช่องของ Facebook แปลง #แฮชแท็ก เป็นป้าย — insertText ทั้งก้อนเคยทำแฮชแท็กไปทับบรรทัดแรก (1 พ.ย.) → วางด้วย paste แล้วอ่านกลับ
      const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
      if (norm(box.innerText)) { await copy(text, ''); return setState('error', 'ช่องคำบรรยายมีข้อความอยู่แล้ว — ลบออกก่อน หรือกด Ctrl+V แทน (คัดลอกให้แล้ว)', true); }
      const dt = new DataTransfer(); dt.setData('text/plain', text);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 500));
      if (norm(box.innerText) !== norm(text)) { document.execCommand('insertText', false, text); await new Promise((r) => setTimeout(r, 500)); }
      ok = norm(box.innerText) === norm(text);
      if (!ok) { await copy(text, ''); return setState('error', 'วางแคปชันแล้วข้อความไม่ตรง — ลบในช่องแล้วกด Ctrl+V (คัดลอกให้แล้ว)', true); }
    }
    if (!ok) { await copy(text, ''); return setState('error', 'วางอัตโนมัติไม่ได้ — คัดลอกให้แล้ว กด Ctrl+V ในช่องคำบรรยาย', true); }
    setState('captioned', 'วางแคปชันแล้ว — ตรวจแล้วกดเผยแพร่เองได้เลย');
  }
  // หน้าปก: ส่วน "ภาพขนาดย่อ" → แท็บ "อัพโหลดภาพ" → ลิงก์ "อัพโหลดภาพ" (เปิดหน้าต่างเลือกไฟล์ → fb-hook.js รับช่องไว้ให้) → ใส่ไฟล์หน้าปก
  async function doCover() {
    if (!st.clip) await doLoad();
    if (!st.clip) return;
    setState('attaching', 'กำลังดึงหน้าปกจาก Arn Reels…');
    const file = new File([b64ToBytes((await send('postCover', { clipId: st.clip.id })).b64)], `arn-cover-${st.clip.id}.jpg`, { type: 'image/jpeg' });
    const byText = (re, sel) => [...document.querySelectorAll(sel)].find((x) => re.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0);
    const tab = byText(/^(อัพโหลดภาพ|อัปโหลดภาพ|Upload image)$/i, 'div[role=button],button,[role=tab]');
    if (!tab) return setState('error', 'ไม่เจอส่วน “ภาพขนาดย่อ” — แนบวิดีโอให้อัปโหลดเสร็จก่อน แล้วกดใหม่', true);
    tab.click();
    await new Promise((r) => setTimeout(r, 800));
    const link = byText(/^(อัพโหลดภาพ|อัปโหลดภาพ|Upload image)$/i, 'a,[role=link]');
    if (!link) return setState('error', 'ไม่เจอลิงก์ “อัพโหลดภาพ” ในส่วนภาพขนาดย่อ', true);
    const before = new Set(document.querySelectorAll('input[type=file]'));
    const html = document.documentElement;
    html.dataset.arnCaptureFile = '1';
    let input = null;
    try {
      link.click();
      for (let i = 0; i < 20 && !input; i++) { await new Promise((r) => setTimeout(r, 150)); input = [...document.querySelectorAll('input[type=file]')].find((x) => !before.has(x) && /image/i.test(x.accept || '')) || null; }
      if (!input) input = [...document.querySelectorAll('input[type=file]')].filter((x) => /image/i.test(x.accept || '') && !/video/i.test(x.accept || '')).pop() || null;
    } finally { delete html.dataset.arnCaptureFile; }
    if (!input) return setState('error', 'ไม่เจอช่องอัปโหลดหน้าปก — กด “อัพโหลดภาพ” เองแล้วเลือกไฟล์หน้าปก', true);
    const dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    st.coverDone = true;
    setState(st.state === 'attaching' ? 'attached' : st.state, 'ใส่หน้าปกแล้ว — ดูภาพขนาดย่อให้ตรงก่อนเผยแพร่');
  }
  async function doPosted(fbUrl) {
    await send('postDone', { clipId: st.clip.id, fbUrl: (fbUrl || '').trim() });
    const t = st.clip.title;
    st.clip = null; st.file = null;
    setState('posted', `บันทึกว่าโพสต์แล้ว: ${t}`);
  }

  // ---------- เควสหน้าสถานะเพจ: อ่าน "งานในสัปดาห์นี้" แล้วส่งให้ Arn Reels (เฉพาะเมื่อเปิดหน้านี้เอง ไม่กดอะไร) ----------
  function readQuests() {
    if (!/\/professional_dashboard\/status/.test(location.pathname)) return null;
    const main = document.querySelector('[role=main]') || document.body;
    const lines = (main.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const week = (lines.find((l) => /^สัปดาห์\s|^Week\s/i.test(l)) || '').replace(/^สัปดาห์\s*|^Week\s*/i, '');
    const items = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const nx = lines[i + 1];
      const m = /(\d+)\s*\/\s*(\d+)/.exec(nx);
      if (m && /เสร็จสมบูรณ์แล้ว|ผู้ติดตาม|completed|followers/i.test(nx)) items.push({ label: lines[i], done: Number(m[1]), total: Number(m[2]) });
      else if (/^(เสร็จสมบูรณ์|Completed)$/i.test(nx) && !/^งานในสัปดาห์|^ความสำเร็จ/.test(lines[i])) items.push({ label: lines[i], done: 1, total: 1, complete: true });
    }
    return items.length ? { week, items } : null;
  }
  let questSent = '';
  async function syncQuests() {
    const q = readQuests();
    if (!q) return;
    const key = JSON.stringify(q);
    if (key === questSent) return;
    try { await send('questSync', q); questSent = key; setState(st.state, `ส่งเควสสัปดาห์นี้ให้ Arn Reels แล้ว (${q.items.length} งาน)`); } catch (e) { setState('error', e.message, true); }
  }
  setTimeout(syncQuests, 4000);
  setInterval(syncQuests, 60000);

  document.addEventListener('arn-post', (e) => {
    const a = e.detail;
    st.open = true;
    if (a === 'load') run(doLoad); else if (a === 'attach') run(doAttach); else if (a === 'caption') run(doCaption); else if (a === 'cover') run(doCover); else if (a === 'quests') { questSent = ''; syncQuests(); }
  });
  setState('idle');
})();
