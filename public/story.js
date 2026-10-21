// หน้า "โปรเจกต์เรื่อง" — หนังสั้นหลายช็อต: เรื่อง → คลังตัวละคร/สถานที่/ของประกอบ → ช็อต (prompt ฝังรายละเอียดตัวละครซ้ำทุกช็อต)
// ใช้ helper จาก app.js (h, api, guard, toast, uiConfirm, copyText, $)
(() => {
  const dlg = $('story');
  const KIND_TH = { character: '👤 ตัวละคร', location: '📍 สถานที่', prop: '🎒 ของประกอบ' };
  const STATUS_SHOT = { draft: 'ร่าง', ready: 'พร้อมสร้าง', generated: 'สร้างแล้ว', approved: 'ใช้ได้', rejected: 'ไม่ผ่าน' };
  let list = [];
  let cur = null; // { project, entities, shots, warnings, planned }
  let tab = 'story';

  // เว็บที่ไปสร้างรูป/คลิปช็อต — ใช้แคตตาล็อกร่วมจาก generators.js (ร่วมกับหน้าคลิปเร็ว)
  const GEN = window.ARN_GEN;
  const genOf = (p) => GEN[p.generator] || GEN.flow;
  const fmtSec =(n) => (n >= 60 ? `${Math.floor(n / 60)} นาที${n % 60 ? ` ${n % 60} วิ` : ''}` : `${n} วิ`);

  async function loadList(selectId) {
    list = await api('GET', '/api/story/projects');
    const id = selectId ?? cur?.project.id ?? list[0]?.id;
    cur = id && list.some((p) => p.id === id) ? await api('GET', `/api/story/projects/${id}`) : null;
  }

  function render() {
    const sel = $('st-sel');
    sel.replaceChildren(...list.map((p) => new Option(`${p.title} · ${p.done}/${p.shots} ช็อต`, String(p.id))));
    if (cur) sel.value = String(cur.project.id);
    $('st-empty').hidden = !!cur;
    $('st-main').hidden = !cur;
    $('st-del').disabled = !cur;
    for (const b of $('st-tabs').children) b.setAttribute('aria-pressed', String(b.dataset.t === tab));
    if (!cur) return;
    $('st-body').replaceChildren(stepper(), tab === 'story' ? viewStory() : tab === 'bible' ? viewBible() : viewShots());
  }

  // ---------- ขั้นตอนอัตโนมัติ: ปุ่มเดียวทำขั้น AI ต่อกันจนถึงขั้นที่ต้องใช้มือ (สร้างรูปนอกแอป) ----------
  const stepState = () => {
    const p = cur.project, still = p.media === 'image';
    const have = cur.shots.filter((s) => s.video_file && s.status !== 'rejected').length;
    const steps = [
      { k: 'premise', t: '1 วางเนื้อเรื่อง', ok: !!p.premise.trim() },
      { k: 'bible', t: '2 คลังตัวละคร/สถานที่', ok: cur.entities.length > 0 },
      { k: 'shots', t: '3 แบ่งช็อต + prompt', ok: cur.shots.length > 0 },
      { k: 'media', t: `4 ${still ? 'สร้างรูป' : 'สร้างคลิป'}ทุกช็อต`, ok: cur.shots.length > 0 && have === cur.shots.length, note: cur.shots.length ? `${have}/${cur.shots.length}` : '' },
      { k: 'asm', t: '5 รวมเป็นคลิปเดียว', ok: false },
    ];
    const cur1 = steps.findIndex((s) => !s.ok);
    return { steps, now: cur1 < 0 ? 4 : cur1, still };
  };
  async function runNext() {
    const p = cur.project;
    for (let guardN = 0; guardN < 4; guardN++) { // ขั้น AI ทำต่อกันให้เอง
      const { steps } = stepState();
      if (!steps[0].ok) { tab = 'story'; render(); $('st-body').querySelector('textarea')?.focus(); toast('วางเนื้อเรื่องในช่อง “เรื่องย่อ” ก่อน แล้วกดปุ่มนี้อีกครั้ง'); return; }
      if (!steps[1].ok) { toast('AI กำลังร่างคลังตัวละคร/สถานที่…'); await api('POST', `/api/story/projects/${p.id}/ai-bible`, {}); await loadList(p.id); render(); if (!cur.entities.length) throw new Error('AI ไม่ได้ร่างคลังให้ — ลองอีกครั้ง หรือเพิ่มเองในแท็บ “ตัวละคร/สถานที่”'); continue; }
      if (!steps[2].ok) { toast('AI กำลังแบ่งช็อตและเขียน prompt…'); await api('POST', `/api/story/projects/${p.id}/ai-shots`, { replace: true }); await loadList(p.id); render(); if (!cur.shots.length) throw new Error('AI ไม่ได้แบ่งช็อตให้ — ลองอีกครั้ง'); continue; }
      break;
    }
    const { steps, still } = stepState();
    tab = 'shots'; render();
    if (!steps[3].ok) {
      const first = cur.shots.find((s) => !s.video_file || s.status === 'rejected');
      document.getElementById(`st-shot-${first.id}`)?.scrollIntoView({ block: 'start' });
      toast(`ต่อไป: สร้าง${still ? 'รูป' : 'คลิป'}ตาม prompt (กด “คัดลอก prompt ทั้งหมด”) แล้วแนบไฟล์ — แนบหลายไฟล์พร้อมกันได้`);
    } else {
      $('st-body').querySelector('.st-asm')?.scrollIntoView({ block: 'start' });
      toast('ครบทุกช็อตแล้ว — กด “รวมเป็นคลิปเดียว” ได้เลย');
    }
  }
  function stepper() {
    const { steps, now } = stepState();
    const go = h('button', { class: 'btn primary', type: 'button', textContent: now === 4 ? '▶ ไปขั้นรวมคลิป' : `▶ ทำขั้นถัดไป (${steps[now].t.slice(2)})` });
    go.addEventListener('click', () => guard(go, runNext, (e) => { $('st-msg').textContent = e.message; toast(e.message, true); }));
    return h('div', { class: 'st-steps' },
      h('ol', {}, ...steps.map((s, i) => h('li', { class: s.ok ? 'done' : i === now ? 'now' : '', textContent: `${s.ok ? '✓ ' : ''}${s.t}${s.note ? ` (${s.note})` : ''}` }))),
      go);
  }

  // บันทึกลงเซิร์ฟเวอร์ แล้วเก็บผลล่าสุดไว้ (ไม่วาดหน้าใหม่ — กันเคอร์เซอร์/โฟกัสหายระหว่างพิมพ์)
  async function save(method, url, body, then) {
    try {
      cur = await api(method, url, body);
      then?.();
      refreshSums();
      return true;
    } catch (e) { $('st-msg').textContent = e.message; toast(e.message, true); return false; }
  }
  const field = (label, el, hint) => h('label', { class: 'field' }, h('span', { class: 'cap-label', textContent: label }), ...(hint ? [h('span', { class: 'hint', textContent: hint })] : []), el);

  // ---------- แท็บ: เรื่อง ----------
  function viewStory() {
    const p = cur.project;
    const patch = (k, v) => save('PATCH', `/api/story/projects/${p.id}`, { [k]: v }, () => { est.textContent = estText(); });
    const title = h('input', { value: p.title, maxLength: 150 });
    const premise = h('textarea', { rows: 10, value: p.premise, placeholder: 'วางเรื่องย่อ/เนื้อเรื่องที่จะทำเป็นหนังสั้น (เขียนด้วยคำของคุณเอง) — AI ใช้เฉพาะเหตุการณ์ในนี้ ไม่แต่งเพิ่ม' });
    const total = h('input', { type: 'number', min: 10, max: 1800, step: 1, value: p.total_sec });
    const shot = h('input', { type: 'number', min: 3, max: 15, step: 1, value: p.shot_sec });
    const aspect = h('select', {}, ...['9:16', '4:5', '1:1', '16:9'].map((a) => new Option(a, a)));
    aspect.value = p.aspect;
    const media = h('select', {}, new Option('🎬 วิดีโอสั้นต่อช็อต', 'video'), new Option('🖼 ภาพนิ่งต่อช็อต', 'image'));
    media.value = p.media || 'video';
    const gen = genSelect(p);
    const perImg = perSelect(p);
    const style = h('textarea', { rows: 2, value: p.style, placeholder: 'ว่าง = ใช้โทนภาพของ “สไตล์ประจำเพจ” ในตั้งค่า (อังกฤษ)' });
    const est = h('p', { class: 'hint' });
    const estText = () => `แบ่งได้ประมาณ ${Math.max(1, Math.ceil(cur.project.total_sec / cur.project.shot_sec))} ช็อต (${fmtSec(cur.project.total_sec)} ÷ ช็อตละ ${cur.project.shot_sec} วิ)${cur.project.media === 'image' ? '' : ' — โมเดลวิดีโอส่วนใหญ่สร้างได้ครั้งละประมาณ 10 วินาที'}`;
    est.textContent = estText();
    title.addEventListener('change', () => patch('title', title.value));
    premise.addEventListener('change', () => patch('premise', premise.value));
    total.addEventListener('change', () => patch('total_sec', Number(total.value)));
    shot.addEventListener('change', () => patch('shot_sec', Number(shot.value)));
    aspect.addEventListener('change', () => patch('aspect', aspect.value));
    // เปลี่ยนวิดีโอ↔ภาพนิ่ง: prompt ทุกช็อตถูกประกอบใหม่ (ทับที่แก้เอง) → ถามก่อนถ้ามีช็อตแล้ว
    // และถ้าเว็บที่เลือกไว้ทำแบบใหม่ไม่ได้ (เช่น ChatGPT กับวิดีโอ) สลับเป็น Google Flow ให้
    media.addEventListener('change', async () => {
      const m = media.value;
      if (cur.shots.length && !(await uiConfirm(`เปลี่ยนเป็น${m === 'image' ? 'ภาพนิ่ง' : 'วิดีโอ'} จะประกอบ prompt ใหม่ทั้ง ${cur.shots.length} ช็อต (prompt ที่แก้เองจะถูกทับ) — ไฟล์ที่แนบไว้ยังอยู่`, { title: 'เปลี่ยนรูปแบบช็อต', ok: 'เปลี่ยน' }))) { media.value = p.media || 'video'; return; }
      const body = { media: m };
      if (!GEN[p.generator]?.media.includes(m)) body.generator = 'flow';
      if (!(await save('PATCH', `/api/story/projects/${p.id}`, body))) return render();
      if (body.generator) toast(`${GEN[p.generator]?.short || 'เว็บเดิม'} ทำ${m === 'image' ? 'รูป' : 'วิดีโอ'}ไม่ได้ — สลับเป็น Google Flow ให้แล้ว`);
      render(); // ตัวเลือกเว็บ/คำอธิบายเปลี่ยนตามรูปแบบ
    });
    gen.addEventListener('change', () => patch('generator', gen.value));
    style.addEventListener('change', () => patch('style', style.value));
    // จัดเป็นการ์ดพับได้ตามลำดับการทำงาน: เนื้อเรื่อง → การผลิต → โทนภาพ → แหล่งข้อมูล (หัวการ์ดสรุปค่าปัจจุบันไว้ ไม่ต้องกางก็เห็น)
    const sm = storySums();
    return h('div', { class: 'st-pane' },
      acc('story', '📖 เนื้อเรื่อง', sm.story, true,
        field('ชื่อเรื่อง', title), field('เรื่องย่อ / เนื้อเรื่อง', premise)),
      acc('prod', '⚙ การผลิต', sm.prod, true,
        h('div', { class: 'st-grid2' },
          field('รูปแบบของแต่ละช็อต', media, p.media === 'image' ? 'สร้างรูปเองทีละช็อต (ไม่ใช้ภาพต้นฉบับของใคร) แล้วซูม/แพนให้ขยับตอนรวมคลิป' : 'สร้างคลิปสั้นทีละช็อตด้วย AI วิดีโอ แล้วต่อกันเป็นคลิปเดียว'),
          field(`ไปสร้าง${p.media === 'image' ? 'รูป' : 'คลิป'}ที่ไหน`, gen, 'กำหนดคำแนะนำและลิงก์ในแท็บช็อต')),
        ...(p.media === 'image' ? [field('สร้างกี่ช็อตต่อ 1 รูป', perImg, 'หลายช็อตในรูปเดียว = ตัวละครเหมือนกันทุกช็อตและส่งน้อยครั้งกว่า แต่ภาพแต่ละช็อตเล็กลง — แท็บช็อตจะแตก prompt เป็นตารางและตัดรูปแบ่งเข้าช็อตให้')] : []),
        h('div', { class: 'st-row' }, field('ความยาวรวม (วินาที)', total), field('ความยาวต่อช็อต (วินาที)', shot), field('อัตราส่วน', aspect)),
        est),
      acc('look', '🎨 โทนภาพ (คุมทุกช็อตให้เหมือนกัน)', sm.look, true, lookBox(style)),
      acc('src', '🔗 แหล่งข้อมูล', sm.src, false, sourcesBox()),
      h('p', { class: 'hint', textContent: 'ถัดไป: ไปแท็บ “ตัวละคร/สถานที่” ให้ AI ร่างคลังจากเรื่องย่อ ตรวจแก้ แล้วไปแท็บ “ช็อต” — หรือกด “ทำขั้นถัดไป” ด้านบน' }));
  }

  // ข้อความสรุปบนหัวการ์ด (คำนวณจากโปรเจกต์ปัจจุบัน และอัปเดตสดหลังบันทึก)
  function storySums() {
    const p = cur.project;
    let srcN = 0, look = {};
    try { srcN = JSON.parse(p.sources || '[]').length; } catch { /* ข้อมูลเสีย */ }
    try { look = JSON.parse(p.look || '{}'); } catch { /* ข้อมูลเสีย */ }
    const lookName = (cur.looks || []).find((x) => x.ref && x.ref === look.ref)?.label.replace(/\s*\(.*$/, '') || (look.ref || look.light || look.film ? 'กำหนดเอง' : 'ยังไม่ตั้ง');
    return {
      story: p.premise.trim() ? `${p.premise.trim().length.toLocaleString('en-US')} ตัวอักษร` : 'ยังว่าง — วางเนื้อเรื่องที่นี่',
      prod: `${p.media === 'image' ? `🖼 ภาพนิ่ง${p.per_image > 1 ? ` (${p.per_image} ช็อต/รูป)` : ''}` : '🎬 วิดีโอ'} · ${genOf(p).name.replace(/\s*\(.*$/, '')} · ${fmtSec(p.total_sec)} · ${p.aspect}`,
      look: `โทน: ${lookName}`,
      src: srcN ? `${srcN} แหล่ง` : 'ยังไม่มี',
    };
  }
  function refreshSums() {
    if (!cur) return;
    const sm = storySums();
    for (const el of $('st-body').querySelectorAll('.st-acc-sum')) if (sm[el.dataset.k] !== undefined) el.textContent = sm[el.dataset.k];
  }

  // การ์ดพับได้ (จำสถานะเปิด/ปิดข้ามการวาดหน้าใหม่)
  const accOpen = {};
  function acc(key, title, summary, open, ...kids) {
    const sum = h('span', { class: 'st-acc-sum', textContent: summary });
    sum.dataset.k = key;
    const d = h('details', { class: 'st-acc' }, h('summary', {}, h('b', { textContent: title }), sum), h('div', { class: 'st-acc-body' }, ...kids));
    d.open = key in accOpen ? accOpen[key] : open;
    d.addEventListener('toggle', () => { accOpen[key] = d.open; });
    return d;
  }

  // ตัวเลือกเว็บสร้าง กรองตามรูปแบบช็อต (รูป/วิดีโอ) — ถ้าค่าที่เลือกไว้ทำแบบนี้ไม่ได้ ยังโชว์ไว้แต่บอกชัด ๆ ให้เปลี่ยน
  function genSelect(p) {
    const m = p.media || 'video';
    const keys = window.ARN_GEN_FOR(m);
    const sel = h('select', { 'aria-label': `สร้าง${m === 'image' ? 'รูป' : 'คลิป'}ที่ไหน` }, ...keys.map((k) => new Option(GEN[k].name, k)));
    if (GEN[p.generator] && !keys.includes(p.generator)) sel.prepend(new Option(`${GEN[p.generator].name} (ทำ${m === 'image' ? 'รูป' : 'วิดีโอ'}ไม่ได้ — เลือกใหม่)`, p.generator));
    sel.value = GEN[p.generator] ? p.generator : 'flow';
    return sel;
  }

  // ตัวเลือก "สร้างที่ไหน" ในแท็บช็อตเลย (ค่าเดียวกับในแท็บเรื่อง → การผลิต) + ลิงก์เปิดเว็บและคำแนะนำของเว็บนั้น
  // เปลี่ยนแล้วอัปเดตเฉพาะลิงก์/คำแนะนำ ไม่วาดทั้งหน้าใหม่ (กันหน้าเลื่อนกลับบนสุด/ปิดกรอบที่เปิดอยู่)
  function genPicker() {
    const p = cur.project;
    const sel = genSelect(p);
    const link = h('a', { class: 'btn sm', target: '_blank', rel: 'noopener noreferrer' });
    const tip = h('p', { class: 'hint' });
    const paint = () => {
      const g = genOf(cur.project);
      link.hidden = !g.url; link.href = g.url || '#'; link.textContent = `↗ เปิด ${g.short}`;
      tip.textContent = g.tip(cur.project.aspect, cur.project.media);
    };
    sel.addEventListener('change', () => save('PATCH', `/api/story/projects/${p.id}`, { generator: sel.value }, paint));
    paint();
    return h('div', { class: 'st-gen' },
      h('div', { class: 'row' }, h('span', { class: 'cap-label', textContent: `สร้าง${p.media === 'image' ? 'รูป' : 'คลิป'}ที่` }), sel, link), tip);
  }

  // ---------- prompt รวมฉาก: ต่อหลายช็อตเป็นย่อหน้าเดียวสำหรับโมเดลวิดีโอ (~10–15 วินาที/ครั้ง) ----------
  function mergedBox() {
    const p = cur.project;
    const box = h('section', { class: 'st-merged', hidden: true });
    const btn = h('button', { class: 'btn', type: 'button', textContent: '🎬 prompt รวมฉาก (โมเดลวิดีโอ)' });
    const sec = h('input', { type: 'number', min: 5, max: 30, step: 1, value: 16 }); // ช็อตละ 8 วิ ×2 = 16 วิ (ใกล้ 15 วิที่โมเดลวิดีโอนิยมให้)
    const list = h('div', { class: 'st-merged-list' });
    const load = () => guard(btn, async () => {
      const gs = await api('GET', `/api/story/projects/${p.id}/merged?sec=${Number(sec.value) || 16}`);
      list.replaceChildren(...(gs.length ? gs.map((g) => {
        const ta = h('textarea', { rows: 7, value: g.prompt, readOnly: true, spellcheck: false });
        const cp = h('button', { class: 'btn sm primary', type: 'button', textContent: '📋 คัดลอก' });
        cp.addEventListener('click', async () => { if (!(await copyText(g.prompt))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true); cp.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => { cp.textContent = '📋 คัดลอก'; }, 1500); });
        const span = g.positions.length > 1 ? `ช็อต ${g.positions[0]}–${g.positions[g.positions.length - 1]}` : `ช็อต ${g.positions[0]}`;
        return h('div', { class: 'st-card' }, h('div', { class: 'st-prompt-head' }, h('b', { textContent: `${span} · ${g.seconds} วิ` }), cp), ta);
      }) : [h('p', { class: 'muted', textContent: 'ยังไม่มีช็อต' })]));
      box.hidden = false;
    }, (e) => toast(e.message, true));
    btn.addEventListener('click', () => (box.hidden ? load() : (box.hidden = true)));
    sec.addEventListener('change', load);
    box.append(h('p', { class: 'hint', textContent: 'ต่อช็อตติดกันเป็นย่อหน้าเดียว (ไม่ตัดฉาก) ตามความยาวต่อครั้งของโมเดลวิดีโอ — ประกอบจากข้อมูลช็อตและโทนภาพของเรื่อง ไม่ใช้ AI ช็อตเดียวที่ยาวเกินจะเป็นกลุ่มของตัวเอง' }),
      h('div', { class: 'row' }, h('span', { class: 'cap-label', textContent: 'ความยาวต่อครั้ง (วินาที)' }), sec), list);
    return h('div', {}, btn, box);
  }

  // ---------- หลายช็อตในรูปเดียว (โหมดภาพนิ่ง): prompt ตาราง 4/12 ช่อง → แนบรูปตาราง → ตัดแบ่งเข้าช็อต ----------
  // ค่าที่เลือกเก็บในโปรเจกต์ (per_image) ตั้งได้ทั้งในแท็บเรื่อง → การผลิต และในแท็บช็อต; 1 = ทีละช็อต (ปิดกรอบนี้ไว้)
  function perSelect(p) {
    const sel = h('select', {}, new Option('1 ช็อต/รูป (ทีละช็อต — คมสุด)', '1'), new Option('4 ช็อต/รูป (ตาราง 2×2)', '4'), new Option('12 ช็อต/รูป (ตาราง 3×4 — ภาพเล็ก)', '12'));
    sel.setAttribute('aria-label', 'จำนวนช็อตต่อรูป');
    sel.value = String(p.per_image || 1);
    sel.addEventListener('change', () => save('PATCH', `/api/story/projects/${p.id}`, { per_image: Number(sel.value) }));
    return sel;
  }
  function sheetBox() {
    const p = cur.project;
    const box = h('section', { class: 'st-merged', hidden: true });
    const btn = h('button', { class: 'btn', type: 'button', textContent: '🧩 หลายช็อตในรูปเดียว' });
    const per = h('select', {}, new Option('4 ช็อต/รูป (ตาราง 2×2 — คมกว่า)', '4'), new Option('12 ช็อต/รูป (ตาราง 3×4 — ภาพเล็ก)', '12'));
    per.setAttribute('aria-label', 'จำนวนช็อตต่อรูป');
    per.value = p.per_image === 12 ? '12' : '4';
    const list = h('div', { class: 'st-merged-list' });
    const load = () => guard(btn, async () => {
      const gs = await api('GET', `/api/story/projects/${p.id}/sheet?per=${per.value}`);
      list.replaceChildren(...(gs.length ? gs.map(sheetGroup) : [h('p', { class: 'muted', textContent: 'ยังไม่มีช็อต' })]));
      box.hidden = false;
    }, (e) => toast(e.message, true));
    // ปิดกรอบ = กลับไปทำทีละช็อต (บันทึก per_image = 1), เปิด = ใช้จำนวนที่เลือก
    btn.addEventListener('click', async () => {
      if (box.hidden) { await save('PATCH', `/api/story/projects/${p.id}`, { per_image: Number(per.value) }); load(); } else { box.hidden = true; save('PATCH', `/api/story/projects/${p.id}`, { per_image: 1 }); }
    });
    per.addEventListener('change', async () => { await save('PATCH', `/api/story/projects/${p.id}`, { per_image: Number(per.value) }); load(); });
    box.append(h('p', { class: 'hint', textContent: `ให้ ${genOf(p).short} วาดหลายช็อตเป็นตารางในรูปเดียว — ตัวละครหน้าตาเหมือนกันทุกช่องและส่งน้อยครั้งกว่า แต่แต่ละช็อตได้ภาพเล็กลง (4 ช่อง ≈ ครึ่งหนึ่งของรูปเต็ม, 12 ช่อง ≈ หนึ่งในสี่ อาจแตกตอนเต็มจอ) คัดลอก prompt ไปวาง แล้วแนบรูปตารางที่ได้ ระบบจะตัดเป็นช่องและแนบเข้าช็อตให้` }),
      h('div', { class: 'row' }, h('span', { class: 'cap-label', textContent: 'จำนวนช็อตต่อรูป' }), per), list);
    if (p.per_image > 1) load();
    return h('div', {}, btn, box);
  }
  function sheetGroup(g) {
    const first = g.shots[0].position, last = g.shots[g.shots.length - 1].position;
    const span = g.shots.length > 1 ? `ช็อต ${first}–${last}` : `ช็อต ${first}`;
    const ta = h('textarea', { rows: 7, value: g.prompt, readOnly: true, spellcheck: false });
    const cp = h('button', { class: 'btn sm primary', type: 'button', textContent: '📋 คัดลอก' });
    cp.addEventListener('click', async () => { if (!(await copyText(g.prompt))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true); cp.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => { cp.textContent = '📋 คัดลอก'; }, 1500); });
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp', hidden: true });
    const pick = h('button', { class: 'btn sm', type: 'button', textContent: `📎 แนบรูปตาราง → ตัดเข้า${span}` });
    const stage = h('div', { class: 'st-sheet', hidden: true });
    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const f = input.files[0]; input.value = '';
      if (f) guard(pick, () => sliceSheet(f, g, stage), (e) => toast(e.message, true));
    });
    return h('div', { class: 'st-card' },
      h('div', { class: 'st-prompt-head' }, h('b', { textContent: `${span} · ตาราง ${g.cols}×${g.rows}` }), cp), ta,
      h('div', { class: 'row' }, pick, input), stage);
  }
  // ตัดรูปตารางเป็นช่องเท่าๆ กัน (เผื่อขอบ ~2% ต่อด้านกันเส้นคั่นสีขาวติดมา) → โชว์ตัวอย่างว่าช่องไหนเข้าช็อตไหน → กดยืนยันแล้วค่อยอัปโหลด
  async function sliceSheet(file, g, stage) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('รองรับเฉพาะรูป .png .jpg .webp');
    const bmp = await createImageBitmap(file);
    const cw = bmp.width / g.cols, ch = bmp.height / g.rows;
    const ix = Math.round(cw * 0.02), iy = Math.round(ch * 0.02);
    const pieces = [];
    for (let i = 0; i < g.shots.length; i++) {
      const x = (i % g.cols) * cw, y = Math.floor(i / g.cols) * ch;
      const w = Math.floor(cw - ix * 2), hh = Math.floor(ch - iy * 2);
      const c = h('canvas', { width: w, height: hh });
      c.getContext('2d').drawImage(bmp, Math.round(x + ix), Math.round(y + iy), w, hh, 0, 0, w, hh);
      pieces.push({ shot: g.shots[i], blob: await new Promise((r) => c.toBlob(r, 'image/png')), url: c.toDataURL('image/jpeg', 0.7), w, h: hh });
    }
    bmp.close();
    const replace = pieces.filter((x) => x.shot.has).length;
    const ok = h('button', { class: 'btn sm primary', type: 'button', textContent: `✓ แนบ ${pieces.length} ช็อต${replace ? ` (แทนรูปเดิม ${replace})` : ''}` });
    const cancel = h('button', { class: 'btn sm ghost', type: 'button', textContent: 'ยกเลิก' });
    cancel.addEventListener('click', () => { stage.hidden = true; stage.replaceChildren(); });
    ok.addEventListener('click', () => guard(ok, async () => {
      for (const [n, x] of pieces.entries()) {
        ok.textContent = `⏳ กำลังแนบ ${n + 1}/${pieces.length}`;
        const r = await fetch(`/api/story/shots/${x.shot.id}/video`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: x.blob });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`ช็อต ${x.shot.position}: ${data.error || `อัปโหลดไม่สำเร็จ (${r.status})`}`);
        cur = data; x.shot.has = true;
        refreshCard(x.shot.id);
      }
      refreshSums();
      stage.hidden = true; stage.replaceChildren();
      toast(`แนบรูปเข้าช็อต ${pieces[0].shot.position}–${pieces[pieces.length - 1].shot.position} แล้ว ✓`);
    }, (e) => toast(e.message, true)));
    const small = pieces[0].w < 400 ? ' — ช่องเล็ก อาจไม่คมตอนเต็มจอ' : '';
    stage.replaceChildren(
      h('p', { class: 'hint', textContent: `ตัดได้ ${pieces.length} ช่อง ช่องละ ${pieces[0].w}×${pieces[0].h} พิกเซล${small} — ตรวจว่าช่องตรงช็อตก่อนกดแนบ` }),
      h('div', { class: 'st-sheet-grid' }, ...pieces.map((x) => h('figure', {},
        h('img', { src: x.url, alt: `ช็อต ${x.shot.position}` }),
        h('figcaption', { textContent: `ช็อต ${x.shot.position}${x.shot.has ? ' · แทนรูปเดิม' : ''}` })))),
      h('div', { class: 'row' }, ok, cancel));
    stage.hidden = false;
  }

  // ---------- โทนภาพของเรื่อง (ใส่ซ้ำทุก prompt) ----------
  function lookBox(styleField) {
    const p = cur.project;
    let look = {};
    try { look = JSON.parse(p.look || '{}'); } catch { /* ข้อมูลเสีย */ }
    const preset = h('select', {}, new Option('— เลือกโทนสำเร็จรูป —', ''), ...(cur.looks || []).map((x) => new Option(x.label, x.id)));
    preset.value = (cur.looks || []).find((x) => x.ref && x.ref === look.ref)?.id || ''; // โชว์โทนที่ใช้อยู่ (ถ้าตรงพรีเซ็ต)
    const f = (key, label, ph) => { const el = h('textarea', { rows: 4, value: look[key] || '', maxLength: 400, placeholder: ph, spellcheck: false }); el.dataset.k = key; return [el, field(label, el)]; };
    const [refEl, refF] = f('ref', 'แนวอ้างอิง', 'เช่น classic Hong Kong martial arts cinema');
    const [lightEl, lightF] = f('light', 'แสงและบรรยากาศ', 'เช่น golden sunlight cutting through dust, moody amber atmosphere');
    const [filmEl, filmF] = f('film', 'เนื้อภาพ / ฟิล์ม', 'เช่น vintage 35mm film grain, deep sepia shadows');
    const [soundEl, soundF] = f('sound', 'เสียง (ใช้กับ prompt วิดีโอ)', 'เช่น traditional percussion, realistic combat sound effects');
    const els = [refEl, lightEl, filmEl, soundEl];
    const saved = () => Object.fromEntries(els.map((e) => [e.dataset.k, String(look[e.dataset.k] || '')]));
    const restore = () => { els.forEach((e) => { e.value = saved()[e.dataset.k]; }); preset.value = (cur.looks || []).find((x) => x.ref && x.ref === look.ref)?.id || ''; };
    // บันทึกโทน = ประกอบ prompt ทุกช็อตใหม่ (ทับที่แก้เอง) → ถ้ามีช็อตแล้ว ถามครั้งแรกครั้งเดียวต่อการเปิดหน้านี้
    let okRebuild = false;
    const persist = async () => {
      if (cur.shots.length && !okRebuild) {
        if (!(await uiConfirm(`เปลี่ยนโทนภาพจะประกอบ prompt ใหม่ทั้ง ${cur.shots.length} ช็อต (prompt ที่แก้เองจะถูกทับ) — ไฟล์ที่แนบไว้ยังอยู่`, { title: 'เปลี่ยนโทนภาพ', ok: 'เปลี่ยน' }))) { restore(); return; }
        okRebuild = true;
      }
      const next = Object.fromEntries(els.map((e) => [e.dataset.k, e.value]));
      await save('PATCH', `/api/story/projects/${p.id}`, { look: next }, () => toast(cur.shots.length ? 'บันทึกโทนภาพแล้ว — ประกอบ prompt ทุกช็อตใหม่ให้แล้ว' : 'บันทึกโทนภาพแล้ว')) && (look = next);
    };
    els.forEach((e) => e.addEventListener('change', persist));
    preset.addEventListener('change', async () => {
      const x = (cur.looks || []).find((y) => y.id === preset.value);
      if (!x) return;
      // ช่องที่พิมพ์เองไว้ (ไม่ใช่ค่าจากพรีเซ็ตเดิม) จะถูกทับ → ถามก่อน
      const custom = els.some((e) => e.value.trim()) && !(cur.looks || []).some((y) => y.ref === refEl.value && y.light === lightEl.value && y.film === filmEl.value && y.sound === soundEl.value);
      if (custom && !(await uiConfirm('แทนที่ข้อความโทนภาพที่แก้เองไว้ด้วยโทนสำเร็จรูปนี้?', { title: 'ใช้โทนสำเร็จรูป', ok: 'แทนที่' }))) { restore(); return; }
      refEl.value = x.ref; lightEl.value = x.light; filmEl.value = x.film; soundEl.value = x.sound;
      persist();
    });
    return h('div', { class: 'st-look' },
      h('p', { class: 'hint', textContent: 'ข้อความเหล่านี้ถูกใส่ซ้ำในทุก prompt ของเรื่อง (รูป คลิป และ prompt รวมฉาก) เลือกโทนสำเร็จรูปแล้วแก้ต่อได้ — บันทึกแล้วประกอบ prompt ทุกช็อตใหม่ (ทับ prompt ที่แก้เองไว้)' }),
      field('โทนสำเร็จรูป', preset),
      h('div', { class: 'st-grid2' }, refF, lightF, filmF, soundF),
      field('สไตล์ภาพหลัก (ไม่บังคับ)', styleField, 'ว่าง = ใช้สไตล์ประจำเพจจากตั้งค่า (อังกฤษ)'));
  }

  // ---------- แหล่งข้อมูลของเรื่อง (เก็บกับโปรเจกต์ ไม่ใส่ใน prompt) ----------
  function sourcesBox() {
    const p = cur.project;
    let rows = [];
    try { rows = JSON.parse(p.sources || '[]'); } catch { /* ข้อมูลเสีย */ }
    const box = h('div', { class: 'st-src' });
    const persist = () => save('PATCH', `/api/story/projects/${p.id}`, { sources: rows.filter((r) => r.title || r.url || r.note) });
    const paint = () => {
      box.replaceChildren(...rows.map((r, i) => {
        const title = h('input', { value: r.title, maxLength: 150, placeholder: 'ชื่อแหล่ง เช่น Wuxiaworld ตอน 1651' });
        const url = h('input', { value: r.url, maxLength: 500, placeholder: 'https://…', spellcheck: false });
        const note = h('input', { value: r.note, maxLength: 300, placeholder: 'โน้ต เช่น เปิดได้เฉพาะ teaser' });
        const open = h('a', { class: 'btn sm', textContent: '↗ เปิด', target: '_blank', rel: 'noopener noreferrer' });
        const syncOpen = () => { open.hidden = !/^https?:\/\//i.test(url.value.trim()); if (!open.hidden) open.href = url.value.trim(); };
        syncOpen();
        const del = h('button', { class: 'btn sm danger', type: 'button', textContent: '🗑', title: 'ลบแหล่งนี้' });
        for (const [el, k] of [[title, 'title'], [url, 'url'], [note, 'note']]) el.addEventListener('change', () => { r[k] = el.value.trim(); syncOpen(); persist(); });
        del.addEventListener('click', () => { rows.splice(i, 1); persist(); paint(); });
        return h('div', { class: 'st-card' }, h('div', { class: 'st-row2' }, title, open, del), url, note);
      }));
    };
    paint();
    const add = h('button', { class: 'btn sm', type: 'button', textContent: '＋ เพิ่มแหล่งข้อมูล' });
    add.addEventListener('click', () => { rows.push({ title: '', url: '', note: '' }); paint(); });
    return h('div', {},
      h('p', { class: 'hint', textContent: 'เก็บลิงก์ที่ใช้อ่านเนื้อเรื่องไว้กับโปรเจกต์ (ไม่ถูกใส่ใน prompt) ครั้งหน้าเปิดอ่านจากแหล่งเดิมได้เลย' }),
      box, h('div', { class: 'row' }, add));
  }

  // ---------- แท็บ: ตัวละคร/สถานที่/ของประกอบ ----------
  function viewBible() {
    const p = cur.project;
    const ai = h('button', { class: 'btn primary', type: 'button', textContent: '✨ ให้ AI ร่างจากเรื่องย่อ' });
    ai.addEventListener('click', () => guard(ai, async () => {
      const r = await api('POST', `/api/story/projects/${p.id}/ai-bible`, {});
      cur = r;
      toast(r.added ? `AI ร่างเพิ่ม ${r.added} รายการ — ตรวจแก้คำอธิบายได้` : 'ไม่มีรายการใหม่ (มีครบแล้ว)');
      await loadList(p.id);
      render();
    }, (e) => { $('st-msg').textContent = e.message; }));
    const secs = ['character', 'location', 'prop'].map((kind) => {
      const items = cur.entities.filter((e) => e.kind === kind);
      const add = h('button', { class: 'btn sm', type: 'button', textContent: '＋ เพิ่ม' });
      add.addEventListener('click', () => guard(add, async () => {
        await api('POST', `/api/story/projects/${p.id}/entities`, { kind, name: kind === 'character' ? 'ตัวละครใหม่' : kind === 'location' ? 'สถานที่ใหม่' : 'ของใหม่' });
        await loadList(p.id); render();
      }));
      return h('section', { class: 'st-sec' },
        h('div', { class: 'st-sec-head' }, h('h3', { textContent: `${KIND_TH[kind]} (${items.length})` }), add),
        ...items.map(entityCard),
        ...(items.length ? [] : [h('p', { class: 'muted', textContent: 'ยังไม่มี' })]));
    });
    return h('div', { class: 'st-pane' },
      h('p', { class: 'hint', textContent: 'คำอธิบาย (desc) เป็นภาษาอังกฤษ จะถูกใส่ซ้ำคำต่อคำในทุก prompt ที่มีรายการนี้ เพื่อให้หน้าตา/ชุด/สถานที่เหมือนเดิมทุกช็อต — เขียนให้ชัดและคงที่ (อายุ ทรงผม สีผม ชุดและสี ลักษณะเด่น)' }),
      h('div', { class: 'row' }, ai), ...secs);
  }

  function entityCard(e) {
    const name = h('input', { value: e.name, maxLength: 80, placeholder: 'ชื่อ (ไทย)' });
    const alias = h('input', { value: e.alias || '', maxLength: 60, placeholder: 'ชื่อใน prompt (อังกฤษ) เช่น Han Li' });
    const desc = h('textarea', { rows: 3, value: e.desc, maxLength: 500, placeholder: 'คำอธิบายภาพ (อังกฤษ)', spellcheck: false });
    const notes = h('input', { value: e.notes, maxLength: 300, placeholder: 'โน้ตของเรา (ไม่ใส่ใน prompt)' });
    const del = h('button', { class: 'btn sm danger', type: 'button', textContent: '🗑', title: 'ลบรายการนี้' });
    const upd = async (k, v) => { // ผลต่อ prompt จะคำนวณใหม่ตอนไปแท็บช็อต (โหลดสดทุกครั้งที่เปลี่ยนแท็บ)
      try { await api('PATCH', `/api/story/entities/${e.id}`, { [k]: v }); $('st-msg').textContent = ''; } catch (err) { $('st-msg').textContent = err.message; toast(err.message, true); }
    };
    name.addEventListener('change', () => upd('name', name.value));
    alias.addEventListener('change', () => upd('alias', alias.value));
    desc.addEventListener('change', () => upd('desc', desc.value));
    notes.addEventListener('change', () => upd('notes', notes.value));
    del.addEventListener('click', () => guard(del, async () => {
      if (!(await uiConfirm(`ลบ “${e.name}” ออกจากคลัง? (ช็อตที่ใช้รายการนี้จะถูกเอาออก)`, { title: 'ลบรายการ', ok: 'ลบ', danger: true }))) return;
      await api('DELETE', `/api/story/entities/${e.id}`);
      await loadList(cur?.project.id ?? list[0]?.id); render();
    }));
    return h('div', { class: 'st-card' }, h('div', { class: 'st-row2' }, name, alias, del), desc, notes);
  }

  // ---------- แท็บ: ช็อต ----------
  function viewShots() {
    const p = cur.project;
    const planned = cur.planned;
    const ai = h('button', { class: 'btn primary', type: 'button', textContent: cur.shots.length ? `↻ ให้ AI แบ่งช็อตใหม่ (${planned} ช็อต)` : `✨ ให้ AI แบ่งช็อต (${planned} ช็อต)` });
    ai.addEventListener('click', () => guard(ai, async () => {
      if (!p.premise.trim()) throw new Error('ใส่เรื่องย่อก่อน (แท็บ “เรื่อง”)');
      if (cur.shots.length && !(await uiConfirm('แบ่งช็อตใหม่จะเขียนทับช็อตทั้งหมดที่มี (รวมที่คุณแก้ไว้ และคลิปที่แนบไว้จะถูกลบ)?', { title: 'แบ่งช็อตใหม่', ok: 'เขียนทับ', danger: true }))) return;
      cur = await api('POST', `/api/story/projects/${p.id}/ai-shots`, { replace: true });
      await loadList(p.id); render();
    }, (e) => { $('st-msg').textContent = e.message; }));
    const rebuild = h('button', { class: 'btn', type: 'button', textContent: '↻ ประกอบ prompt ใหม่ทั้งหมด', title: 'ประกอบจากคลัง+ช็อตใหม่ (ทับ prompt ที่แก้เองไว้)' });
    rebuild.addEventListener('click', () => guard(rebuild, async () => {
      if (!(await uiConfirm('ประกอบ prompt ใหม่ทุกช็อต — ทับ prompt ที่คุณแก้เองไว้ด้วย?', { title: 'ประกอบ prompt ใหม่', ok: 'ทับ' }))) return;
      cur = await api('POST', `/api/story/projects/${p.id}/rebuild-prompts`, {}); render();
    }));
    const copyAll = h('button', { class: 'btn', type: 'button', textContent: '📋 คัดลอก prompt ทั้งหมด' });
    copyAll.addEventListener('click', async () => {
      const text = cur.shots.map((s) => `ช็อต ${s.position}\n${s.prompt}`).join('\n\n');
      if (!text) return toast('ยังไม่มีช็อต', true);
      if (!(await copyText(text))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
      copyAll.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => { copyAll.textContent = '📋 คัดลอก prompt ทั้งหมด'; }, 1500);
    });
    // แนบหลายไฟล์พร้อมกัน: เรียงตามชื่อไฟล์ (ตัวเลขตามลำดับ) → ลงช็อตที่ยังไม่มีไฟล์ตามลำดับ
    const many = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/png,image/jpeg,image/webp,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.mp4,.webm' });
    const manyBtn = h('button', { class: 'btn', type: 'button', textContent: `📎 แนบ${p.media === 'image' ? 'รูป' : 'ไฟล์'}หลายไฟล์ (เรียงตามชื่อ)`, title: 'เลือกไฟล์ทั้งหมดที่สร้างไว้ แล้วตรวจว่ารูปไหนลงช็อตไหนก่อนแนบ' });
    manyBtn.addEventListener('click', () => many.click());
    // ขั้นตรวจก่อนแนบ: โชว์รูปทุกไฟล์คู่กับช็อตที่จะลง ให้เห็นและเปลี่ยนช็อตได้ก่อนอัปโหลดจริง
    // (ชื่อไฟล์จาก ChatGPT เป็นวันที่/เวลา เรียงตามชื่ออาจไม่ตรงลำดับที่สร้าง จึงมีเรียงตามเวลาไฟล์ให้เลือกด้วย)
    const stage = h('div', { class: 'st-map', hidden: true });
    many.addEventListener('change', () => {
      const files = [...many.files]; many.value = '';
      if (files.length) openStage(files);
    });
    function openStage(files) {
      const coll = new Intl.Collator('en', { numeric: true });
      const items = files.map((f) => ({ f, url: f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name) ? URL.createObjectURL(f) : '' }));
      const done = () => { items.forEach((x) => x.url && URL.revokeObjectURL(x.url)); stage.hidden = true; stage.replaceChildren(); };
      const assign = () => { // ใส่ลงช็อตที่ยังว่างก่อน ตามลำดับที่เรียงอยู่
        const empty = cur.shots.filter((s) => !s.video_file || s.status === 'rejected').map((s) => s.id);
        items.forEach((x, i) => { x.shot = empty[i] ?? null; });
      };
      const sortBy = (how) => { items.sort(how === 'time' ? (a, b) => a.f.lastModified - b.f.lastModified || coll.compare(a.f.name, b.f.name) : (a, b) => coll.compare(a.f.name, b.f.name)); assign(); paint(); };
      const paint = () => {
        const rows = items.map((x) => {
          const sel = h('select', {}, new Option('— ไม่ใช้ไฟล์นี้ —', ''), ...cur.shots.map((s) => new Option(`ช็อต ${s.position}${s.beat ? ` · ${s.beat.slice(0, 28)}` : ''}${s.video_file ? ' (มีไฟล์แล้ว → แทนที่)' : ''}`, String(s.id))));
          sel.value = x.shot ? String(x.shot) : '';
          sel.addEventListener('change', () => { x.shot = sel.value ? Number(sel.value) : null; });
          return h('div', { class: 'st-map-row' },
            x.url ? h('img', { src: x.url, alt: x.f.name }) : h('div', { class: 'st-map-ph', textContent: '🎞' }),
            h('span', { class: 'st-map-name', textContent: x.f.name, title: x.f.name }), h('span', { textContent: '→' }), sel);
        });
        const byName = h('button', { class: 'btn sm', type: 'button', textContent: 'เรียงตามชื่อไฟล์' });
        const byTime = h('button', { class: 'btn sm', type: 'button', textContent: 'เรียงตามเวลาไฟล์ (ลำดับที่ดาวน์โหลด)' });
        const ok = h('button', { class: 'btn primary', type: 'button', textContent: `✓ แนบ ${items.filter((x) => x.shot).length} ไฟล์ตามนี้` });
        const cancel = h('button', { class: 'btn', type: 'button', textContent: 'ยกเลิก' });
        byName.addEventListener('click', () => sortBy('name')); byTime.addEventListener('click', () => sortBy('time')); cancel.addEventListener('click', done);
        ok.addEventListener('click', () => guard(ok, async () => {
          const use = items.filter((x) => x.shot);
          if (!use.length) throw new Error('ยังไม่ได้เลือกช็อตให้ไฟล์ไหนเลย');
          const dup = use.find((x, i) => use.findIndex((y) => y.shot === x.shot) !== i);
          if (dup) throw new Error(`ช็อต ${cur.shots.find((s) => s.id === dup.shot).position} ถูกเลือกซ้ำ — แต่ละช็อตใส่ได้ไฟล์เดียว`);
          for (const [i, x] of use.entries()) { ok.textContent = `กำลังอัปโหลด ${i + 1}/${use.length}…`; await uploadVideo(cur.shots.find((s) => s.id === x.shot), x.f); }
          done(); toast(`แนบ ${use.length} ไฟล์แล้ว ✓`); await loadList(p.id); render();
        }, (e) => { toast(e.message, true); paint(); }));
        stage.replaceChildren(
          h('h3', { textContent: 'ตรวจก่อนแนบ — รูปไหนลงช็อตไหน' }),
          h('p', { class: 'hint', textContent: 'ดูรูปแล้วเปลี่ยนช็อตจากรายการด้านขวาได้ถ้าลำดับไม่ตรง ยังไม่อัปโหลดจนกว่าจะกด “แนบ”' }),
          h('div', { class: 'row' }, byName, byTime),
          ...rows, h('div', { class: 'row' }, ok, cancel));
        stage.hidden = false;
      };
      sortBy('name');
    }
    const add = h('button', { class: 'btn', type: 'button', textContent: '＋ เพิ่มช็อต' });
    add.addEventListener('click', () => guard(add, async () => { cur = await api('POST', `/api/story/projects/${p.id}/shots`, {}); await loadList(p.id); render(); }));
    const done = cur.shots.filter((s) => s.status === 'generated' || s.status === 'approved').length;
    const totalSec = cur.shots.reduce((a, s) => a + s.duration, 0);
    const wrap = h('div', { class: 'st-pane' },
      h('div', { class: 'row' }, ai, rebuild, copyAll, manyBtn, many, add),
      genPicker(),
      p.media === 'image' ? sheetBox() : mergedBox(),
      stage,
      h('p', { class: 'hint', textContent: cur.shots.length ? `${cur.shots.length} ช็อต · รวม ${fmtSec(totalSec)} · สร้างแล้ว ${done}/${cur.shots.length} — วาง prompt ทีละช็อตใน ${genOf(p).short} แล้วแนบ${p.media === 'image' ? 'รูป' : 'คลิป'}ที่ได้เข้าช็อต` : 'ยังไม่มีช็อต — ตั้งคลังตัวละครให้เรียบร้อยก่อน แล้วกด “ให้ AI แบ่งช็อต”' }));
    wrap.append(assemblePanel());
    cur.shots.forEach((s, i) => wrap.append(shotCard(s, i)));
    return wrap;
  }

  // ---------- รวมคลิปทุกช็อตเป็นเรื่องเดียว ----------
  function assemblePanel() {
    const p = cur.project;
    const calc = () => cur.shots.filter((s) => s.video_file && s.status !== 'rejected'); // คำนวณสดทุกครั้ง (แนบ/รีวิวคลิปแล้วตัวเลขเปลี่ยน)
    const chk = (label, on, disabled = false, title = '') => { const i = h('input', { type: 'checkbox', checked: on, disabled }); return [i, h('label', { class: 'st-opt', title }, i, label)]; };
    const [voice, voiceL] = chk('เสียงบรรยาย (อ่านคำบรรยายของแต่ละช็อต)', !!status.tts && cur.shots.some((s) => s.narration), !status.tts, status.tts ? '' : 'ยังไม่ได้ตั้งค่าเสียงพากย์ในตั้งค่า');
    const [subs, subsL] = chk('ซับไตเติล (ข้อความบรรยายบนจอ)', true);
    const still = p.media === 'image', noun = still ? 'รูป' : 'คลิป';
    const [keep, keepL] = chk('คงเสียงเดิมในคลิป', false);
    keepL.hidden = still; // ภาพนิ่งไม่มีเสียงเดิมให้คง
    const [logo, logoL] = chk('ลายน้ำโลโก้', !!status.logo && status.brand?.logoOn !== false, !status.logo, status.logo ? '' : 'ยังไม่ได้ตั้งโลโก้ (ตั้งค่า → สไตล์ประจำเพจ)');
    const music = h('select', {}); fillMusic(music, 'none');
    const badge = h('input', { placeholder: 'ป้ายมุมคลิป เช่น ตอนที่ 20 (ไม่บังคับ)', maxLength: 40 });
    const go = h('button', { class: 'btn primary', type: 'button' });
    const upd = () => { const n = calc().length; go.textContent = `🎞 รวมเป็นคลิปเดียว (${n} ช็อต)`; go.disabled = !n; };
    upd();
    go.addEventListener('click', () => guard(go, async () => {
      const have = calc();
      const missing = cur.shots.filter((s) => !s.video_file && s.status !== 'rejected').length;
      if (missing && !(await uiConfirm(`ยังมี ${missing} ช็อตที่ยังไม่มี${noun} — รวมเฉพาะช็อตที่มี${noun} (ข้ามช็อตที่เหลือ)?`, { title: 'รวมคลิป', ok: 'รวมเลย' }))) return;
      go.textContent = '⏳ กำลังรวมคลิป…';
      await assemble(have, { voice: voice.checked, subs: subs.checked, keepAudio: keep.checked, music: music.value, logo: logo.checked && status.logo ? `/brand/logo.png?v=${status.logo.v}` : '', badge: badge.value.trim() });
    }, (e) => { $('st-msg').textContent = e.message; toast(e.message, true); }).finally(upd));
    const panel = h('section', { class: 'st-asm' },
      h('h3', { textContent: '🎞 รวมเป็นคลิปเดียว' }),
      h('p', { class: 'hint', textContent: `ต่อ${noun}ของช็อตที่แนบแล้ว (ยกเว้นที่ติด ❌) ตามลำดับ${still ? ' แต่ละรูปซูม/แพนช้า ๆ ' : ' '}เป็นวิดีโอ ${p.aspect} คลิปเดียว บันทึกเข้าคลังคลิป — ใช้เวลาเท่าความยาวคลิป ต้องเปิดหน้านี้ค้างไว้ (กด ✕ หยุด ที่การ์ดความคืบหน้าได้)` }),
      h('div', { class: 'st-opts' }, voiceL, subsL, keepL, logoL),
      h('div', { class: 'st-row' }, field('เพลงประกอบ', music), field('ป้ายบนคลิป', badge)),
      h('div', { class: 'row' }, go));
    panel.updateCount = upd;
    return panel;
  }

  async function assemble(shots, o) {
    const p = cur.project;
    const canvas = document.createElement('canvas');
    canvas.id = 'rec';
    document.body.append(canvas);
    const ctrl = new AbortController(); // ปุ่ม "หยุด" บนการ์ดความคืบหน้า → เลิกรวม ไม่บันทึกอะไรลงคลัง
    const tid = task.start(`รวมคลิป “${p.title}”`, 0.02, 'กำลังรวมคลิป', ctrl);
    let ok = false;
    try {
      const th = status.themes.find((t) => t.id === status.brand?.theme) || status.themes[0];
      const r = await ReelRender.assemble(shots.map((s) => ({ url: `/story-media/${s.video_file}`, narration: s.narration, duration: s.duration })), {
        ...o, canvas, aspect: p.aspect, theme: th, signal: ctrl.signal,
        onProgress: (x) => task.set(tid, 0.1 + x * 0.82, `กำลังรวมคลิป “${p.title}”`),
        onStatus: (t) => task.set(tid, /เสียง/.test(t) ? 0.06 : 0.04, t),
      });
      task.set(tid, 0.94, 'กำลังบันทึกลงคลังคลิป…');
      const clip = await api('POST', '/api/clips', {
        title: `${p.title} (รวมเรื่อง)`, brief: p.premise.slice(0, 12000), script: shots.map((s) => s.narration).filter(Boolean).join('\n').slice(0, 4900),
        theme: th.id, voice: false, music: 'none', badge: o.badge, kind: 'story',
      });
      if (r.thumb) await fetch(`/api/clips/${clip.id}/thumb`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: r.thumb }).catch(() => {});
      const res = await fetch(`/api/clips/${clip.id}/video`, { method: 'PUT', headers: { 'content-type': r.mime, 'x-duration': String(r.duration) }, body: r.blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      ok = true;
      await withCaption(data); // แคปชัน/แฮชแท็กให้ทันที (พลาดก็ไม่ล้มงาน)
      await refresh();
      toast(`รวมคลิปเสร็จแล้ว ✓ — ดูในคลังคลิป (${Math.round(r.duration)} วิ)`);
    } finally {
      canvas.remove();
      task.end(tid, ok ? 800 : 0);
    }
  }

  function shotCard(s, i) {
    const ents = cur.entities;
    const byKind = (k) => ents.filter((e) => e.kind === k);
    const upd = (body) => save('PATCH', `/api/story/shots/${s.id}`, body, () => repaint(s.id));
    const scene = h('input', { value: s.scene, maxLength: 80, placeholder: 'ฉาก' });
    const beat = h('input', { value: s.beat, maxLength: 300, placeholder: 'เหตุการณ์ของช็อตนี้ (ไทย)' });
    const loc = h('select', {}, new Option('— สถานที่ —', ''), ...byKind('location').map((e) => new Option(e.name, String(e.id))));
    loc.value = s.location_id ? String(s.location_id) : '';
    const chip = (e, key) => {
      const on = () => cur.shots.find((x) => x.id === s.id)[key].includes(e.id);
      const b = h('button', { class: 'st-chip', type: 'button', textContent: e.name, 'aria-pressed': String(on()) });
      b.addEventListener('click', () => {
        const now = cur.shots.find((x) => x.id === s.id)[key];
        const next = now.includes(e.id) ? now.filter((x) => x !== e.id) : [...now, e.id];
        b.setAttribute('aria-pressed', String(next.includes(e.id)));
        upd({ [key]: next });
      });
      return b;
    };
    const action = h('textarea', { rows: 2, value: s.action, maxLength: 600, placeholder: 'Action — ภาพ/การกระทำ (อังกฤษ)', spellcheck: false });
    const still = cur.project.media === 'image';
    const camera = h('input', { value: s.camera, maxLength: 200, placeholder: still ? 'Framing — มุม/ระยะภาพ (อังกฤษ) เช่น close-up, low angle' : 'Camera (อังกฤษ)', spellcheck: false });
    const visText = h('input', { value: s.visible_text || '', maxLength: 120, placeholder: 'ข้อความที่ต้องเห็นในภาพ เช่น 09:07 บนนาฬิกา (ว่าง = ไม่มีตัวหนังสือ)', spellcheck: false });
    const narr = h('textarea', { rows: 2, value: s.narration, maxLength: 300, placeholder: 'คำบรรยาย (ไทย)' });
    const dur = h('input', { type: 'number', min: 2, max: 20, step: 1, value: s.duration });
    const before = h('input', { value: s.state_before, maxLength: 300, placeholder: 'สถานะต้นช็อต (อังกฤษ)', spellcheck: false });
    const after = h('input', { value: s.state_after, maxLength: 300, placeholder: 'สถานะท้ายช็อต (อังกฤษ)', spellcheck: false });
    const prompt = h('textarea', { rows: 6, value: s.prompt, maxLength: 3000, spellcheck: false });
    const stat = h('select', {}, ...Object.entries(STATUS_SHOT).map(([k, v]) => new Option(v, k)));
    stat.value = s.status;
    const warn = h('div', { class: 'st-warn' });
    const copy = h('button', { class: 'btn sm primary', type: 'button', textContent: '📋 คัดลอก prompt' });
    copy.addEventListener('click', async () => {
      if (!(await copyText(prompt.value))) return toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', true);
      copy.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => { copy.textContent = '📋 คัดลอก prompt'; }, 1500);
    });
    const up = h('button', { class: 'btn sm ghost', type: 'button', textContent: '▲', title: 'เลื่อนขึ้น' });
    const down = h('button', { class: 'btn sm ghost', type: 'button', textContent: '▼', title: 'เลื่อนลง' });
    const del = h('button', { class: 'btn sm danger', type: 'button', textContent: '🗑', title: 'ลบช็อต' });
    for (const [b, dir] of [[up, 'up'], [down, 'down']]) b.addEventListener('click', () => guard(b, async () => { cur = await api('POST', `/api/story/shots/${s.id}/move`, { dir }); render(); }));
    del.addEventListener('click', () => guard(del, async () => {
      if (!(await uiConfirm(`ลบช็อตที่ ${s.position}?`, { title: 'ลบช็อต', ok: 'ลบ', danger: true }))) return;
      cur = await api('DELETE', `/api/story/shots/${s.id}`); await loadList(cur.project.id); render();
    }));
    scene.addEventListener('change', () => upd({ scene: scene.value }));
    beat.addEventListener('change', () => upd({ beat: beat.value }));
    loc.addEventListener('change', () => upd({ location_id: loc.value ? Number(loc.value) : null }));
    action.addEventListener('change', () => upd({ action: action.value }));
    camera.addEventListener('change', () => upd({ camera: camera.value }));
    narr.addEventListener('change', () => upd({ narration: narr.value }));
    visText.addEventListener('change', () => upd({ visible_text: visText.value }));
    dur.addEventListener('change', () => upd({ duration: Number(dur.value) }));
    before.addEventListener('change', () => upd({ state_before: before.value }));
    after.addEventListener('change', () => upd({ state_after: after.value }));
    prompt.addEventListener('change', () => save('PATCH', `/api/story/shots/${s.id}`, { prompt: prompt.value }, () => repaint(s.id)));
    stat.addEventListener('change', () => upd({ status: stat.value }));
    const vbox = h('div', { class: 'st-video' });
    const card = h('article', { class: 'st-shot', id: `st-shot-${s.id}` },
      h('div', { class: 'st-shot-head' }, h('b', { textContent: `ช็อต ${s.position}` }), scene, stat, h('span', { class: 'grow' }), up, down, del),
      warn,
      beat,
      h('div', { class: 'st-row' }, field('สถานที่', loc), field('ความยาว (วิ)', dur)),
      field('ตัวละครในช็อต', h('div', { class: 'st-chips' }, ...byKind('character').map((e) => chip(e, 'character_ids')), ...(byKind('character').length ? [] : [h('span', { class: 'muted', textContent: 'ยังไม่มีตัวละคร — เพิ่มที่แท็บคลัง' })]))),
      ...(byKind('prop').length ? [field('ของประกอบ', h('div', { class: 'st-chips' }, ...byKind('prop').map((e) => chip(e, 'prop_ids'))))] : []),
      action, camera, visText, narr,
      h('div', { class: 'st-row' }, field('สถานะต้นช็อต', before), field('สถานะท้ายช็อต', after)),
      h('div', { class: 'st-prompt-head' }, h('span', { class: 'cap-label', textContent: still ? `Prompt สร้างรูป (แก้ได้) — วางใน ${genOf(cur.project).name}` : `Prompt วิดีโอ (แก้ได้) — วางใน ${genOf(cur.project).name}` }), copy),
      prompt,
      vbox);
    card.dataset.i = String(i);
    card._refs = { prompt, warn, before, stat };
    paintWarn(card, s.id);
    paintVideo(vbox, s);
    return card;
  }

  // ---------- คลิปของช็อต: แนบ / ดูตัวอย่าง / รีวิว ----------
  function refreshCard(id) {
    const old = document.getElementById(`st-shot-${id}`);
    const i = cur.shots.findIndex((x) => x.id === id);
    if (old && i >= 0) old.replaceWith(shotCard(cur.shots[i], i));
    document.querySelector('#st-body .st-asm')?.updateCount?.();
  }

  async function uploadVideo(shot, file) {
    const byExt = { webm: 'video/webm', mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[(/\.(\w+)$/.exec(file.name) || [])[1]?.toLowerCase()];
    const type = file.type || byExt || '';
    if (!['video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new Error('รองรับเฉพาะ .mp4 .webm หรือรูป .png .jpg .webp');
    const r = await fetch(`/api/story/shots/${shot.id}/video`, { method: 'PUT', headers: { 'content-type': type }, body: file });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `อัปโหลดไม่สำเร็จ (${r.status})`);
    cur = data;
    refreshCard(shot.id);
    toast(`แนบ${type.startsWith('image/') ? 'รูป' : 'คลิป'}ช็อตที่ ${shot.position} แล้ว ✓`);
  }

  const isImg = (f) => /\.(png|jpe?g|webp)$/i.test(f || '');
  function paintVideo(box, s) {
    const still = cur.project.media === 'image';
    const noun = still ? 'รูป' : 'คลิป';
    const input = h('input', { type: 'file', accept: still ? 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp' : 'video/mp4,video/webm,.mp4,.webm', hidden: true });
    const label = () => (s.video_file ? `🔁 เปลี่ยน${noun}` : `📎 แนบ${noun}ที่ได้จาก ${genOf(cur.project).short}`);
    const pick = h('button', { class: 'btn sm', type: 'button', textContent: label() });
    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const f = input.files[0]; input.value = '';
      if (f) guard(pick, async () => { pick.textContent = 'กำลังอัปโหลด…'; await uploadVideo(s, f); }, (e) => { pick.textContent = label(); toast(e.message, true); });
    });
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) guard(pick, () => uploadVideo(s, f), (er) => toast(er.message, true)); });
    const row = h('div', { class: 'row' }, pick, input);
    if (!s.video_file) {
      box.replaceChildren(h('p', { class: 'hint', textContent: still ? `ยังไม่มีรูป — สร้างด้วย prompt ด้านบนใน ${genOf(cur.project).name} แล้วแนบรูปที่ดาวน์โหลดตรงนี้ หรือลากไฟล์มาวาง` : `ยังไม่มีคลิป — สร้างด้วย prompt ด้านบนใน ${genOf(cur.project).short} แล้วแนบไฟล์ที่ดาวน์โหลด (.mp4) ตรงนี้ หรือลากไฟล์มาวาง` }), row);
      return;
    }
    const video = isImg(s.video_file)
      ? h('img', { src: `/story-media/${s.video_file}`, alt: `รูปช็อตที่ ${s.position}`, class: 'st-still' })
      : h('video', { src: `/story-media/${s.video_file}`, controls: true, preload: 'metadata', playsInline: true });
    const mark = (status) => h('button', { class: 'btn sm' + (s.status === status ? ' primary' : ''), type: 'button', textContent: status === 'approved' ? '✅ ใช้ได้' : '❌ ไม่ผ่าน' });
    const ok = mark('approved'), bad = mark('rejected');
    for (const [b, st] of [[ok, 'approved'], [bad, 'rejected']]) {
      b.addEventListener('click', () => guard(b, async () => { cur = await api('PATCH', `/api/story/shots/${s.id}`, { status: s.status === st ? 'generated' : st }); refreshCard(s.id); }));
    }
    const del = h('button', { class: 'btn sm danger', type: 'button', textContent: `🗑 เอา${noun}ออก` });
    del.addEventListener('click', () => guard(del, async () => {
      if (!(await uiConfirm(`เอา${noun}ของช็อตที่ ${s.position} ออก?`, { title: `เอา${noun}ออก`, ok: 'เอาออก', danger: true }))) return;
      cur = await api('DELETE', `/api/story/shots/${s.id}/video`); refreshCard(s.id);
    }));
    row.append(ok, bad, del);
    box.replaceChildren(video, row);
  }

  function paintWarn(card, id) {
    const w = cur.warnings[id] || [];
    card._refs.warn.replaceChildren(...w.map((t) => h('div', { class: 'st-warn-i', textContent: `⚠ ${t}` })));
    card._refs.warn.hidden = !w.length;
  }
  // หลังบันทึก: อัปเดต prompt/คำเตือนของการ์ดที่เปิดอยู่ (ไม่ทับช่องที่กำลังพิมพ์)
  function repaint() {
    for (const card of $('st-body').querySelectorAll('.st-shot')) {
      const id = Number(card.id.replace('st-shot-', ''));
      const s = cur.shots.find((x) => x.id === id);
      if (!s) continue;
      if (document.activeElement !== card._refs.prompt) card._refs.prompt.value = s.prompt;
      if (document.activeElement !== card._refs.before) card._refs.before.value = s.state_before;
      paintWarn(card, id);
    }
    $('st-msg').textContent = '';
  }

  // ---------- เปิด/ควบคุมหน้า ----------
  async function open() {
    await loadList();
    tab = cur ? tab : 'story';
    render();
    $('st-msg').textContent = '';
    dlg.showModal();
  }
  // เปิดหน้าโปรเจกต์เรื่อง (เรียกจากโหมด "🎞 เรื่องหลายช็อต" ในตัวเลือกบนหน้าหลัก)
  window.openStory = () => open().catch((err) => toast(err.message, true));
  // เปิดหน้าโปรเจกต์เรื่องที่โปรเจกต์หนึ่งโดยตรง (ใช้โดยปุ่ม "ขยายเป็นเรื่อง" ในคลังคลิป)
  window.openStoryProject = async (id) => { await loadList(id); tab = 'story'; render(); $('st-msg').textContent = ''; if (!dlg.open) dlg.showModal(); };
  $('st-x').addEventListener('click', () => dlg.close());
  $('st-close').addEventListener('click', () => dlg.close());
  $('st-sel').addEventListener('change', () => guard($('st-sel'), async () => { await loadList(Number($('st-sel').value)); render(); }));
  $('st-tabs').addEventListener('click', (e) => guard(e.target, async () => {
    const t = e.target.dataset?.t;
    if (!t || !cur) return;
    tab = t;
    await loadList(cur.project.id); // คลังเปลี่ยนมีผลกับ prompt/คำเตือน → โหลดสดก่อนวาด
    render();
  }));
  const create = (title) => guard($('st-new'), async () => {
    const p = await api('POST', '/api/story/projects', { title: title || 'เรื่องใหม่', media: 'image', generator: 'flow' }); // ทางหลัก = ภาพนิ่ง (สร้างรูปเอง)
    await loadList(p.id); tab = 'story'; render();
  }, (e) => toast(e.message, true));
  $('st-new').addEventListener('click', async () => {
    const t = await uiPrompt('ตั้งชื่อเรื่อง', { title: 'โปรเจกต์เรื่องใหม่', ok: 'สร้าง', placeholder: 'เช่น คัมภีร์วิถีเซียน ตอนที่ 20' });
    if (t !== null) create(t);
  });
  $('st-new2').addEventListener('click', () => $('st-new').click());
  $('st-del').addEventListener('click', () => guard($('st-del'), async () => {
    if (!cur || !(await uiConfirm(`ลบโปรเจกต์ “${cur.project.title}” พร้อมตัวละครและช็อตทั้งหมด?`, { title: 'ลบโปรเจกต์', ok: 'ลบ', danger: true }))) return;
    await api('DELETE', `/api/story/projects/${cur.project.id}`);
    cur = null; await loadList(); render();
  }));
})();
