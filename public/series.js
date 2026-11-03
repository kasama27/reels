'use strict';
// หน้าซีรีส์รายวัน: ใช้ /api/series เท่านั้น (กติกาอยู่ฝั่งเซิร์ฟเวอร์) — ข้อมูลทุกอย่างลงหน้าด้วย textContent ไม่ใช้ innerHTML
const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
};
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
let tt;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = `toast${bad ? ' bad' : ''}`; t.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 4000);
}
const run = (fn) => fn().catch((e) => toast(e.message, true));

const PLAT = { facebook: 'Facebook', youtube: 'YouTube' };
const JOB_TH = { research: 'ค้นเนื้อเรื่อง', storyboard: 'เขียนสตอรีบอร์ด', images: 'ทำรูป', render: 'เรนเดอร์', ready: 'พร้อมโพสต์', done: 'ลงครบแล้ว', failed: 'ล้มเหลว' };
const PUB_TH = { pending: 'รอลง', posting: 'กำลังลง', posted: 'ลงแล้ว', failed: 'ล้มเหลว', blocked: 'ถูกหยุด' };
const cls = (s) => (['done', 'posted', 'ready'].includes(s) ? 'ok' : ['failed', 'blocked'].includes(s) ? 'bad' : 'run');
const pill = (text, s) => h('span', { class: `st-pill ${cls(s)}`, text });

function fields(s) {
  const t = (v, ph, max) => h('input', { value: v ?? '', placeholder: ph, maxlength: max });
  const f = {
    title: t(s.title, 'เช่น คัมภีร์วิถีเซียน', 150),
    fb: t(s.channels?.facebook, 'ชื่อเพจ Facebook', 150),
    yt: t(s.channels?.youtube, 'ชื่อช่อง YouTube', 150),
    post_time: h('input', { type: 'time', value: s.post_time || '20:00' }),
    per_day: h('input', { type: 'number', min: 1, max: 5, value: s.per_day ?? 1 }),
    next_ep: h('input', { type: 'number', min: 1, max: 9999, value: s.next_ep ?? 1 }),
    ch_start: h('input', { type: 'number', min: 1, max: 99999, value: s.chapter_start ?? 1 }),
    ch_per: h('input', { type: 'number', min: 1, max: 20, value: s.chapters_per_ep ?? 1 }),
    fb_id: t(s.channel_ids?.facebook, 'รหัสหรือลิงก์เพจ Facebook', 150),
    yt_id: t(s.channel_ids?.youtube, 'รหัสหรือลิงก์ช่อง YouTube', 150),
    visual: h('select', {}, ...[['anime', 'อนิเมะ'], ['cartoon', 'การ์ตูน'], ['realistic', 'สมจริง'], ['stickman', 'สติ๊กแมน']].map(([v, l]) => h('option', { value: v, text: l, selected: (s.visual || 'anime') === v }))),
    source_notes: h('textarea', { rows: 3, placeholder: 'แหล่งอ่านเนื้อเรื่อง / ลิงก์ / หมายเหตุให้ skill', maxlength: 4000, text: s.source_notes || '' }),
  };
  const plats = Object.keys(PLAT).map((p) => ({ p, box: h('input', { type: 'checkbox', checked: (s.platforms || ['facebook']).includes(p) }) }));
  const lab = (text, el) => h('label', { class: 'field' }, text, el);
  const wrap = [lab('ชื่อซีรีส์', f.title), lab('เพจ Facebook', f.fb), lab('ช่อง YouTube', f.yt), lab('เวลาที่ตั้งใจโพสต์', f.post_time), lab('ตอนต่อวัน (สูงสุด)', f.per_day), lab('ตอนถัดไป', f.next_ep), lab('เริ่มที่บทนิยายที่', f.ch_start), lab('บทนิยายต่อตอนซีรีส์', f.ch_per), lab('รหัสเพจ Facebook', f.fb_id), lab('รหัสช่อง YouTube', f.yt_id), lab('สไตล์ภาพ', f.visual),
    h('div', { class: 'field' }, 'ลงที่', h('div', { class: 'row' }, ...plats.map(({ p, box }) => h('label', { class: 'st-opt' }, box, PLAT[p])))),
    h('div', { class: 'field', style: 'grid-column:1/-1' }, 'แหล่งอ่าน / หมายเหตุ', f.source_notes)];
  const collect = () => ({
    title: f.title.value, channels: { facebook: f.fb.value, youtube: f.yt.value }, channel_ids: { facebook: f.fb_id.value, youtube: f.yt_id.value }, chapter_start: Number(f.ch_start.value) || 1, chapters_per_ep: Number(f.ch_per.value) || 1, post_time: f.post_time.value, per_day: Number(f.per_day.value), next_ep: Number(f.next_ep.value),
    visual: f.visual.value, source_notes: f.source_notes.value, platforms: plats.filter((x) => x.box.checked).map((x) => x.p),
  });
  return { wrap, collect };
}

const newForm = fields({});
$('#new-form').append(...newForm.wrap);
$('#new-go').addEventListener('click', () => run(async () => {
  await api('POST', '/api/series', newForm.collect());
  toast('สร้างซีรีส์แล้ว (ยังปิดอยู่)'); location.reload();
}));

function jobsTable(s, jobs) {
  if (!jobs.length) return h('div', { class: 'sr-note', text: 'ยังไม่มีตอนที่ผลิต' });
  return h('table', { class: 'sr-jobs' },
    h('thead', {}, h('tr', {}, ...['ตอน', 'สถานะ', 'การลง', 'อัปเดต', ''].map((x) => h('th', { text: x })))),
    h('tbody', {}, ...jobs.map((j) => {
      const del = h('button', { class: 'btn sm danger', type: 'button', text: 'ลบ' });
      del.addEventListener('click', () => run(async () => {
        if (!confirm(`ลบงานตอน ${j.ep_no}? (ไม่ลบคลิปในคลัง)`)) return;
        await api('DELETE', `/api/jobs/${j.id}`); await load();
      }));
      const fail = h('button', { class: 'btn sm', type: 'button', text: 'ทำเครื่องหมายล้มเหลว' });
      fail.addEventListener('click', () => run(async () => {
        const why = prompt('เหตุผล (ไม่บังคับ)') ?? null;
        if (why === null) return;
        await api('PATCH', `/api/jobs/${j.id}`, { status: 'failed', error: why }); await load();
      }));
      // เลือกช่องทางของตอนนี้ (ค่าเริ่มต้นตามซีรีส์) — เอาช่องที่เริ่มลงแล้วออกไม่ได้ เซิร์ฟเวอร์ปฏิเสธ
      const started = new Set(j.publications.map((p) => p.platform));
      const boxes = Object.keys(PLAT).map((p) => ({ p, box: h('input', { type: 'checkbox', checked: j.targets.includes(p), disabled: j.status === 'done' || started.has(p) }) }));
      boxes.forEach(({ box }) => box.addEventListener('change', () => run(async () => {
        const pick = boxes.filter((x) => x.box.checked).map((x) => x.p);
        if (!pick.length) { await load(); throw new Error('ต้องเลือกอย่างน้อยหนึ่งช่องทาง'); }
        await api('PATCH', `/api/jobs/${j.id}`, { platforms: pick }); toast(`ตอน ${j.ep_no}: ลง ${pick.map((x) => PLAT[x]).join(' + ')}`); await load();
      })));
      const chans = h('div', { class: 'row' }, ...boxes.map(({ p, box }) => h('label', { class: 'st-opt' }, box, PLAT[p])), h('span', { class: 'sr-note', text: j.platforms ? '' : '(ตามซีรีส์)' }));
      const acts = h('div', { class: 'row' }, ...(j.status === 'done' || j.status === 'failed' ? [] : [fail]), del);
      return h('tr', {},
        h('td', { text: `EP.${j.ep_no}` }),
        h('td', {}, pill(JOB_TH[j.status] || j.status, j.status), j.chapter_range ? h('div', { class: 'sr-note', text: `บทนิยาย ${j.chapter_range}` }) : null, j.progress && j.progress.total ? h('div', { class: 'sr-note', text: `รูป ${j.progress.have}/${j.progress.total}` }) : null, j.project_id ? h('a', { href: `/?story=${j.project_id}`, text: 'เปิดโปรเจกต์' }) : null, j.error ? h('div', { class: 'sr-err', text: j.error }) : null),
        h('td', {}, chans, ...(j.publications.length ? j.publications.map((p) => h('div', {}, pill(`${PLAT[p.platform]}: ${PUB_TH[p.status] || p.status}`, p.status), p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: ' ลิงก์' }) : null, p.error ? h('div', { class: 'sr-err', text: p.error }) : null)) : [h('span', { class: 'muted', text: '—' })])),
        h('td', { class: 'muted', text: new Date(j.updated_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) }),
        h('td', {}, acts));
    })));
}

function seriesCard(s) {
  const form = fields(s);
  const save = h('button', { class: 'btn', type: 'button', text: 'บันทึกการตั้งค่า' });
  save.addEventListener('click', () => run(async () => { await api('PATCH', `/api/series/${s.id}`, form.collect()); toast('บันทึกแล้ว'); await load(); }));
  const tog = h('button', { class: 'btn' + (s.enabled ? '' : ' primary'), type: 'button', text: s.enabled ? 'ปิดซีรีส์' : 'เปิดซีรีส์' });
  tog.addEventListener('click', () => run(async () => {
    if (!s.enabled && !confirm('เปิดซีรีส์? เปิดแล้ว task รายวันจะเริ่มผลิตตอนได้ (การโพสต์จริงยังต้องผ่านการทดสอบก่อน)')) return;
    await api('PATCH', `/api/series/${s.id}`, { enabled: !s.enabled }); await load();
  }));
  const start = h('button', { class: 'btn', type: 'button', text: `เริ่มตอน ${s.next_ep} (ผลิตเอง)` });
  start.disabled = !s.enabled;
  start.title = s.enabled ? '' : 'เปิดซีรีส์ก่อน';
  start.addEventListener('click', () => run(async () => { await api('POST', `/api/series/${s.id}/jobs`, {}); toast(`สร้างงานตอน ${s.next_ep} แล้ว`); await load(); }));
  const del = h('button', { class: 'btn danger', type: 'button', text: 'ลบซีรีส์' });
  del.addEventListener('click', () => run(async () => {
    if (!confirm(`ลบซีรีส์ “${s.title}” พร้อมงานและรายการลงทั้งหมด? (ไม่ลบคลิปในคลัง)`)) return;
    await api('DELETE', `/api/series/${s.id}`); await load();
  }));
  const det = h('details', {}, h('summary', { text: 'ตั้งค่า' }), h('div', { class: 'sr-grid' }, ...form.wrap), h('div', { class: 'row' }, save));
  return h('div', { class: 'sr-card' + (s.enabled ? '' : ' sr-off'), id: `s-${s.id}` },
    h('div', { class: 'sr-head' }, h('h2', { text: s.title }), pill(s.enabled ? 'เปิดอยู่' : 'ปิดอยู่', s.enabled ? 'ready' : 'pending'), pill('ป้าย AI: บังคับ', 'ready')),
    h('div', { class: 'sr-note', text: `ลง ${s.platforms.map((p) => PLAT[p]).join(' + ')} · ${s.platforms.map((p) => `${PLAT[p]}: ${s.channels?.[p] || '—'}`).join(' · ')} · ราว ${s.post_time} · ไม่เกิน ${s.per_day} ตอน/วัน · ตอนถัดไป EP.${s.next_ep}` }),
    h('div', { class: 'row', style: 'margin:10px 0' }, tog, start, del),
    det,
    h('div', { id: `jobs-${s.id}` }));
}

async function load() {
  const list = await api('GET', '/api/series');
  const box = $('#list');
  box.replaceChildren(...(list.length ? list.map(seriesCard) : [h('div', { class: 'sr-note', text: 'ยังไม่มีซีรีส์ — เพิ่มด้านบน' })]));
  for (const s of list) {
    const d = await api('GET', `/api/series/${s.id}`);
    $(`#jobs-${s.id}`).replaceChildren(jobsTable(s, d.jobs));
  }
}
run(load);
