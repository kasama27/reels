// โปรเจกต์เรื่อง (หนังสั้นหลายช็อต): เรื่อง → คลังตัวละคร/สถานที่/ของประกอบ → ช็อต (≈8 วิ ต่อ 1 คลิปที่สร้างใน Meta AI)
// หลักคิด (จากสเปก StoryFlow Studio): ความต่อเนื่องของเรื่องมาก่อน — รายละเอียดตัวละคร/สถานที่ถูกใส่ซ้ำคำต่อคำในทุก prompt
// และบันทึกสถานะต้น/ท้ายช็อต เพื่อเตือนเมื่อช็อตไม่ต่อกัน
const { handle: db } = require('./db');
const brand = require('./brand');

db.exec(`
CREATE TABLE IF NOT EXISTS story_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  premise TEXT NOT NULL DEFAULT '',      -- เรื่องย่อ/เนื้อเรื่องที่จะทำ
  total_sec INTEGER NOT NULL DEFAULT 240,
  shot_sec INTEGER NOT NULL DEFAULT 8,
  aspect TEXT NOT NULL DEFAULT '9:16',
  style TEXT NOT NULL DEFAULT '',        -- โทนภาพ (ว่าง = ใช้โทนภาพของสไตล์ประจำเพจ)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS story_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- character | location | prop
  name TEXT NOT NULL,
  desc TEXT NOT NULL DEFAULT '',         -- คำอธิบายภาพ (อังกฤษ) ที่ใส่ซ้ำทุก prompt
  notes TEXT NOT NULL DEFAULT '',        -- โน้ตของเรา (บทบาท ฯลฯ) ไม่ใส่ใน prompt
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_story_entities_p ON story_entities(project_id, kind, position);
CREATE TABLE IF NOT EXISTS story_shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  scene TEXT NOT NULL DEFAULT '',
  beat TEXT NOT NULL DEFAULT '',         -- เหตุการณ์ที่ช็อตนี้ต้องเล่า (ไทย)
  location_id INTEGER,
  character_ids TEXT NOT NULL DEFAULT '[]',
  prop_ids TEXT NOT NULL DEFAULT '[]',
  action TEXT NOT NULL DEFAULT '',       -- ภาพ/การกระทำ (อังกฤษ)
  camera TEXT NOT NULL DEFAULT '',
  narration TEXT NOT NULL DEFAULT '',    -- คำบรรยาย (ไทย)
  duration INTEGER NOT NULL DEFAULT 8,
  state_before TEXT NOT NULL DEFAULT '',
  state_after TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | ready | generated | approved | rejected
  video_file TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_story_shots_p ON story_shots(project_id, position);
`);

// migration: ชื่อที่ใช้ใน prompt (อังกฤษ/พินอิน) — Meta AI เข้าใจชื่ออังกฤษคงที่ดีกว่าชื่อไทยปนในประโยคอังกฤษ
if (!db.prepare('PRAGMA table_info(story_entities)').all().some((c) => c.name === 'alias')) db.exec("ALTER TABLE story_entities ADD COLUMN alias TEXT NOT NULL DEFAULT ''");

// media: video = ช็อตเป็นคลิปจาก Meta AI | image = ช็อตเป็นภาพนิ่ง (สร้างเอง) แล้วตอนรวมคลิปทำซูม/แพนให้ขยับ
if (!db.prepare('PRAGMA table_info(story_projects)').all().some((c) => c.name === 'media')) db.exec("ALTER TABLE story_projects ADD COLUMN media TEXT NOT NULL DEFAULT 'video'");

// sources: แหล่งข้อมูลของเรื่อง (JSON [{title,url,note}]) — เก็บไว้กับโปรเจกต์ ครั้งหน้าไปอ่านจากแหล่งเดิมได้ ไม่ถูกใส่ใน prompt
if (!db.prepare('PRAGMA table_info(story_projects)').all().some((c) => c.name === 'sources')) db.exec("ALTER TABLE story_projects ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'");

// generator: เว็บที่ผู้ใช้ไปสร้างรูป/คลิปช็อต (มีผลแค่คำแนะนำ/ลิงก์ในหน้าจอ ไม่เปลี่ยนเนื้อ prompt)
if (!db.prepare('PRAGMA table_info(story_projects)').all().some((c) => c.name === 'generator')) db.exec("ALTER TABLE story_projects ADD COLUMN generator TEXT NOT NULL DEFAULT 'chatgpt'");

// look: โทนภาพที่ใส่ซ้ำทุกช็อต (JSON {ref,light,film,sound}) — ดู LOOK_PRESETS
if (!db.prepare('PRAGMA table_info(story_projects)').all().some((c) => c.name === 'look')) db.exec("ALTER TABLE story_projects ADD COLUMN look TEXT NOT NULL DEFAULT '{}'");

const MEDIA = ['video', 'image'];
const GENERATORS = ['flow', 'chatgpt', 'meta', 'seedance'];
const KINDS = ['character', 'location', 'prop'];
const SHOT_STATUS = ['draft', 'ready', 'generated', 'approved', 'rejected'];
const ASPECTS = ['9:16', '4:5', '1:1', '16:9'];
const json = (s, d = []) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : d; } catch { return d; } };

// ---------- โปรเจกต์ ----------
const listProjects = () => db.prepare(`
  SELECT p.*, (SELECT COUNT(*) FROM story_shots s WHERE s.project_id = p.id) AS shots,
         (SELECT COUNT(*) FROM story_shots s WHERE s.project_id = p.id AND s.status IN ('generated','approved')) AS done
  FROM story_projects p ORDER BY p.updated_at DESC`).all();
const getProjectRow = (id) => db.prepare('SELECT * FROM story_projects WHERE id = ?').get(id) || null;

function createProject({ title, premise = '', total_sec = 240, shot_sec = 8, aspect = '9:16', style = '', media = 'video', sources = '[]', generator = 'chatgpt' }) {
  const t = Date.now();
  const r = db.prepare('INSERT INTO story_projects (title, premise, total_sec, shot_sec, aspect, style, media, sources, generator, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(title, premise, total_sec, shot_sec, aspect, style, media, sources, generator, t, t);
  return getProjectRow(Number(r.lastInsertRowid));
}
function updateProject(id, f) {
  const keys = ['title', 'premise', 'total_sec', 'shot_sec', 'aspect', 'style', 'media', 'sources', 'generator', 'look'].filter((k) => f[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE story_projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => f[k]), Date.now(), id);
  return getProjectRow(id);
}
function deleteProject(id) {
  db.prepare('DELETE FROM story_shots WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM story_entities WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM story_projects WHERE id = ?').run(id);
}
const touch = (id) => db.prepare('UPDATE story_projects SET updated_at = ? WHERE id = ?').run(Date.now(), id);
const planCount = (p) => Math.max(1, Math.ceil(p.total_sec / p.shot_sec));

// ---------- คลังตัวละคร/สถานที่/ของประกอบ ----------
const listEntities = (pid) => db.prepare("SELECT * FROM story_entities WHERE project_id = ? ORDER BY CASE kind WHEN 'character' THEN 0 WHEN 'location' THEN 1 ELSE 2 END, position, id").all(pid);
const getEntity = (id) => db.prepare('SELECT * FROM story_entities WHERE id = ?').get(id) || null;
function addEntity(pid, { kind, name, alias = '', desc = '', notes = '' }) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM story_entities WHERE project_id = ? AND kind = ?').get(pid, kind).n;
  const r = db.prepare('INSERT INTO story_entities (project_id, kind, name, alias, desc, notes, position) VALUES (?,?,?,?,?,?,?)').run(pid, kind, name, alias, desc, notes, pos);
  touch(pid);
  return getEntity(Number(r.lastInsertRowid));
}
function updateEntity(id, f) {
  const keys = ['name', 'alias', 'desc', 'notes'].filter((k) => f[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE story_entities SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
  const e = getEntity(id);
  if (e) touch(e.project_id);
  return e;
}
function deleteEntity(id) {
  const e = getEntity(id);
  if (!e) return;
  db.prepare('DELETE FROM story_entities WHERE id = ?').run(id);
  // เอาออกจากช็อตที่อ้างถึง (กัน ID ค้าง)
  for (const s of db.prepare('SELECT id, location_id, character_ids, prop_ids FROM story_shots WHERE project_id = ?').all(e.project_id)) {
    const chars = json(s.character_ids).filter((x) => x !== id), props = json(s.prop_ids).filter((x) => x !== id);
    db.prepare('UPDATE story_shots SET location_id = ?, character_ids = ?, prop_ids = ? WHERE id = ?')
      .run(s.location_id === id ? null : s.location_id, JSON.stringify(chars), JSON.stringify(props), s.id);
  }
  touch(e.project_id);
}

// ---------- ช็อต ----------
const rowShot = (r) => r && { ...r, character_ids: json(r.character_ids), prop_ids: json(r.prop_ids) };
const listShots = (pid) => db.prepare('SELECT * FROM story_shots WHERE project_id = ? ORDER BY position, id').all(pid).map(rowShot);
const getShot = (id) => rowShot(db.prepare('SELECT * FROM story_shots WHERE id = ?').get(id));

function addShot(pid, f = {}) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM story_shots WHERE project_id = ?').get(pid).n;
  const t = Date.now();
  const r = db.prepare(`INSERT INTO story_shots (project_id, position, scene, beat, location_id, character_ids, prop_ids, action, camera, narration, duration, state_before, state_after, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid, pos, f.scene || '', f.beat || '', f.location_id ?? null, JSON.stringify(f.character_ids || []), JSON.stringify(f.prop_ids || []),
    f.action || '', f.camera || '', f.narration || '', f.duration || getProjectRow(pid).shot_sec, f.state_before || '', f.state_after || '', 'draft', t, t);
  touch(pid);
  return getShot(Number(r.lastInsertRowid));
}
function updateShot(id, f) {
  const cols = { scene: 1, beat: 1, location_id: 1, action: 1, camera: 1, narration: 1, duration: 1, state_before: 1, state_after: 1, prompt: 1, status: 1, note: 1 };
  const sets = [], args = [];
  for (const k of Object.keys(f)) if (cols[k]) { sets.push(`${k} = ?`); args.push(f[k]); }
  for (const k of ['character_ids', 'prop_ids']) if (f[k] !== undefined) { sets.push(`${k} = ?`); args.push(JSON.stringify(f[k])); }
  if (sets.length) db.prepare(`UPDATE story_shots SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, Date.now(), id);
  const s = getShot(id);
  if (s) touch(s.project_id);
  return s;
}
function deleteShot(id) {
  const s = getShot(id);
  if (!s) return;
  db.prepare('DELETE FROM story_shots WHERE id = ?').run(id);
  renumber(s.project_id);
  touch(s.project_id);
}
function renumber(pid) {
  listShots(pid).forEach((s, i) => { if (s.position !== i + 1) db.prepare('UPDATE story_shots SET position = ? WHERE id = ?').run(i + 1, s.id); });
}
function moveShot(id, dir) {
  const s = getShot(id);
  if (!s) return null;
  const all = listShots(s.project_id), i = all.findIndex((x) => x.id === id), j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= all.length) return s;
  db.prepare('UPDATE story_shots SET position = ? WHERE id = ?').run(all[j].position, all[i].id);
  db.prepare('UPDATE story_shots SET position = ? WHERE id = ?').run(all[i].position, all[j].id);
  renumber(s.project_id);
  touch(s.project_id);
  return getShot(id);
}
// คลิปที่แนบกับช็อต (ไฟล์เก็บใน data/story-videos/) — แนบแล้วสถานะ draft/ready จะขยับเป็น generated อัตโนมัติ
function setShotVideo(id, file) {
  const s = getShot(id);
  if (!s) return null;
  db.prepare('UPDATE story_shots SET video_file = ?, status = ?, updated_at = ? WHERE id = ?').run(file, ['draft', 'ready'].includes(s.status) ? 'generated' : s.status, Date.now(), id);
  touch(s.project_id);
  return getShot(id);
}
function clearShotVideo(id) {
  const s = getShot(id);
  if (!s) return null;
  db.prepare('UPDATE story_shots SET video_file = NULL, status = ?, updated_at = ? WHERE id = ?').run(['generated', 'approved', 'rejected'].includes(s.status) ? 'ready' : s.status, Date.now(), id);
  touch(s.project_id);
  return getShot(id);
}
const videoFiles = (pid) => listShots(pid).map((s) => s.video_file).filter(Boolean);
const clearShots = (pid) => { db.prepare('DELETE FROM story_shots WHERE project_id = ?').run(pid); touch(pid); };

// ---------- โทนภาพ (look) ที่ใส่ซ้ำทุกช็อต — คุมให้ทุกช็อตของเรื่องหน้าตาเดียวกัน ----------
// ref = แนวอ้างอิง, light = แสง/บรรยากาศ, film = เนื้อภาพ/ฟิล์ม, sound = เสียง (ใช้กับ prompt วิดีโอเท่านั้น) — เขียนเป็นอังกฤษ
const LOOK_KEYS = ['ref', 'light', 'film', 'sound'];
const LOOK_PRESETS = [
  { id: 'hk', label: 'แอ็กชันฮ่องกงคลาสสิก (เกรนฟิล์ม เงาซีเปีย แสงทอง)', ref: 'classic Hong Kong martial arts cinema', light: 'golden sunlight cutting through dust, moody amber atmosphere, natural side lighting, floating dust particles', film: 'vintage 35mm film grain, deep sepia shadows, warm golden highlights, rich cinematic contrast, authentic skin texture', sound: 'traditional percussion, realistic combat sound effects' },
  { id: 'darkxian', label: 'ภาพประกอบเซียนมืด (เขียวมรกต ทองประกาย)', ref: 'dark fantasy xianxia cultivation illustration', light: 'cold emerald green glow with golden energy highlights, misty depth, dramatic rim light', film: 'highly detailed digital painting, painterly cinematic realism, particle debris and glowing sparks', sound: 'low cinematic drones, sword resonance, energy whooshes' },
  { id: 'donghua', label: 'อนิเมะจีน 3D (แสงนีออน พลังเรืองแสง)', ref: 'Chinese 3D donghua', light: 'neon rim lights, glowing spiritual energy, high-contrast night scene', film: 'glossy 3D render, sharp details, soft bloom', sound: 'epic orchestral score with electronic accents, impact hits' },
  { id: 'ink', label: 'ภาพหมึกตะวันออก (หมอก โทนจาง จุดแดง)', ref: 'Chinese ink-wash painting', light: 'soft diffused morning mist, muted tones with a single red accent', film: 'ink wash texture on rice paper, visible brush strokes, minimal color palette', sound: 'guzheng and bamboo flute, wind' },
  { id: 'clean', label: 'สะอาด เรียบ (ข่าว/ความรู้)', ref: '', light: 'soft even daylight, neutral background', film: 'clean minimal editorial illustration, flat colors', sound: '' },
];
function lookOf(project) {
  let v = {};
  try { v = JSON.parse(project.look || '{}'); } catch { /* ข้อมูลเสีย */ }
  return Object.fromEntries(LOOK_KEYS.map((k) => [k, String(v[k] || '').trim().replace(/[.\s]+$/, '')]));
}

// ---------- prompt ----------
// ประกอบ prompt วิดีโอ 1 ช็อต: โทนภาพ → สถานที่ → ตัวละคร (คำอธิบายเดิมคำต่อคำ) → สถานะเริ่มต้น → การกระทำ → กล้อง → ข้อห้าม
function buildPrompt(project, ents, shot) {
  const byId = new Map(ents.map((e) => [e.id, e]));
  const style = (project.style || brand.get().visual || 'cinematic illustration, consistent color palette and lighting').trim().replace(/[.\s]+$/, '');
  const label = (e) => (e.alias || e.name).trim();
  const loc = byId.get(shot.location_id);
  const chars = shot.character_ids.map((i) => byId.get(i)).filter(Boolean);
  const props = shot.prop_ids.map((i) => byId.get(i)).filter(Boolean);
  const look = lookOf(project);
  const parts = [`Visual style: ${style}.`];
  if (look.ref) parts.push(`Genre reference: ${look.ref}.`);
  if (loc) parts.push(`Location: ${label(loc)}${loc.desc ? ` — ${loc.desc.replace(/[.\s]+$/, '')}` : ''}.`);
  if (chars.length) parts.push(`Characters (keep each exactly as described, same face, hair and clothes): ${chars.map((c) => `${label(c)}${c.desc ? ` — ${c.desc.replace(/[.\s]+$/, '')}` : ''}`).join('; ')}.`);
  if (props.length) parts.push(`Props: ${props.map((c) => `${label(c)}${c.desc ? ` — ${c.desc.replace(/[.\s]+$/, '')}` : ''}`).join('; ')}.`);
  if (look.light) parts.push(`Lighting and atmosphere: ${look.light}.`);
  const ratio = project.aspect === '9:16' ? 'vertical 9:16' : project.aspect === '16:9' ? 'horizontal 16:9' : project.aspect === '1:1' ? 'square 1:1' : '4:5 portrait';
  if (project.media === 'image') { // ภาพนิ่งเดียว: เฟรมที่หยุดนิ่ง ไม่มีการเคลื่อนกล้อง/เวลา
    if (shot.action) parts.push(`Single frozen moment: ${shot.action.replace(/[.\s]+$/, '')}.`);
    if (shot.camera) parts.push(`Framing: ${shot.camera.replace(/[.\s]+$/, '')}.`);
    if (look.film) parts.push(`Look: ${look.film}.`);
    parts.push(`One still image, ${ratio}, strong focal subject, room around the edges for a slow zoom. No text, no letters, no numbers, no logos, no watermark.`);
    return parts.join(' ');
  }
  if (shot.state_before) parts.push(`Starting state: ${shot.state_before.replace(/[.\s]+$/, '')}.`);
  if (shot.action) parts.push(`Action: ${shot.action.replace(/[.\s]+$/, '')}.`);
  if (shot.camera) parts.push(`Camera: ${shot.camera.replace(/[.\s]+$/, '')}.`);
  if (shot.state_after) parts.push(`Ends with: ${shot.state_after.replace(/[.\s]+$/, '')}.`);
  if (look.film) parts.push(`Look: ${look.film}.`);
  if (look.sound) parts.push(`Sound: ${look.sound}.`);
  parts.push(`About ${shot.duration} seconds, ${project.aspect === '9:16' ? 'vertical 9:16' : project.aspect === '16:9' ? 'horizontal 16:9' : project.aspect === '1:1' ? 'square 1:1' : '4:5 portrait'}. No text, no letters, no numbers, no logos, no watermark.`);
  return parts.join(' ');
}

function rebuildPrompts(pid, onlyId) {
  const p = getProjectRow(pid), ents = listEntities(pid);
  for (const s of listShots(pid)) {
    if (onlyId && s.id !== onlyId) continue;
    db.prepare('UPDATE story_shots SET prompt = ?, updated_at = ? WHERE id = ?').run(buildPrompt(p, ents, s), Date.now(), s.id);
  }
  touch(pid);
}

// ---------- คำเตือนความต่อเนื่อง (แนะนำ ไม่บล็อกงาน) ----------
function warnings(shots) {
  const out = {};
  shots.forEach((s, i) => {
    const w = [];
    if (!s.location_id) w.push('ยังไม่ได้เลือกสถานที่');
    if (!s.character_ids.length) w.push('ยังไม่ได้เลือกตัวละคร');
    if (!s.action.trim()) w.push('ยังไม่มีคำอธิบายการกระทำ (action)');
    const prev = shots[i - 1];
    if (prev && prev.state_after.trim() && s.state_before.trim() && prev.state_after.trim().toLowerCase() !== s.state_before.trim().toLowerCase()) {
      w.push(`สถานะต้นช็อตไม่ตรงกับท้ายช็อตที่ ${prev.position} — ตรวจว่าต่อกันไหม`);
    }
    if (prev && prev.location_id && s.location_id && prev.location_id !== s.location_id && prev.scene.trim() === s.scene.trim()) {
      w.push('สถานที่เปลี่ยนจากช็อตก่อนหน้า แต่ยังเป็นฉากเดียวกัน — ตั้งชื่อฉากใหม่ถ้าเป็นการเปลี่ยนฉาก');
    }
    if (w.length) out[s.id] = w;
  });
  return out;
}

function getProject(id) {
  const project = getProjectRow(id);
  if (!project) return null;
  const shots = listShots(id);
  return { project, entities: listEntities(id), shots, warnings: warnings(shots), planned: planCount(project), looks: LOOK_PRESETS };
}

// ---------- prompt รวมฉาก (ต่อหลายช็อตเป็นย่อหน้าเดียว สำหรับโมเดลวิดีโอที่สร้างได้ ~10–15 วินาทีต่อครั้ง) ----------
// จัดกลุ่มช็อตติดกันให้ความยาวรวมไม่เกิน maxSec (ช็อตเดี่ยวที่ยาวเกินก็เป็นกลุ่มของตัวเอง) แล้วประกอบจากข้อมูลช็อตตรงๆ ไม่ใช้ AI
function buildMerged(pid, maxSec = 15) {
  const p = getProjectRow(pid), ents = listEntities(pid), shots = listShots(pid), look = lookOf(p);
  const byId = new Map(ents.map((e) => [e.id, e]));
  const label = (e) => (e.alias || e.name).trim();
  const withDesc = (e) => `${label(e)}${e.desc ? ` — ${e.desc.replace(/[.\s]+$/, '')}` : ''}`;
  const style = (p.style || brand.get().visual || 'cinematic illustration, consistent color palette and lighting').trim().replace(/[.\s]+$/, '');
  const ratio = p.aspect === '9:16' ? 'vertical 9:16' : p.aspect === '16:9' ? 'horizontal 16:9' : p.aspect === '1:1' ? 'square 1:1' : '4:5 portrait';
  const groups = [];
  for (const s of shots) {
    const g = groups[groups.length - 1];
    if (g && g.sec + s.duration <= maxSec) { g.shots.push(s); g.sec += s.duration; } else groups.push({ shots: [s], sec: s.duration });
  }
  const uniq = (ids) => [...new Set(ids)].map((i) => byId.get(i)).filter(Boolean);
  return groups.map((g) => {
    const locs = uniq(g.shots.map((s) => s.location_id).filter(Boolean));
    const chars = uniq(g.shots.flatMap((s) => s.character_ids));
    const props = uniq(g.shots.flatMap((s) => s.prop_ids));
    const parts = [`Cinematic sequence, ${g.sec} seconds, ${ratio}${look.ref ? `, in the style of ${look.ref}` : ''}.`, `Visual style: ${style}.`];
    if (locs.length === 1) parts.push(`Location: ${withDesc(locs[0])}.`);
    else if (locs.length) parts.push(`Locations (in order): ${locs.map(withDesc).join('; ')}.`);
    if (chars.length) parts.push(`Characters (keep each exactly as described, same face, hair and clothes): ${chars.map(withDesc).join('; ')}.`);
    if (props.length) parts.push(`Props: ${props.map(withDesc).join('; ')}.`);
    if (look.light) parts.push(`Lighting and atmosphere: ${look.light}.`);
    const beats = g.shots.filter((s) => s.action).map((s, i) => `(${i + 1}) ${s.action.replace(/[.\s]+$/, '')}${s.camera ? ` — camera: ${s.camera.replace(/[.\s]+$/, '')}` : ''}`);
    if (beats.length) parts.push(`The action unfolds as ${beats.length === 1 ? 'one continuous beat' : `${beats.length} seamless continuous beats, no hard cuts`}:${beats.join('; ')}.`);
    const end = g.shots[g.shots.length - 1].state_after;
    if (end) parts.push(`It ends with: ${end.replace(/[.\s]+$/, '')}.`);
    if (look.film) parts.push(`Look: ${look.film}.`);
    if (look.sound) parts.push(`Sound: ${look.sound}.`);
    parts.push('No dialogue, no on-screen text, no letters, no numbers, no logos, no watermark.');
    return { positions: g.shots.map((s) => s.position), seconds: g.sec, prompt: parts.join(' ') };
  });
}

module.exports = {
  KINDS, MEDIA, GENERATORS, SHOT_STATUS, ASPECTS, listProjects, getProject, getProjectRow, createProject, updateProject, deleteProject, planCount,
  listEntities, getEntity, addEntity, updateEntity, deleteEntity, listShots, getShot, addShot, updateShot, deleteShot, moveShot, clearShots, setShotVideo, clearShotVideo, videoFiles,
  buildPrompt, buildMerged, rebuildPrompts, warnings, LOOK_PRESETS,
};
