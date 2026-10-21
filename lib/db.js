// คลังคลิป — SQLite ผ่าน node:sqlite (ในตัว Node 22.5+ ไม่ต้อง npm install)
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ใต้ pkg โฟลเดอร์ snapshot เขียนไม่ได้ ใช้โฟลเดอร์ข้าง exe แทน (เหมือน pondy-console)
const DATA_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DB_DIR = path.join(DATA_DIR, 'data');
const OUT_DIR = path.join(DATA_DIR, 'output');
fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DB_DIR, 'reels.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS clips (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  brief      TEXT NOT NULL DEFAULT '',   -- เนื้อหา/prompt ดิบที่ผู้ใช้ใส่
  script     TEXT NOT NULL DEFAULT '',   -- ข้อความบนจอ 1 บรรทัด = 1 ฉาก
  caption    TEXT NOT NULL DEFAULT '',
  hashtags   TEXT NOT NULL DEFAULT '',
  theme      TEXT NOT NULL DEFAULT 'dark',
  status     TEXT NOT NULL DEFAULT 'draft', -- draft | rendering | ready | failed | posted
  video_file TEXT,
  duration   REAL,
  error      TEXT,
  fb_url     TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  posted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_clips_status ON clips(status, updated_at);
`);

// migration: เสียงพากย์ (0/1) และเพลงพื้นหลัง ('none' | 'calm' | 'mystic' | 'upbeat' | 'file:ชื่อไฟล์')
const cols = db.prepare('PRAGMA table_info(clips)').all().map((c) => c.name);
if (!cols.includes('voice')) db.exec('ALTER TABLE clips ADD COLUMN voice INTEGER NOT NULL DEFAULT 0');
if (!cols.includes('music')) db.exec("ALTER TABLE clips ADD COLUMN music TEXT NOT NULL DEFAULT 'none'");
// prompt วิดีโอรายฉาก (JSON: [{prompt, note}]) ไว้คัดลอกไปให้ Meta AI สร้างคลิป
if (!cols.includes('video_prompts')) db.exec("ALTER TABLE clips ADD COLUMN video_prompts TEXT NOT NULL DEFAULT ''");
// prompt สร้างรูป (JSON: [{prompt, note}]) — อันแรกคือรูปปก ที่เหลือรายฉาก ไว้คัดลอกไปให้ Meta AI/ChatGPT สร้างรูป
if (!cols.includes('image_prompts')) db.exec("ALTER TABLE clips ADD COLUMN image_prompts TEXT NOT NULL DEFAULT ''");
// ภาพประกอบจากเว็บที่ผู้ใช้เลือก (JSON: [{file, credit, src}]) — ไฟล์เก็บใน data/clip-images/ ใช้เป็นพื้นหลังฉาก
if (!cols.includes('images')) db.exec("ALTER TABLE clips ADD COLUMN images TEXT NOT NULL DEFAULT ''");
// ป้ายสั้น ๆ บนคลิป เช่น "ตอนที่ 20" (ขึ้นมุมขวาบนทุกฉาก)
if (!cols.includes('badge')) db.exec("ALTER TABLE clips ADD COLUMN badge TEXT NOT NULL DEFAULT ''");
// แหล่งที่มาของข่าว (ชื่อ/ลิงก์) — แสดงในคลังและท้ายแคปชัน
if (!cols.includes('source')) db.exec("ALTER TABLE clips ADD COLUMN source TEXT NOT NULL DEFAULT ''");
// ฟีดข่าว RSS/Atom ที่ผู้ใช้เพิ่มไว้ (โหมดข่าว)
db.exec(`CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
)`);
// คลังสินค้าแอฟฟิลิเอต (ลิงก์ Shopee ฯลฯ ที่ผู้ใช้มี) — ให้ AI เลือกสินค้าที่เข้ากับคลิป
db.exec(`CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  sales INTEGER NOT NULL DEFAULT 0,   -- ยอดขาย/คะแนนความนิยมที่ผู้ใช้ใส่เอง (จากแดชบอร์ด Shopee Affiliate) ไว้จัดอันดับ "ขายดี"
  created_at INTEGER NOT NULL
)`);
// ความยาวเป้าหมายเป็นวินาที (0 = อัตโนมัติตามความยาวสคริปต์)
if (!cols.includes('target_sec')) db.exec('ALTER TABLE clips ADD COLUMN target_sec INTEGER NOT NULL DEFAULT 0');
// ชนิดของคลิป: 'quick' = สร้างเร็วหน้าหลัก (ข้อความบนจอ) | 'story' = ผลลัพธ์จากโปรเจกต์เรื่อง (รวมหลายช็อต) — คลิปเดิมทั้งหมดเป็น quick
if (!cols.includes('kind')) db.exec("ALTER TABLE clips ADD COLUMN kind TEXT NOT NULL DEFAULT 'quick'");

// เซิร์ฟเวอร์ดับกลางคันตอน render → ค้างสถานะ rendering ให้ตีเป็น failed
db.prepare("UPDATE clips SET status='failed', error='server restarted during render' WHERE status='rendering'").run();

const EDITABLE = ['title', 'brief', 'script', 'caption', 'hashtags', 'theme', 'voice', 'music', 'target_sec', 'video_prompts', 'image_prompts', 'images', 'badge', 'source', 'status', 'video_file', 'duration', 'error', 'fb_url', 'posted_at'];

// เรียงด้วย created_at (ไม่ใช่ updated_at) เพื่อให้แถวไม่กระโดดตอนแก้แคปชัน/โพลสถานะ
const SORTS = { new: 'created_at DESC, id DESC', old: 'created_at ASC, id ASC', title: 'title COLLATE NOCASE ASC, id ASC' };

// ค้นหา + กรองสถานะ + เรียง + แบ่งหน้า → { items, total } (total = จำนวนที่ตรงเงื่อนไขทั้งหมด)
function list({ status, q, kind, sort = 'new', limit = 24, offset = 0 } = {}) {
  const where = [], args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (kind) { where.push('kind = ?'); args.push(kind); }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(title LIKE ? ESCAPE '\\' OR caption LIKE ? ESCAPE '\\' OR hashtags LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM clips ${w}`).get(...args).n;
  const items = db.prepare(`SELECT * FROM clips ${w} ORDER BY ${SORTS[sort] || SORTS.new} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { items, total };
}

// จำนวนต่อสถานะ (ไว้โชว์ตัวเลขบนปุ่มกรอง)
function stats() {
  const out = { all: 0, draft: 0, rendering: 0, ready: 0, posted: 0, failed: 0 };
  for (const { status, n } of db.prepare('SELECT status, COUNT(*) AS n FROM clips GROUP BY status').all()) {
    out[status] = n;
    out.all += n;
  }
  return out;
}

function get(id) {
  return db.prepare('SELECT * FROM clips WHERE id = ?').get(id) || null;
}

function create({ title, brief = '', script = '', theme = 'dark', voice = 0, music = 'none', target_sec = 0, caption = '', hashtags = '', source = '', images = '', badge = '', kind = 'quick' }) {
  const now = Date.now();
  const r = db.prepare(
    'INSERT INTO clips (title, brief, script, theme, voice, music, target_sec, caption, hashtags, source, images, badge, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(title, brief, script, theme, voice, music, target_sec, caption, hashtags, source, images, badge, kind, now, now);
  return get(Number(r.lastInsertRowid));
}

function update(id, fields) {
  const keys = Object.keys(fields).filter((k) => EDITABLE.includes(k));
  if (!keys.length) return get(id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE clips SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => fields[k] ?? null), Date.now(), id);
  return get(id);
}

function remove(id) {
  db.prepare('DELETE FROM clips WHERE id = ?').run(id);
}

const listFeeds = () => db.prepare('SELECT * FROM feeds ORDER BY name COLLATE NOCASE').all();
const getFeed = (id) => db.prepare('SELECT * FROM feeds WHERE id = ?').get(id) || null;
const removeFeed = (id) => db.prepare('DELETE FROM feeds WHERE id = ?').run(id);
function addFeed(name, url) {
  const r = db.prepare('INSERT INTO feeds (name, url, created_at) VALUES (?,?,?)').run(name, url, Date.now());
  return getFeed(Number(r.lastInsertRowid));
}

// migration: แหล่งที่มา ('' = เพิ่มเอง, 'pondy:<serial>' = ดึงจากแอปบนมือถือ) และเวลาที่โพสต์ล่าสุด
const pcols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
if (!pcols.includes('src')) db.exec("ALTER TABLE products ADD COLUMN src TEXT NOT NULL DEFAULT ''");
if (!pcols.includes('last_posted')) db.exec('ALTER TABLE products ADD COLUMN last_posted INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS idx_products_url ON products(url)');

const PSORTS = { new: 'id DESC', sales: 'sales DESC, id DESC', posted: 'last_posted DESC, id DESC' };

// ค้นหา + เรียง + แบ่งหน้า → { items, total } (คลังอาจมีหลายหมื่นรายการ)
function listProducts({ q = '', sort = 'new', limit = 50, offset = 0 } = {}) {
  const order = PSORTS[sort] || PSORTS.new;
  let w = '';
  const args = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    w = "WHERE name LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\'";
    args.push(like, like, like);
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM products ${w}`).get(...args).n;
  const items = db.prepare(`SELECT * FROM products ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { items, total };
}

// ทั้งคลัง (เฉพาะฟิลด์ที่ใช้จับคู่/กันซ้ำ) — ไว้ให้ AI จับคู่สินค้ากับคลิป
const allProducts = () => db.prepare('SELECT id, name, url, tags, note, sales, last_posted FROM products').all();

// เพิ่มหลายรายการในทรานแซกชันเดียว ข้ามลิงก์ที่มีอยู่แล้ว → { added, duplicates }
function addProductsBulk(rows, src = '') {
  const have = new Set(db.prepare('SELECT url FROM products').all().map((r) => r.url));
  const ins = db.prepare('INSERT INTO products (name, url, tags, note, sales, src, last_posted, created_at) VALUES (?,?,?,?,?,?,?,?)');
  let added = 0, duplicates = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      if (have.has(r.url)) { duplicates++; continue; }
      ins.run(r.name, r.url, r.tags || '', r.note || '', r.sales || 0, src, r.last_posted || 0, Date.now());
      have.add(r.url); added++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { added, duplicates };
}
const getProduct = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id) || null;
function addProduct({ name, url, tags = '', note = '', sales = 0 }) {
  const r = db.prepare('INSERT INTO products (name, url, tags, note, sales, created_at) VALUES (?,?,?,?,?,?)').run(name, url, tags, note, sales, Date.now());
  return getProduct(Number(r.lastInsertRowid));
}
function updateProduct(id, f) {
  const keys = ['name', 'url', 'tags', 'note', 'sales'].filter((k) => f[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
  return getProduct(id);
}
const removeProduct = (id) => db.prepare('DELETE FROM products WHERE id = ?').run(id);
// ล้างสินค้าที่นำเข้าจากมือถือ (src ขึ้นต้น 'pondy:') ทั้งหมด → จำนวนที่ลบ — ไม่แตะสินค้าที่เพิ่มเองด้วยมือ
const clearImported = () => Number(db.prepare("DELETE FROM products WHERE src LIKE 'pondy:%'").run().changes);

const THUMB_DIR = path.join(OUT_DIR, 'thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });

module.exports = { handle: db, list, stats, SORTS, get, create, update, remove, listFeeds, getFeed, addFeed, removeFeed, listProducts, allProducts, addProductsBulk, getProduct, addProduct, updateProduct, removeProduct, clearImported, OUT_DIR, THUMB_DIR, DATA_DIR };
