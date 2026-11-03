// ช่องทางโพสต์ (หลายเพจ Facebook + YouTube) · บันทึกการโพสต์แยกตามช่องทาง · ตารางโพสต์รายวัน
// ใช้ฐานข้อมูลเดียวกับคลังคลิป (lib/db.js → handle)
const dbm = require('./db');
const db = dbm.handle;

db.exec(`
CREATE TABLE IF NOT EXISTS channels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'fb',        -- fb = เพจ Facebook | yt = ช่อง YouTube (Shorts)
  name       TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  goal       INTEGER NOT NULL DEFAULT 3,        -- เป้าต่อวัน (คลิป)
  kinds      TEXT NOT NULL DEFAULT 'product',   -- ชนิดคลิปที่ลงช่องทางนี้ คั่นด้วย , (product, quick, story)
  times      TEXT NOT NULL DEFAULT '',          -- เวลาโพสต์ประจำ เช่น 09:00,12:00,19:00 (ตารางสร้างช่องให้ทุกวัน)
  tone       TEXT NOT NULL DEFAULT '',          -- สไตล์แคปชัน (โน้ตไว้ใช้กับ AI)
  active     INTEGER NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clip_posts (
  clip_id    INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  posted_at  INTEGER NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (clip_id, channel_id)
);
CREATE TABLE IF NOT EXISTS schedule (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  day        TEXT NOT NULL,                     -- YYYY-MM-DD (เวลาเครื่อง)
  time       TEXT NOT NULL,                     -- HH:MM
  clip_id    INTEGER,                           -- คลิปที่จะลง (ว่าง = ยังไม่ได้เลือก)
  state      TEXT NOT NULL DEFAULT 'wait',      -- wait = รอถึงเวลา | set = ตั้งเวลาในเพจ/Studio แล้ว | done = โพสต์แล้ว | skip = ข้าม
  UNIQUE (channel_id, day, time)
);
CREATE INDEX IF NOT EXISTS idx_schedule_day ON schedule(day, time);
CREATE TABLE IF NOT EXISTS page_quests (
  channel_id INTEGER PRIMARY KEY,
  week       TEXT NOT NULL DEFAULT '',          -- ข้อความช่วงสัปดาห์จากหน้าสถานะ เช่น "1 พ.ย. - 7 พ.ย."
  items      TEXT NOT NULL DEFAULT '[]',        -- [{label, done, total, type}] type = reel | post | photo | follow | other
  updated_at INTEGER NOT NULL
);
`);
// รุ่น 1 พ.ย.: ช่องเวลาโพสต์รูป (photo_times) แยกจากเวลาลง Reels (times) + ชนิดช่องในตาราง (reel | photo)
{
  const chCols = db.prepare('PRAGMA table_info(channels)').all().map((c) => c.name);
  if (!chCols.includes('photo_times')) {
    db.exec("ALTER TABLE channels ADD COLUMN photo_times TEXT NOT NULL DEFAULT ''");
    // เพจ Liem: เจ้าของตั้ง 1 พ.ย. — Reels 09:00/12:00/19:00 (สินค้า + ข่าว/เรื่อง) · โพสต์รูป 07:30/15:00/21:00
    db.prepare("UPDATE channels SET photo_times = '07:30,15:00,21:00', kinds = 'product,quick,story' WHERE lower(name) = 'liem'").run();
  }
  const sCols = db.prepare('PRAGMA table_info(schedule)').all().map((c) => c.name);
  if (!sCols.includes('kind')) db.exec("ALTER TABLE schedule ADD COLUMN kind TEXT NOT NULL DEFAULT 'reel'");
}

// ครั้งแรก: สร้างช่องทางเพจ Liem (คลิปสินค้า 09:00/12:00/19:00) + ย้ายคลิปที่เคยกด "โพสต์แล้ว" มาเป็นการโพสต์ลงเพจนี้
if (!db.prepare('SELECT COUNT(*) AS n FROM channels').get().n) {
  const id = Number(db.prepare("INSERT INTO channels (kind, name, goal, kinds, times, created_at) VALUES ('fb', 'Liem', 3, 'product', '09:00,12:00,19:00', ?)").run(Date.now()).lastInsertRowid);
  db.prepare("INSERT OR IGNORE INTO clip_posts (clip_id, channel_id, posted_at, url) SELECT id, ?, posted_at, COALESCE(fb_url, '') FROM clips WHERE status = 'posted' AND posted_at IS NOT NULL").run(id);
}

class ChannelError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const KINDS = ['product', 'quick', 'story'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(b, cur = {}) {
  const o = { ...cur };
  if (b.kind !== undefined) { if (!['fb', 'yt'].includes(b.kind)) throw new ChannelError('ชนิดช่องทางต้องเป็น fb หรือ yt'); o.kind = b.kind; }
  if (b.name !== undefined) { o.name = String(b.name).trim().slice(0, 80); if (!o.name) throw new ChannelError('ใส่ชื่อช่องทาง'); }
  if (b.url !== undefined) { o.url = String(b.url).trim().slice(0, 300); if (o.url && !/^https:\/\//.test(o.url)) throw new ChannelError('ลิงก์ต้องขึ้นต้นด้วย https://'); }
  if (b.goal !== undefined) o.goal = Math.max(0, Math.min(50, Math.round(Number(b.goal)) || 0));
  if (b.kinds !== undefined) o.kinds = (Array.isArray(b.kinds) ? b.kinds : String(b.kinds).split(',')).map((x) => String(x).trim()).filter((x) => KINDS.includes(x)).join(',');
  if (b.times !== undefined) {
    const t = (Array.isArray(b.times) ? b.times : String(b.times).split(/[,\s]+/)).map((x) => String(x).trim().replace(/^(\d):/, '0$1:')).filter(Boolean);
    const bad = t.find((x) => !TIME_RE.test(x));
    if (bad) throw new ChannelError(`เวลาไม่ถูกต้อง: ${bad} (ใช้แบบ 09:00)`);
    o.times = [...new Set(t)].sort().slice(0, 12).join(',');
  }
  if (b.photo_times !== undefined) {
    const t = (Array.isArray(b.photo_times) ? b.photo_times : String(b.photo_times).split(/[,\s]+/)).map((x) => String(x).trim().replace(/^(\d):/, '0$1:')).filter(Boolean);
    const bad = t.find((x) => !TIME_RE.test(x));
    if (bad) throw new ChannelError(`เวลาโพสต์รูปไม่ถูกต้อง: ${bad} (ใช้แบบ 07:30)`);
    o.photo_times = [...new Set(t)].sort().slice(0, 12).join(',');
  }
  if (b.tone !== undefined) o.tone = String(b.tone).trim().slice(0, 120);
  if (b.active !== undefined) o.active = b.active ? 1 : 0;
  return o;
}

const list = () => db.prepare('SELECT * FROM channels ORDER BY position, id').all();
const get = (id) => db.prepare('SELECT * FROM channels WHERE id = ?').get(id) || null;
function mustGet(id) { const c = get(id); if (!c) throw new ChannelError('ไม่พบช่องทาง', 404); return c; }

function create(b) {
  const o = clean({ kind: 'fb', goal: 3, kinds: 'product', times: '', photo_times: '', tone: '', url: '', ...b });
  if (!o.name) throw new ChannelError('ใส่ชื่อช่องทาง');
  const pos = (db.prepare('SELECT MAX(position) AS p FROM channels').get().p || 0) + 1;
  const id = Number(db.prepare('INSERT INTO channels (kind, name, url, goal, kinds, times, photo_times, tone, active, position, created_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)')
    .run(o.kind, o.name, o.url, o.goal, o.kinds, o.times, o.photo_times, o.tone, pos, Date.now()).lastInsertRowid);
  return get(id);
}
function update(id, b) {
  const o = clean(b, mustGet(id));
  db.prepare('UPDATE channels SET kind=?, name=?, url=?, goal=?, kinds=?, times=?, photo_times=?, tone=?, active=? WHERE id=?').run(o.kind, o.name, o.url, o.goal, o.kinds, o.times, o.photo_times || '', o.tone, o.active, id);
  // เปลี่ยนเวลาประจำ → ล้างช่องว่างที่ยังไม่ได้เลือกคลิปของวันนี้เป็นต้นไป แล้วสร้างใหม่ตอนเปิดตาราง
  if (b.times !== undefined || b.photo_times !== undefined) db.prepare("DELETE FROM schedule WHERE channel_id = ? AND clip_id IS NULL AND state = 'wait' AND day >= ?").run(id, dayKey(new Date()));
  return get(id);
}
function remove(id) {
  mustGet(id);
  db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  db.prepare('DELETE FROM schedule WHERE channel_id = ?').run(id);
  db.prepare('DELETE FROM clip_posts WHERE channel_id = ?').run(id);
  db.prepare('DELETE FROM page_quests WHERE channel_id = ?').run(id);
}

// ---------- การโพสต์ต่อช่องทาง ----------
function postsFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT clip_id, channel_id, posted_at, url FROM clip_posts WHERE clip_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  for (const r of rows) { if (!out.has(r.clip_id)) out.set(r.clip_id, []); out.get(r.clip_id).push({ channel_id: r.channel_id, posted_at: r.posted_at, url: r.url }); }
  return out;
}
// บันทึกว่าโพสต์ลงช่องทางแล้ว → คลิปเป็น "โพสต์แล้ว" (posted_at = ครั้งแรก) + ช่องในตารางวันนี้ที่จองคลิปนี้ไว้เป็น done
function markPosted(clipId, channelId, url = '') {
  mustGet(channelId);
  const now = Date.now();
  db.prepare('INSERT INTO clip_posts (clip_id, channel_id, posted_at, url) VALUES (?,?,?,?) ON CONFLICT(clip_id, channel_id) DO UPDATE SET url = excluded.url').run(clipId, channelId, now, url || '');
  db.prepare("UPDATE schedule SET state = 'done' WHERE clip_id = ? AND channel_id = ? AND state IN ('wait','set')").run(clipId, channelId);
  const c = dbm.get(clipId);
  if (c && c.status !== 'posted') dbm.update(clipId, { status: 'posted', posted_at: now, fb_url: url || c.fb_url || null });
  else if (c && url && !c.fb_url) dbm.update(clipId, { fb_url: url });
}
// ยกเลิกการโพสต์ (ช่องทางเดียว หรือทั้งหมดถ้าไม่ระบุ) → ไม่เหลือช่องทางไหนแล้ว คลิปกลับเป็นพร้อมโพสต์
function unmarkPosted(clipId, channelId = null) {
  if (channelId) db.prepare('DELETE FROM clip_posts WHERE clip_id = ? AND channel_id = ?').run(clipId, channelId);
  else db.prepare('DELETE FROM clip_posts WHERE clip_id = ?').run(clipId);
  db.prepare("UPDATE schedule SET state = 'wait' WHERE clip_id = ? AND state = 'done'" + (channelId ? ' AND channel_id = ?' : '')).run(...(channelId ? [clipId, channelId] : [clipId]));
  const left = db.prepare('SELECT COUNT(*) AS n FROM clip_posts WHERE clip_id = ?').get(clipId).n;
  return left;
}
const forgetClip = (clipId) => { db.prepare('DELETE FROM clip_posts WHERE clip_id = ?').run(clipId); db.prepare('UPDATE schedule SET clip_id = NULL, state = \'wait\' WHERE clip_id = ?').run(clipId); };
// โพสต์แล้ววันนี้ แยกช่องทาง → { channel_id: n }
function todayCounts() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const out = {};
  for (const r of db.prepare('SELECT channel_id, COUNT(*) AS n FROM clip_posts WHERE posted_at >= ? GROUP BY channel_id').all(t0.getTime())) out[r.channel_id] = r.n;
  return out;
}

// ---------- ตารางโพสต์ ----------
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function ensureDay(day) {
  const ins = db.prepare('INSERT OR IGNORE INTO schedule (channel_id, day, time, kind) VALUES (?,?,?,?)');
  for (const ch of list()) {
    if (!ch.active) continue;
    if (ch.times) for (const t of ch.times.split(',')) ins.run(ch.id, day, t, 'reel');
    if (ch.photo_times) for (const t of ch.photo_times.split(',')) ins.run(ch.id, day, t, 'photo');
  }
}
function day(dayStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) throw new ChannelError('วันที่ไม่ถูกต้อง');
  ensureDay(dayStr);
  const rows = db.prepare('SELECT s.*, c.title AS clip_title, c.kind AS clip_kind, c.status AS clip_status, c.badge AS clip_badge FROM schedule s LEFT JOIN clips c ON c.id = s.clip_id WHERE s.day = ? ORDER BY s.time, s.channel_id').all(dayStr);
  return { day: dayStr, channels: list().filter((c) => c.active), slots: rows };
}
function getSlot(id) { const s = db.prepare('SELECT * FROM schedule WHERE id = ?').get(id); if (!s) throw new ChannelError('ไม่พบช่องในตาราง', 404); return s; }
function addSlot(b) {
  mustGet(Number(b.channel_id));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.day))) throw new ChannelError('วันที่ไม่ถูกต้อง');
  const t = String(b.time || '').replace(/^(\d):/, '0$1:');
  if (!TIME_RE.test(t)) throw new ChannelError('เวลาไม่ถูกต้อง (ใช้แบบ 09:00)');
  db.prepare('INSERT OR IGNORE INTO schedule (channel_id, day, time, kind) VALUES (?,?,?,?)').run(Number(b.channel_id), b.day, t, b.kind === 'photo' ? 'photo' : 'reel');
  return db.prepare('SELECT * FROM schedule WHERE channel_id = ? AND day = ? AND time = ?').get(Number(b.channel_id), b.day, t);
}
function updateSlot(id, b) {
  const s = getSlot(id);
  const clip = b.clip_id === undefined ? s.clip_id : (b.clip_id ? Number(b.clip_id) : null);
  if (clip && !dbm.get(clip)) throw new ChannelError('ไม่พบคลิป', 404);
  if (clip && (dbm.get(clip).kind === 'photo') !== (s.kind === 'photo')) throw new ChannelError(s.kind === 'photo' ? 'ช่องนี้เป็นช่องโพสต์รูป — เลือกโพสต์รูป' : 'ช่องนี้เป็นช่อง Reels — เลือกคลิปวิดีโอ');
  const state = b.state === undefined ? s.state : String(b.state);
  if (!['wait', 'set', 'done', 'skip'].includes(state)) throw new ChannelError('สถานะไม่ถูกต้อง');
  db.prepare('UPDATE schedule SET clip_id = ?, state = ? WHERE id = ?').run(clip, clip ? state : (state === 'skip' ? 'skip' : 'wait'), id);
  return getSlot(id);
}
const removeSlot = (id) => { getSlot(id); db.prepare('DELETE FROM schedule WHERE id = ?').run(id); };
// เติมคลิปพร้อมโพสต์ลงช่องว่างของวันนั้น: ตรงชนิดคลิปของช่องทาง · ยังไม่เคยลงช่องทางนี้ · ยังไม่ถูกจองไว้ที่ช่องอื่นของช่องทางเดียวกัน · คลิปเก่าก่อน
function autofill(dayStr) {
  ensureDay(dayStr);
  const ready = db.prepare("SELECT id, kind FROM clips WHERE video_file IS NOT NULL AND kind != 'photo' AND status IN ('ready','posted') ORDER BY created_at, id").all();
  const photos = db.prepare("SELECT id, kind, badge FROM clips WHERE kind = 'photo' AND photo_file != '' AND status IN ('ready','posted') ORDER BY created_at, id").all();
  let filled = 0;
  for (const ch of list().filter((c) => c.active)) {
    const kinds = ch.kinds ? ch.kinds.split(',') : KINDS;
    const posted = new Set(db.prepare('SELECT clip_id FROM clip_posts WHERE channel_id = ?').all(ch.id).map((r) => r.clip_id));
    const booked = new Set(db.prepare("SELECT clip_id FROM schedule WHERE channel_id = ? AND clip_id IS NOT NULL AND state != 'skip'").all(ch.id).map((r) => r.clip_id));
    const fresh = (c) => !posted.has(c.id) && !booked.has(c.id);
    // Reels: สลับชนิด (สินค้า ↔ ข่าว/เรื่อง) ให้วันหนึ่งไม่เป็นสินค้าล้วน · โพสต์รูป: สลับแบบการ์ด (ข่าว / ชวนคุย / สินค้า)
    const mix = (arr, key) => { const g = new Map(); for (const c of arr) { const k = key(c); if (!g.has(k)) g.set(k, []); g.get(k).push(c); } const out = []; const qs = [...g.values()]; while (qs.some((q) => q.length)) for (const q of qs) if (q.length) out.push(q.shift()); return out; };
    const pools = {
      reel: mix(ready.filter((c) => kinds.includes(c.kind) && fresh(c)), (c) => (c.kind === 'product' ? 'p' : 'o')),
      photo: mix(photos.filter(fresh), (c) => c.badge || 'x'),
    };
    for (const s of db.prepare("SELECT id, kind FROM schedule WHERE channel_id = ? AND day = ? AND clip_id IS NULL AND state = 'wait' ORDER BY time").all(ch.id, dayStr)) {
      const c = pools[s.kind === 'photo' ? 'photo' : 'reel'].shift();
      if (!c) continue;
      db.prepare('UPDATE schedule SET clip_id = ? WHERE id = ?').run(c.id, s.id);
      filled++;
    }
  }
  return { filled, ...day(dayStr) };
}
// ช่องที่ถึงเวลาแล้วแต่ยังไม่โพสต์ (วันนี้) — ใช้แจ้งเตือนบนหน้าเว็บ
// เฉพาะช่องที่เลยเวลามาไม่เกิน 3 ชั่วโมง (ช่องเก่ากว่านั้นถือว่าพลาดไปแล้ว ไม่เตือนซ้ำทั้งวัน)
function due(now = new Date()) {
  const d = dayKey(now), t = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const from = new Date(now.getTime() - 3 * 3600_000);
  const f = dayKey(from) === d ? `${pad(from.getHours())}:${pad(from.getMinutes())}` : '00:00';
  ensureDay(d);
  return db.prepare("SELECT s.*, c.title AS clip_title, ch.name AS channel_name, ch.kind AS channel_kind FROM schedule s JOIN channels ch ON ch.id = s.channel_id LEFT JOIN clips c ON c.id = s.clip_id WHERE s.day = ? AND s.time <= ? AND s.time >= ? AND s.state = 'wait' AND ch.active = 1 ORDER BY s.time").all(d, t, f);
}
// คลิปที่จองไว้ในช่องถัดไปของช่องทาง (ใช้กับแผงโพสต์ของส่วนเสริม) — ช่องที่ถึงเวลาแล้วก่อน แล้วค่อยช่องถัดไปของวันนี้
function nextBooked(channelId, now = new Date(), kind = null) {
  const d = dayKey(now);
  return db.prepare(`SELECT * FROM schedule WHERE channel_id = ? AND day = ? AND clip_id IS NOT NULL AND state = 'wait'${kind ? ' AND kind = ?' : ''} ORDER BY time LIMIT 1`).get(...(kind ? [channelId, d, kind] : [channelId, d])) || null;
}

// ---------- เควสหน้าสถานะเพจ (แดชบอร์ดครีเอเตอร์ของ Facebook) ----------
// ส่วนเสริมอ่าน facebook.com/professional_dashboard/status แล้วส่งมา → วางแผนว่าวันนี้ต้องลง Reels / โพสต์รูปอีกกี่ชิ้น
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function questType(label) {
  if (/reels?/i.test(label)) return 'reel';
  if (/รูปภาพ|รูป|photo/i.test(label)) return 'photo';
  if (/โพสต์|post/i.test(label)) return 'post';
  if (/ผู้ติดตาม|follower/i.test(label)) return 'follow';
  return 'other';
}
function setQuests(channelId, b) {
  mustGet(channelId);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 12).map((x) => {
    const label = String(x.label || '').trim().slice(0, 120);
    const total = Math.max(0, Math.min(1000, Math.round(Number(x.total)) || 0)), done = Math.max(0, Math.min(total || 1000, Math.round(Number(x.done)) || 0));
    return { label, done, total, complete: !!x.complete || (total > 0 && done >= total), type: questType(label) };
  }).filter((x) => x.label);
  const week = String(b.week || '').trim().slice(0, 60);
  db.prepare('INSERT INTO page_quests (channel_id, week, items, updated_at) VALUES (?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET week = excluded.week, items = excluded.items, updated_at = excluded.updated_at')
    .run(channelId, week, JSON.stringify(items), Date.now());
  return questsFor(channelId);
}
// วันที่เหลือของสัปดาห์เควส (นับวันนี้ด้วย) จาก "1 พ.ย. - 7 พ.ย." · อ่านไม่ออก = นับถึงวันเสาร์
function daysLeft(week, now = new Date()) {
  const m = /(\d{1,2})\s*([ก-๙.]+)\s*(?:\d{2,4})?\s*$/.exec(String(week).split(/[-–]/).pop() || '');
  let end = null;
  if (m) { const mon = TH_MON.indexOf(m[2].trim()); if (mon >= 0) { end = new Date(now.getFullYear(), mon, Number(m[1])); if (now - end > 180 * 86400_000) end.setFullYear(end.getFullYear() + 1); } }
  if (!end) { end = new Date(now); end.setDate(now.getDate() + (6 - now.getDay())); }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.round((end - today) / 86400_000) + 1);
}
function questsFor(channelId) {
  const r = db.prepare('SELECT * FROM page_quests WHERE channel_id = ?').get(channelId);
  if (!r) return null;
  let items = [];
  try { items = JSON.parse(r.items); } catch { /* ข้อมูลเสีย */ }
  const days = daysLeft(r.week);
  const rem = (t) => items.filter((x) => x.type === t && !x.complete).reduce((a, x) => a + Math.max(0, x.total - x.done), 0);
  // โพสต์รูป 1 โพสต์นับทั้งเควส "โพสต์" และ "โพสต์ที่มีรูป" → ต้องโพสต์รูปเท่าที่ขาดมากกว่าของสองเควส
  const reelLeft = rem('reel'), photoLeft = Math.max(rem('photo'), rem('post'));
  const posted = db.prepare('SELECT COUNT(*) AS n FROM clip_posts p JOIN clips c ON c.id = p.clip_id WHERE p.channel_id = ? AND p.posted_at >= ? AND c.kind = ?');
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const todayReel = db.prepare("SELECT COUNT(*) AS n FROM clip_posts p JOIN clips c ON c.id = p.clip_id WHERE p.channel_id = ? AND p.posted_at >= ? AND c.kind != 'photo'").get(channelId, t0.getTime()).n;
  const todayPhoto = posted.get(channelId, t0.getTime(), 'photo').n;
  return {
    channel_id: channelId, week: r.week, items, updated_at: r.updated_at, days,
    plan: { reel: Math.ceil(reelLeft / days), photo: Math.ceil(photoLeft / days), reelLeft, photoLeft, todayReel, todayPhoto },
  };
}
const quests = () => list().map((c) => questsFor(c.id) && { ...questsFor(c.id), channel: c.name }).filter(Boolean);
const byName = (name) => db.prepare('SELECT * FROM channels WHERE lower(name) = lower(?)').get(String(name || '')) || null;

module.exports = { ChannelError, list, get, mustGet, create, update, remove, postsFor, markPosted, unmarkPosted, forgetClip, todayCounts, day, dayKey, addSlot, updateSlot, removeSlot, autofill, due, nextBooked, byName, setQuests, questsFor, quests, daysLeft };
