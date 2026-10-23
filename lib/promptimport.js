'use strict';
// แยก prompt หนังสั้นสำเร็จรูป (เขียนไว้ล่วงหน้า) เป็นโปรเจกต์เรื่อง โดยไม่ใช้ AI — คงบทพูดไทยตามต้นฉบับทุกตัวอักษร
// รูปแบบที่รองรับ:
//   บรรทัดชื่อเรื่อง (มี “…” หรือ "…")  /  Style: …  /  Character consistency: + รายการ "* ชื่อ: คำอธิบาย"
//   SCENE 1 — ARRIVAL (0–10s) + เนื้อหาฉาก  /  Final Thai voice-over: "…"  /  Production requirements: …

const THAI = /[฀-๿]/;
// หัวฉากแบบหลวม: ครอบด้วย markdown (## / ** / -) ได้, SCENE|Scene|ฉาก n, ตัวคั่น — – - :, เวลา (0–10s) [0:00-0:10] 0-10 วินาที ท้ายบรรทัดหรือไม่มีก็ได้
// หัวฉากต้องมีตัวคั่น (— – : . ) -) หรือวงเล็บเวลาหลังเลขฉาก ไม่งั้นต้องเป็น SCENE/PANEL ตัวพิมพ์ใหญ่ — กันประโยคเนื้อหาอย่าง “Panel 2 is next” ถูกอ่านเป็นหัวฉาก
const HEAD_RE = /^(?:scene|panel|ฉากที่|ฉาก)\s*(\d+)\s*(?:[—–:.)-]+\s*|(?=[(\[])|$)(.*)$/i;
const HEAD_UP = /^(?:SCENE|PANEL|ฉากที่|ฉาก)\s*(\d+)\s+(.*)$/; // ตัวพิมพ์ใหญ่ล้วนไม่ต้องมีตัวคั่น: “SCENE 1 ARRIVAL”
const TIME_RE = /[([]?\s*(\d+(?::\d+)?)\s*(?:s|sec|วินาที|วิ)?\s*(?:[–—~-]|to|ถึง)\s*(\d+(?::\d+)?)\s*(?:s|secs?|seconds?|วินาที|วิ)?\s*[)\]]?\s*$/i;
const secs = (t) => { const [a, b] = String(t).split(':').map(Number); return b === undefined ? a : a * 60 + b; };
function sceneHead(line) {
  const clean = line.replace(/^[\s#>*_•-]+/, '').replace(/[*_\s]+$/, '');
  const m = HEAD_RE.exec(clean) || HEAD_UP.exec(clean);
  if (!m) return null;
  let title = m[2].trim(), from = 0, to = 0;
  const t = TIME_RE.exec(title);
  if (t) { from = secs(t[1]); to = secs(t[2]); title = title.slice(0, t.index).replace(/[\s—–:([-]+$/, ''); }
  let rest = ''; // “PANEL 1 — BREAKING NEWS: เนื้อหา…” — ส่วนหลัง “: ” คือเนื้อหาฉาก ไม่ใช่ชื่อ
  const c = title.indexOf(': ');
  if (c > 0 && c < 60) { rest = title.slice(c + 2).trim(); title = title.slice(0, c).trim(); }
  return { n: +m[1], title: title || `ฉาก ${m[1]}`, from, to, rest };
}
const QUOTE_RE = /["“]([^"”]+)["”]/g;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

function thaiQuotes(line) {
  const out = [];
  for (const m of line.matchAll(QUOTE_RE)) if (THAI.test(m[1])) out.push(m[1].trim());
  return out;
}

function parsePromptScript(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
  const warnings = [];
  const firstScene = lines.findIndex((l) => sceneHead(l));
  if (firstScene < 0) throw new Error('ไม่พบหัวฉาก — แต่ละฉากต้องขึ้นบรรทัดใหม่ด้วย “SCENE 1 — ชื่อฉาก (0–10s)” (หรือ “ฉาก 1 …”) ตรวจรูปแบบ prompt อีกครั้ง');

  if (lines.filter((l) => sceneHead(l)).length > 80) throw new Error('มีหัวฉากเกิน 80 ฉาก — ลดจำนวนฉากหรือแยกเป็นหลายโปรเจกต์');
  const head = lines.slice(0, firstScene);
  // ชื่อเรื่อง: ข้อความในเครื่องหมายคำพูดบรรทัดแรก ๆ (รวมวงเล็บท้ายชื่อ) ไม่งั้นใช้บรรทัดแรกที่ไม่ว่าง
  let title = '';
  for (const l of head.slice(0, 5)) {
    const m = /["“]([^"”]+)["”]\s*(\([^)]*\))?/.exec(l);
    if (m) { title = oneLine(`${m[1]} ${m[2] || ''}`); break; }
  }
  if (!title) { // ไม่มีชื่อในเครื่องหมายคำพูด: “story about …” ในบรรทัดเปิด หรือบรรทัดแรกที่ตัดสั้น
    const a = /\bstory about (.+?)(?:[.;]|$)/i.exec(head.join(' '));
    title = a ? oneLine(a[1]) : oneLine(head.find((l) => l) || 'เรื่องใหม่');
    title = clip(title.charAt(0).toUpperCase() + title.slice(1), 60);
  }

  const styleLine = head.find((l) => /^(?:art\s+)?style\s*:/i.test(l));
  const intro = head.find((l) => /^create\b/i.test(l)) || '';
  const charAt = head.findIndex((l) => /^(?:consistent\s+)?characters?\b.*:/i.test(l));
  const characters = [];
  if (charAt >= 0) {
    for (const l of head.slice(charAt + 1)) {
      const m = /^(?:[*\-•]|\d+[.)])\s*([^:]{1,80}):\s*(.+)$/.exec(l);
      if (m) { if (oneLine(m[1])) characters.push({ name: oneLine(m[1]), desc: clip(oneLine(m[2]), 500) }); continue; }
      const n = /^\d+[.)]\s*(.+)$/.exec(l); // “1. Thai street food auntie, age 50, …” — ชื่อ = ส่วนหน้าเครื่องหมายจุลภาค
      if (n && oneLine(n[1].split(',')[0])) characters.push({ name: clip(oneLine(n[1].split(',')[0]), 60), desc: clip(oneLine(n[1]), 500) });
    }
  }
  if (!characters.length) warnings.push('ไม่พบรายการตัวละคร (“Character consistency:” + บรรทัด “* ชื่อ: คำอธิบาย”) — เพิ่มเองในแท็บตัวละคร');

  // ตัดท้าย: Final Thai voice-over / Production requirements
  const scenes = [];
  let cur = null, tail = null; // tail = 'final' | 'prod'
  const finalLines = [], prodLines = [];
  for (const l of lines.slice(firstScene)) {
    const m = sceneHead(l);
    if (m) { cur = { n: m.n, title: oneLine(m.title), from: m.from, to: m.to, body: m.rest ? [m.rest] : [] }; scenes.push(cur); tail = null; continue; }
    if (/^final\b.*voice[\s-]*over/i.test(l)) { tail = 'final'; const rest = l.replace(/^[^:]*:/, '').trim(); if (rest) finalLines.push(rest); continue; }
    if (/^(?:production requirements|each panel must)/i.test(l)) { tail = 'prod'; const rest = (/^production/i.test(l) ? l.replace(/^[^:]*:/, '') : l).trim(); if (rest) prodLines.push(rest); continue; }
    if (!l || !cur) continue;
    if (tail === 'final') finalLines.push(l);
    else if (tail === 'prod') prodLines.push(l);
    else cur.body.push(l);
  }

  const finalThai = finalLines.flatMap(thaiQuotes);
  // ไม่มีเวลา/บทพูดเลยทั้งเรื่อง (เช่น prompt รูปตารางช่อง) → เตือนครั้งเดียว ไม่เตือนซ้ำทุกฉาก
  const noTimes = scenes.every((s) => !(s.to - s.from > 0));
  const noSpeech = !finalThai.length && scenes.every((s) => !s.body.some((b) => thaiQuotes(b).length));
  if (noTimes) warnings.push('ไม่มีช่วงเวลาในหัวฉาก — ใช้ช็อตละ 8 วิ (ปรับได้ในโปรเจกต์)');
  if (noSpeech) warnings.push('ไม่มีบทพูดภาษาไทยในพรอมต์ — ใช้ปุ่ม “เขียนคำบรรยายใหม่” ในหน้าช็อตให้ AI เขียน');
  const shots = scenes.map((s, i) => {
    const said = s.body.flatMap(thaiQuotes);
    if (i === scenes.length - 1 && finalThai.length) said.push(...finalThai);
    let dur = s.to - s.from;
    if (!(dur > 0)) { if (!noTimes) warnings.push(`ฉาก ${s.n}: ไม่พบช่วงเวลา (เช่น 0–10s) — ใช้ 8 วิ`); dur = 8; }
    if (dur > 20) { warnings.push(`ฉาก ${s.n}: ยาว ${dur} วิ เกินที่ช็อตเดียวรองรับ (สูงสุด 20) — ตัดเหลือ 20 แบ่งเป็นหลายช็อตเองถ้าต้องการ`); dur = 20; }
    if (!said.length && !noSpeech) warnings.push(`ฉาก ${s.n}: ไม่พบบทพูดภาษาไทยในเครื่องหมายคำพูด`);
    return { scene: clip(s.title, 80), duration: dur, narration: clip(said.join(' '), 300), action: clip(oneLine(s.body.join(' ')), 1500), body: s.body.join(' ') };
  });

  // ตัวละครที่ปรากฏในฉาก: ชื่อเต็ม หรือคำท้ายชื่อ (Captain/Waiter) เมื่อไม่ซ้ำกับตัวละครอื่น
  const lastWord = (n) => n.split(/\s+/).pop().toLowerCase();
  const uniqueLast = (c) => characters.filter((x) => lastWord(x.name) === lastWord(c.name)).length === 1;
  for (const s of shots) {
    const hay = ` ${s.body.toLowerCase()} `;
    const words = new Set(hay.split(/[^\p{L}\p{N}]+/u)); // เทียบทีละคำ ไม่สร้าง RegExp จากชื่อตัวละคร (วงเล็บ/เครื่องหมายในชื่อทำให้ regex พัง)
    s.characters = characters.filter((c) => hay.includes(c.name.toLowerCase()) || (uniqueLast(c) && words.has(lastWord(c.name).replace(/[^\p{L}\p{N}]+/gu, '')))).map((c) => c.name);
    delete s.body;
  }

  const total = shots.reduce((a, s) => a + s.duration, 0);
  const ar = /\b(9:16|16:9|1:1|4:5)\b/.exec(intro || head.join(' '));
  return {
    title: clip(title, 150),
    aspect: ar ? ar[1] : '',
    total_sec: Math.min(1800, Math.max(10, total)),
    shot_sec: Math.min(15, Math.max(3, Math.round(total / shots.length))),
    look: { ref: clip(oneLine((styleLine || '').replace(/^(?:art\s+)?style\s*:/i, '')), 400), light: '', film: clip(oneLine(prodLines.join(' ')), 400), sound: '' },
    characters, shots, warnings,
  };
}

module.exports = { parsePromptScript };
