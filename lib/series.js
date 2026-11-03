'use strict';
// ซีรีส์รายวัน: series (ตั้งค่าเรื่อง) → episode_jobs (ตอนที่ผลิต) → publications (ลงแต่ละแพลตฟอร์ม)
// เสียบกับ story_projects / clips เดิมด้วย project_id / clip_id เท่านั้น ไม่แตะตารางเดิม
const { handle: db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source_notes TEXT NOT NULL DEFAULT '',  -- แหล่งอ่านเนื้อเรื่อง/ลิงก์/หมายเหตุให้ skill
  next_ep INTEGER NOT NULL DEFAULT 1,     -- ตอนถัดไปที่จะผลิต (เพิ่มเองเมื่อสร้างงาน)
  page_name TEXT NOT NULL DEFAULT '',     -- เพจ Facebook / ช่อง YouTube ที่จะลง
  post_time TEXT NOT NULL DEFAULT '20:00',-- HH:MM เวลาที่ตั้งใจให้โพสต์
  per_day INTEGER NOT NULL DEFAULT 1,
  platforms TEXT NOT NULL DEFAULT '["facebook"]',
  ai_label INTEGER NOT NULL DEFAULT 1,    -- ต้องติ๊กป้ายเนื้อหา AI และยืนยันก่อนโพสต์
  visual TEXT NOT NULL DEFAULT 'anime',
  tpl TEXT NOT NULL DEFAULT '{}',         -- ค่าเทมเพลต B (ป้ายตอน ปก จบ) เหมือน story_projects.tpl
  enabled INTEGER NOT NULL DEFAULT 0,     -- ปิดไว้ก่อนเสมอ เปิดเองหลังทดสอบโพสต์
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS episode_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL,
  ep_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'research',
  project_id INTEGER,
  clip_id INTEGER,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (series_id, ep_no)
);
CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  url TEXT NOT NULL DEFAULT '',
  ai_label_verified INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  posted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (job_id, platform)
);
`);

// ตอนเลือกช่องทางเองได้: episode_jobs.platforms (NULL = ตามซีรีส์) — เพิ่มคอลัมน์แบบมี guard
if (!db.prepare('PRAGMA table_info(episode_jobs)').all().some((c) => c.name === 'platforms')) db.exec('ALTER TABLE episode_jobs ADD COLUMN platforms TEXT');

if (!db.prepare('PRAGMA table_info(series)').all().some((c) => c.name === 'channels')) {
  db.exec("ALTER TABLE series ADD COLUMN channels TEXT NOT NULL DEFAULT '{}'");
  for (const r of db.prepare("SELECT id, page_name FROM series WHERE page_name != ''").all()) db.prepare('UPDATE series SET channels = ? WHERE id = ?').run(JSON.stringify({ facebook: r.page_name }), r.id);
}

// ช่วงบทนิยายต่อตอนซีรีส์ + รหัสเพจ/ช่อง (เฟส 1) — เพิ่มคอลัมน์แบบมี guard
const colsOf = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
for (const [col, ddl] of [['chapters_per_ep', 'INTEGER NOT NULL DEFAULT 1'], ['chapter_start', 'INTEGER NOT NULL DEFAULT 1'], ['channel_ids', "TEXT NOT NULL DEFAULT '{}'"]]) {
  if (!colsOf('series').includes(col)) db.exec(`ALTER TABLE series ADD COLUMN ${col} ${ddl}`);
}
if (!colsOf('episode_jobs').includes('chapter_range')) db.exec("ALTER TABLE episode_jobs ADD COLUMN chapter_range TEXT NOT NULL DEFAULT ''");

const PLATFORMS = ['facebook', 'youtube'];
const JOB_STATUS = ['research', 'storyboard', 'images', 'render', 'ready', 'done', 'failed'];
const PUB_STATUS = ['pending', 'posting', 'posted', 'failed', 'blocked'];
const VISUALS = ['cartoon', 'realistic', 'anime', 'stickman'];

class SeriesError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const shape = (r) => r && { ...r, platforms: parse(r.platforms, []), tpl: parse(r.tpl, {}), channels: parse(r.channels, {}), channel_ids: parse(r.channel_ids, {}), ai_label: !!r.ai_label, enabled: !!r.enabled };

const getSeries = (id) => shape(db.prepare('SELECT * FROM series WHERE id = ?').get(id));
const listSeries = () => db.prepare('SELECT * FROM series ORDER BY id DESC').all().map(shape);

function cleanSeries(f, partial) {
  const out = {};
  const str = (k, max) => { if (f[k] !== undefined) { if (typeof f[k] !== 'string') throw new SeriesError(400, `${k} ต้องเป็นข้อความ`); out[k] = f[k].trim().slice(0, max); } };
  str('title', 150); str('source_notes', 4000); 
  if (!partial && !out.title) throw new SeriesError(400, 'ใส่ชื่อซีรีส์');
  if (partial && out.title === '') throw new SeriesError(400, 'ชื่อซีรีส์ว่างไม่ได้');
  if (f.post_time !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.post_time)) throw new SeriesError(400, 'post_time ต้องเป็น HH:MM'); out.post_time = f.post_time; }
  if (f.next_ep !== undefined) { const n = Number(f.next_ep); if (!Number.isInteger(n) || n < 1 || n > 9999) throw new SeriesError(400, 'next_ep ต้องเป็นจำนวนเต็ม 1–9999'); out.next_ep = n; }
  if (f.per_day !== undefined) { const n = Number(f.per_day); if (!Number.isInteger(n) || n < 1 || n > 5) throw new SeriesError(400, 'per_day ต้องเป็น 1–5'); out.per_day = n; }
  // ชื่อเพจ/ช่องแยกต่อแพลตฟอร์ม: { facebook: "ชื่อเพจ", youtube: "ชื่อช่อง" } — PATCH แทนที่ทั้งก้อน (คีย์ที่ไม่ส่ง/ว่าง = ไม่ตั้ง)
  if (f.channels !== undefined) {
    if (!f.channels || typeof f.channels !== 'object' || Array.isArray(f.channels)) throw new SeriesError(400, 'channels ต้องเป็นออบเจกต์ เช่น {"facebook":"…","youtube":"…"}');
    const ch = {};
    for (const [k, v] of Object.entries(f.channels)) {
      if (!PLATFORMS.includes(k)) throw new SeriesError(400, `channels: ไม่รู้จัก ${k}`);
      if (typeof v !== 'string') throw new SeriesError(400, `channels.${k} ต้องเป็นข้อความ`);
      if (v.trim()) ch[k] = v.trim().slice(0, 150);
    }
    out.channels = JSON.stringify(ch);
  }
  // รหัสเพจ/ช่อง (เช่น รหัสตัวเลขของเพจ Facebook หรือรหัสช่อง YouTube) ใช้ยืนยันว่าเปิดถูกเพจ
  if (f.channel_ids !== undefined) {
    if (!f.channel_ids || typeof f.channel_ids !== 'object' || Array.isArray(f.channel_ids)) throw new SeriesError(400, 'channel_ids ต้องเป็นออบเจกต์');
    const ci = {};
    for (const [k, v] of Object.entries(f.channel_ids)) {
      if (!PLATFORMS.includes(k)) throw new SeriesError(400, `channel_ids: ไม่รู้จัก ${k}`);
      if (typeof v !== 'string') throw new SeriesError(400, `channel_ids.${k} ต้องเป็นข้อความ`);
      if (v.trim()) ci[k] = v.trim().slice(0, 150);
    }
    out.channel_ids = JSON.stringify(ci);
  }
  for (const [k, max] of [['chapters_per_ep', 20], ['chapter_start', 99999]]) {
    if (f[k] === undefined) continue;
    const n = Number(f[k]);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new SeriesError(400, `${k} ต้องเป็นจำนวนเต็ม 1–${max}`);
    out[k] = n;
  }
  if (f.platforms !== undefined) {
    if (!Array.isArray(f.platforms) || !f.platforms.length || f.platforms.some((p) => !PLATFORMS.includes(p))) throw new SeriesError(400, `platforms ต้องเป็นอย่างน้อยหนึ่งใน ${PLATFORMS.join(' | ')}`);
    out.platforms = JSON.stringify([...new Set(f.platforms)]);
  }
  if (f.visual !== undefined) { if (!VISUALS.includes(f.visual)) throw new SeriesError(400, `visual ต้องเป็น ${VISUALS.join(' | ')}`); out.visual = f.visual; }
  if (f.tpl !== undefined) { if (!f.tpl || typeof f.tpl !== 'object' || Array.isArray(f.tpl)) throw new SeriesError(400, 'tpl ต้องเป็นออบเจกต์'); const j = JSON.stringify(f.tpl); if (j.length > 4000) throw new SeriesError(400, 'tpl ยาวเกิน'); out.tpl = j; }
  // ป้าย AI บังคับเปิดเสมอ ปิดไม่ได้ — กติกาของระบบ ไม่ใช่ตัวเลือก
  if (f.ai_label !== undefined && f.ai_label !== true) throw new SeriesError(400, 'ป้ายเนื้อหา AI ต้องเปิดเสมอ');
  if (f.enabled !== undefined) { if (typeof f.enabled !== 'boolean') throw new SeriesError(400, 'enabled ต้องเป็น true/false'); out.enabled = f.enabled ? 1 : 0; }
  return out;
}

function createSeries(f) {
  const c = cleanSeries(f, false), t = Date.now();
  const r = db.prepare('INSERT INTO series (title, source_notes, next_ep, channels, post_time, per_day, platforms, visual, tpl, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(c.title, c.source_notes || '', c.next_ep || 1, c.channels || '{}', c.post_time || '20:00', c.per_day || 1, c.platforms || '["facebook"]', c.visual || 'anime', c.tpl || '{}', c.enabled || 0, t, t);
  const sid = Number(r.lastInsertRowid), extra = ['chapters_per_ep', 'chapter_start', 'channel_ids'].filter((k) => c[k] !== undefined);
  if (extra.length) db.prepare(`UPDATE series SET ${extra.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...extra.map((k) => c[k]), sid);
  return getSeries(sid);
}
function updateSeries(id, f) {
  if (!getSeries(id)) throw new SeriesError(404, 'ไม่พบซีรีส์');
  const c = cleanSeries(f, true), keys = Object.keys(c);
  if (keys.length) db.prepare(`UPDATE series SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => c[k]), Date.now(), id);
  return getSeries(id);
}
function deleteSeries(id) {
  if (!getSeries(id)) throw new SeriesError(404, 'ไม่พบซีรีส์');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM publications WHERE job_id IN (SELECT id FROM episode_jobs WHERE series_id = ?)').run(id);
    db.prepare('DELETE FROM episode_jobs WHERE series_id = ?').run(id);
    db.prepare('DELETE FROM series WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- งานผลิตตอน ----------
// platforms = ค่าที่ตอนเลือกเอง (null = ตามซีรีส์); targets = ช่องทางที่ใช้จริงของตอนนี้
const shapeJob = (j) => {
  if (!j) return j;
  const own = j.platforms ? parse(j.platforms, null) : null;
  const s = getSeries(j.series_id);
  return { ...j, platforms: own, targets: own || (s ? s.platforms : []) };
};
const getJob = (id) => shapeJob(db.prepare('SELECT * FROM episode_jobs WHERE id = ?').get(id));
// progress = จำนวนช็อตที่มีรูป/ทั้งหมดของโปรเจกต์ที่ผูกอยู่ (นับแบบเดียวกับหน้าช็อต)
const progress = (pid) => (pid ? db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(video_file IS NOT NULL AND status != 'rejected'), 0) AS have FROM story_shots WHERE project_id = ?").get(pid) : null);
const listJobs = (sid) => db.prepare('SELECT * FROM episode_jobs WHERE series_id = ? ORDER BY ep_no DESC').all(sid)
  .map(shapeJob).map((j) => ({ ...j, publications: listPubs(j.id), progress: progress(j.project_id) }));
const listPubs = (jid) => db.prepare('SELECT * FROM publications WHERE job_id = ? ORDER BY id').all(jid).map((p) => ({ ...p, ai_label_verified: !!p.ai_label_verified }));
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

// เริ่มตอนถัดไป: ซีรีส์ต้องเปิดอยู่ (หรือ force จากผู้ใช้เอง), ไม่เกิน per_day ต่อวัน (ตอนที่ล้มไม่นับ), ep ไม่ซ้ำ — แล้วเลื่อน next_ep
function startJob(sid, { force = false } = {}) {
  const s = getSeries(sid);
  if (!s) throw new SeriesError(404, 'ไม่พบซีรีส์');
  if (!s.enabled && !force) throw new SeriesError(409, 'ซีรีส์ยังปิดอยู่ (enabled = false)');
  db.exec('BEGIN IMMEDIATE');
  try {
    const today = db.prepare("SELECT COUNT(*) AS n FROM episode_jobs WHERE series_id = ? AND created_at >= ? AND status != 'failed'").get(sid, startOfDay()).n;
    if (today >= s.per_day) throw new SeriesError(409, `ครบ ${s.per_day} ตอนของวันนี้แล้ว`);
    if (getJobBySeriesEp(sid, s.next_ep)) throw new SeriesError(409, `ตอน ${s.next_ep} มีงานอยู่แล้ว — แก้ next_ep หรือลบงานเดิมก่อน`);
    const t = Date.now();
    const from = s.chapter_start + (s.next_ep - 1) * s.chapters_per_ep, to = from + s.chapters_per_ep - 1;
    const r = db.prepare('INSERT INTO episode_jobs (series_id, ep_no, chapter_range, created_at, updated_at) VALUES (?,?,?,?,?)').run(sid, s.next_ep, from === to ? String(from) : `${from}-${to}`, t, t);
    db.prepare('UPDATE series SET next_ep = next_ep + 1, updated_at = ? WHERE id = ?').run(t, sid);
    db.exec('COMMIT');
    return getJob(Number(r.lastInsertRowid));
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const getJobBySeriesEp = (sid, ep) => db.prepare('SELECT id FROM episode_jobs WHERE series_id = ? AND ep_no = ?').get(sid, ep);

function updateJob(id, f) {
  const j = getJob(id);
  if (!j) throw new SeriesError(404, 'ไม่พบงาน');
  const set = {};
  if (f.status !== undefined) {
    if (!JOB_STATUS.includes(f.status)) throw new SeriesError(400, `status ต้องเป็น ${JOB_STATUS.join(' | ')}`);
    if (j.status === 'done') throw new SeriesError(409, 'งานที่ลงครบแล้วแก้สถานะไม่ได้');
    // ลง (done) ได้ก็ต่อเมื่อโพสต์ครบทุกแพลตฟอร์ม — มาจาก updatePub เท่านั้น
    if (f.status === 'done') throw new SeriesError(400, 'done ตั้งเองไม่ได้ — ระบบตั้งให้เมื่อโพสต์ครบทุกแพลตฟอร์ม');
    if (f.status === 'ready' && !(f.clip_id || j.clip_id)) throw new SeriesError(400, 'ready ต้องมี clip_id');
    set.status = f.status;
    if (f.status !== 'failed' && f.error === undefined) set.error = '';
  }
  if (f.chapter_range !== undefined) {
    const cr = String(f.chapter_range).trim();
    if (cr && !/^\d{1,5}(-\d{1,5})?$/.test(cr)) throw new SeriesError(400, 'chapter_range ต้องเป็นเลขบท เช่น 3 หรือ 3-5 (ว่าง = ไม่กำหนด)');
    if (cr.includes('-') && Number(cr.split('-')[0]) > Number(cr.split('-')[1])) throw new SeriesError(400, 'chapter_range: บทเริ่มต้องไม่เกินบทสุดท้าย');
    set.chapter_range = cr;
  }
  if (f.platforms !== undefined) {
    if (f.platforms === null) set.platforms = null; // ตามซีรีส์
    else {
      if (!Array.isArray(f.platforms) || !f.platforms.length || f.platforms.some((p) => !PLATFORMS.includes(p))) throw new SeriesError(400, `platforms ต้องเป็นอย่างน้อยหนึ่งใน ${PLATFORMS.join(' | ')} หรือ null (ตามซีรีส์)`);
      set.platforms = JSON.stringify([...new Set(f.platforms)]);
    }
    const next = set.platforms === null ? getSeries(j.series_id).platforms : parse(set.platforms, []);
    // เอาช่องทางที่เริ่มลงไปแล้วออกไม่ได้ (กันประวัติการลงหาย/โพสต์ซ้ำ)
    const used = db.prepare('SELECT platform FROM publications WHERE job_id = ?').all(id).map((x) => x.platform).filter((p) => !next.includes(p));
    if (used.length) throw new SeriesError(409, `เอา ${used.join(', ')} ออกไม่ได้ — ตอนนี้เริ่มลงที่นั่นแล้ว`);
  }
  for (const k of ['project_id', 'clip_id']) if (f[k] !== undefined) { const n = Number(f[k]); if (!Number.isInteger(n) || n < 1) throw new SeriesError(400, `${k} ต้องเป็นจำนวนเต็มบวก`); set[k] = n; }
  if (f.error !== undefined) set.error = String(f.error).slice(0, 1000);
  const keys = Object.keys(set);
  if (keys.length) db.prepare(`UPDATE episode_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => set[k]), Date.now(), id);
  if (f.platforms !== undefined) finishIfAllPosted(id); // ลดช่องทางลงจนที่เหลือโพสต์ครบแล้ว → done
  return { ...getJob(id), publications: listPubs(id) };
}
function deleteJob(id) {
  if (!getJob(id)) throw new SeriesError(404, 'ไม่พบงาน');
  db.prepare('DELETE FROM publications WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM episode_jobs WHERE id = ?').run(id);
}

// โพสต์ครบทุกช่องทางที่ตอนนี้เลือกไว้ → done (เฉพาะตอนที่ ready แล้ว)
function finishIfAllPosted(jobId) {
  const j = getJob(jobId);
  if (!j || j.status !== 'ready') return;
  const done = new Set(db.prepare("SELECT platform FROM publications WHERE job_id = ? AND status = 'posted'").all(jobId).map((x) => x.platform));
  if (j.targets.length && j.targets.every((pl) => done.has(pl))) db.prepare("UPDATE episode_jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?").run(Date.now(), jobId);
}

// ---------- การลงต่อแพลตฟอร์ม ----------
const getPub = (id) => db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
function addPub(jid, platform) {
  const j = getJob(jid);
  if (!j) throw new SeriesError(404, 'ไม่พบงาน');
  if (!PLATFORMS.includes(platform) || !j.targets.includes(platform)) throw new SeriesError(400, `ตอนนี้ไม่ได้เลือกให้ลง ${platform}`);
  if (j.status !== 'ready') throw new SeriesError(409, 'คลิปต้องพร้อม (ready) ก่อนจึงเริ่มลงได้');
  if (db.prepare('SELECT 1 FROM publications WHERE job_id = ? AND platform = ?').get(jid, platform)) throw new SeriesError(409, `ตอนนี้มีรายการลง ${platform} แล้ว`);
  const t = Date.now();
  const r = db.prepare('INSERT INTO publications (job_id, platform, created_at, updated_at) VALUES (?,?,?,?)').run(jid, platform, t, t);
  return getPub(Number(r.lastInsertRowid));
}
function updatePub(id, f) {
  const p = getPub(id);
  if (!p) throw new SeriesError(404, 'ไม่พบรายการลง');
  if (p.status === 'posted') throw new SeriesError(409, 'โพสต์แล้ว แก้ไม่ได้');
  const set = {};
  if (f.ai_label_verified !== undefined) { if (typeof f.ai_label_verified !== 'boolean') throw new SeriesError(400, 'ai_label_verified ต้องเป็น true/false'); set.ai_label_verified = f.ai_label_verified ? 1 : 0; }
  if (f.url !== undefined) { const u = String(f.url).trim(); if (u && !/^https:\/\/\S+$/.test(u)) throw new SeriesError(400, 'url ต้องเป็นลิงก์ https'); set.url = u.slice(0, 500); }
  if (f.error !== undefined) set.error = String(f.error).slice(0, 1000);
  if (f.status !== undefined) {
    if (!PUB_STATUS.includes(f.status)) throw new SeriesError(400, `status ต้องเป็น ${PUB_STATUS.join(' | ')}`);
    if (f.status === 'posted') { // กันโพสต์ที่ไม่ได้ยืนยันป้าย AI และไม่มีลิงก์ผลลัพธ์
      const verified = set.ai_label_verified ?? p.ai_label_verified, url = set.url ?? p.url;
      if (!verified) throw new SeriesError(409, 'ยังไม่ได้ยืนยันป้ายเนื้อหา AI — บันทึกว่าโพสต์แล้วไม่ได้');
      if (!url) throw new SeriesError(400, 'posted ต้องมี url ของโพสต์');
      set.posted_at = Date.now();
    }
    set.status = f.status;
    if (f.status === 'posting' || f.status === 'posted') set.error = '';
  }
  const keys = Object.keys(set);
  if (keys.length) db.prepare(`UPDATE publications SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => set[k]), Date.now(), id);
  const out = getPub(id);
  if (out.status === 'posted') { // โพสต์ครบทุกแพลตฟอร์มของซีรีส์ → ตอนนี้ done
    finishIfAllPosted(out.job_id);
  }
  return { ...out, ai_label_verified: !!out.ai_label_verified };
}

// ---------- เส้นเชื่อมงาน ↔ โปรเจกต์เรื่อง ↔ คลิป (ขั้น 3.1) ----------
const jobByProject = (pid) => shapeJob(db.prepare('SELECT * FROM episode_jobs WHERE project_id = ?').get(pid));
// ผูกโปรเจกต์ที่นำเข้าแล้วเข้ากับงาน: งานต้องยังอยู่ขั้น research/storyboard และโปรเจกต์ต้องไม่ถูกผูกกับงานอื่น — สตอรีบอร์ดเสร็จแล้วจึงขยับเป็น images (หรือ render ถ้ารูปครบอยู่แล้ว)
function linkProject(jobId, projectId, { total = 0, have = 0 } = {}) {
  const j = getJob(jobId);
  if (!j) throw new SeriesError(404, 'ไม่พบงาน');
  if (!['research', 'storyboard'].includes(j.status)) throw new SeriesError(409, `งานอยู่ขั้น ${j.status} แล้ว ผูกโปรเจกต์ใหม่ไม่ได้`);
  if (!db.prepare('SELECT 1 FROM story_projects WHERE id = ?').get(projectId)) throw new SeriesError(404, 'ไม่พบโปรเจกต์');
  const other = jobByProject(projectId);
  if (other && other.id !== jobId) throw new SeriesError(409, `โปรเจกต์นี้ผูกกับงานตอน ${other.ep_no} อยู่แล้ว`);
  const next = total > 0 && have >= total ? 'render' : 'images';
  db.prepare('UPDATE episode_jobs SET project_id = ?, status = ?, error = ?, updated_at = ? WHERE id = ?').run(projectId, next, '', Date.now(), jobId);
  return { ...getJob(jobId), publications: listPubs(jobId) };
}
// รูปของโปรเจกต์เปลี่ยน (แนบ/เอาออก/ลบช็อต): images ↔ render ตามจำนวนช็อตที่มีรูป — งานที่ผูกอยู่เท่านั้น ไม่แตะขั้นอื่น
function syncProgress(projectId, total, have) {
  const j = jobByProject(projectId);
  if (!j) return null;
  const want = total > 0 && have >= total ? 'render' : 'images';
  if (['images', 'render'].includes(j.status) && j.status !== want) db.prepare('UPDATE episode_jobs SET status = ?, updated_at = ? WHERE id = ?').run(want, Date.now(), j.id);
  return getJob(j.id);
}
// รวมคลิปเสร็จ: งานของโปรเจกต์นี้ที่อยู่ขั้น render (รูปครบ) → ready พร้อม clip_id — คลิปต้องมีไฟล์วิดีโอจริง
function markReadyByProject(projectId, clipId) {
  const j = jobByProject(projectId);
  if (!j) return null;
  if (j.status !== 'render') throw new SeriesError(409, `งานตอน ${j.ep_no} อยู่ขั้น ${j.status} — ต้องรูปครบ (render) ก่อนจึงจะเป็น ready`);
  const c = db.prepare('SELECT id, video_file FROM clips WHERE id = ?').get(clipId);
  if (!c || !c.video_file) throw new SeriesError(400, 'ไม่พบคลิป หรือคลิปยังไม่มีไฟล์วิดีโอ');
  db.prepare("UPDATE episode_jobs SET status = 'ready', clip_id = ?, error = '', updated_at = ? WHERE id = ?").run(clipId, Date.now(), j.id);
  return { ...getJob(j.id), publications: listPubs(j.id) };
}

module.exports = { linkProject, syncProgress, markReadyByProject, jobByProject, SeriesError, PLATFORMS, JOB_STATUS, PUB_STATUS, listSeries, getSeries, createSeries, updateSeries, deleteSeries, listJobs, getJob, startJob, updateJob, deleteJob, listPubs, addPub, updatePub };
