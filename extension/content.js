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
  };

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
      const sel = getSelection(), range = document.createRange();
      range.selectNodeContents(box);
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('insertText', false, text);
      if (!(box.textContent || '').includes(text.slice(0, 20))) {
        box.textContent = text;
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
    const now = box.value !== undefined ? box.value : box.textContent;
    return (now || '').includes(text.slice(0, 20));
  }
  const srcOf = (v) => v.currentSrc || v.src || (v.querySelector && v.querySelector('source') && v.querySelector('source').src) || '';
  // โปรเจกต์แบบ "ภาพนิ่ง" → มองหารูปใหญ่ (≥400px) ที่เพิ่งขึ้นในหน้า แทนวิดีโอ
  const stillMode = () => !!(st.next && st.next.project && st.next.project.media === 'image');
  const noun = () => (stillMode() ? 'รูป' : 'วิดีโอ');
  const site = /(^|\.)google\.com$/.test(location.hostname) ? 'Google Flow' : 'Meta AI'; // ใช้เฉพาะในข้อความบนแผง
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

  async function fillPrompt() {
    const shot = st.next && st.next.shot;
    if (!shot) throw new Error('ไม่มีช็อตที่ต้องสร้างแล้ว');
    pageVideos().forEach((v) => st.baseline.add(srcOf(v))); // วิดีโอ/รูปที่มีอยู่ก่อนหน้านี้ ไม่นับเป็นผลของช็อตนี้
    st.cands = []; st.waiting = true; startScan();
    const box = findPromptBox();
    if (box && setText(box, shot.prompt)) return setMsg(`วาง prompt ช็อตที่ ${shot.position} แล้ว — ตรวจข้อความแล้วกดสร้างใน ${site} ได้เลย`);
    await navigator.clipboard.writeText(shot.prompt).catch(() => {});
    setMsg(`วางลงช่องอัตโนมัติไม่ได้ — คัดลอก prompt ไว้แล้ว กด Ctrl+V ในช่องพิมพ์ของ ${site} (กด “ตรวจหน้า” ถ้าอยากให้ผมปรับให้ตรงหน้านี้)`, true);
  }

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
    const key = (a) => a.map((v) => srcOf(v)).join('|');
    if (key(found) !== key(st.cands)) { st.cands = found; render(); }
    else drawThumbs();
  }

  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    r.readAsDataURL(blob);
  });

  async function sendVideo(v) {
    const shot = st.next && st.next.shot;
    if (!shot) throw new Error('ไม่มีช็อตปลายทาง');
    const src = srcOf(v);
    setMsg(`กำลังดึง${noun()}…`);
    let mime, b64;
    const sameOrigin = src.startsWith('blob:') || new URL(src, location.href).origin === location.origin;
    if (sameOrigin) {
      const blob = await (await fetch(src)).blob();
      if (blob.size > 45_000_000) throw new Error(`${noun()}ใหญ่เกิน 45MB — ดาวน์โหลดแล้วแนบเองในหน้าโปรเจกต์แทน`);
      mime = blob.type.split(';')[0];
      b64 = await blobToB64(blob);
    } else {
      ({ mime, b64 } = await send('fetchRemote', { url: src }));
    }
    mime = sniffMime(b64, /^(video\/(mp4|webm)|image\/(png|jpeg|webp))$/.test(mime) ? mime : stillMode() ? 'image/jpeg' : 'video/mp4');
    setMsg('กำลังส่งเข้า Arn Reels…');
    const res = await send('upload', { shotId: shot.id, mime, b64 });
    st.sent.add(src); st.cands = []; st.waiting = false; clearInterval(timer);
    st.next = res;
    const pr = st.projects.find((p) => p.id === st.projectId);
    if (pr) pr.done = res.done; // ตัวเลขในรายการโปรเจกต์ขยับตาม
    const nx = res.shot;
    setMsg(`ส่งเข้าช็อตที่ ${shot.position} แล้ว ✓ ${nx ? `— ถัดไปช็อตที่ ${nx.position} กด “วาง prompt” ต่อได้` : '— ครบทุกช็อตแล้ว ไปรวมคลิปในหน้าโปรเจกต์ได้เลย'}`);
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
    st.diag = [`หน้า: ${location.host}${location.pathname}`, `ช่องพิมพ์ที่พบ (${edit.length}):`, ...edit, `วิดีโอในหน้า (${vids.length}):`, ...vids, `ปุ่มที่ดูเหมือนส่ง/สร้าง (${btns.length}):`, ...btns].join('\n');
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

  render();
  loadProjects().catch((e) => setMsg(e.message, true));
})();
