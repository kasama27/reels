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
// สไตล์เสียงพากย์ (ชุดเดียวกับโปรเจกต์เรื่อง/ซีรีส์: story.NARR_TONES) — น้ำเสียงมีผลเฉพาะ Gemini TTS
// คลิปสินค้า (Meta AI): สินค้าต้นทาง, วิดีโอดิบจาก Meta AI (ก่อนใส่ข้อความ), ข้อความคอมเมนต์แรก (มีลิงก์แอฟฟิลิเอต)
if (!cols.includes('product_id')) db.exec('ALTER TABLE clips ADD COLUMN product_id INTEGER NOT NULL DEFAULT 0');
if (!cols.includes('raw_video')) db.exec("ALTER TABLE clips ADD COLUMN raw_video TEXT NOT NULL DEFAULT ''");
if (!cols.includes('fb_comment')) db.exec("ALTER TABLE clips ADD COLUMN fb_comment TEXT NOT NULL DEFAULT ''");
if (!cols.includes('narr_tone')) db.exec("ALTER TABLE clips ADD COLUMN narr_tone TEXT NOT NULL DEFAULT 'plain'");
// โพสต์รูป (kind = 'photo'): ไฟล์รูปการ์ดที่ทำเสร็จแล้วใน output/ (badge = แบบการ์ด news | ask | product)
if (!cols.includes('photo_file')) db.exec("ALTER TABLE clips ADD COLUMN photo_file TEXT NOT NULL DEFAULT ''");

// เซิร์ฟเวอร์ดับกลางคันตอน render → ค้างสถานะ rendering ให้ตีเป็น failed
db.prepare("UPDATE clips SET status='failed', error='server restarted during render' WHERE status='rendering'").run();

const EDITABLE = ['title', 'brief', 'script', 'caption', 'hashtags', 'theme', 'voice', 'narr_tone', 'music', 'target_sec', 'video_prompts', 'image_prompts', 'images', 'badge', 'source', 'product_id', 'raw_video', 'fb_comment', 'status', 'video_file', 'duration', 'error', 'fb_url', 'posted_at', 'photo_file'];

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

function create({ title, brief = '', script = '', theme = 'dark', voice = 0, narr_tone = 'plain', music = 'none', target_sec = 0, caption = '', hashtags = '', source = '', images = '', badge = '', kind = 'quick', product_id = 0, fb_comment = '' }) {
  const now = Date.now();
  const r = db.prepare(
    'INSERT INTO clips (title, brief, script, theme, voice, narr_tone, music, target_sec, caption, hashtags, source, images, badge, kind, product_id, fb_comment, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(title, brief, script, theme, voice, narr_tone, music, target_sec, caption, hashtags, source, images, badge, kind, product_id, fb_comment, now, now);
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
// คลิปสินค้า: แบรนด์ ชื่อเรียกในคลิป (สั้น) คำอ่าน และรูปสินค้าจริง (ไฟล์ใน data/clip-images)
for (const [c, ddl] of [['brand', "TEXT NOT NULL DEFAULT ''"], ['clip_name', "TEXT NOT NULL DEFAULT ''"], ['say', "TEXT NOT NULL DEFAULT ''"], ['image', "TEXT NOT NULL DEFAULT ''"], ['item_id', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!pcols.includes(c)) db.exec(`ALTER TABLE products ADD COLUMN ${c} ${ddl}`);
}
if (!pcols.includes('last_posted')) db.exec('ALTER TABLE products ADD COLUMN last_posted INTEGER NOT NULL DEFAULT 0');
// ร้านค้า (ชื่อร้าน + รหัสร้าน Shopee) — ไว้เลือก/กรองสินค้าตามร้าน · สินค้าเก่าที่มี "ร้าน xxx" ในโน้ต ดึงชื่อร้านมาเติมให้
if (!pcols.includes('shop')) {
  db.exec("ALTER TABLE products ADD COLUMN shop TEXT NOT NULL DEFAULT ''");
  db.exec("ALTER TABLE products ADD COLUMN shop_id TEXT NOT NULL DEFAULT ''");
  const fix = db.prepare('UPDATE products SET shop = ? WHERE id = ?');
  for (const r of db.prepare("SELECT id, note FROM products WHERE note LIKE '%ร้าน %'").all()) {
    const m = /ร้าน (.+?)(?: · |$)/.exec(r.note);
    if (m) fix.run(m[1].trim().slice(0, 80), r.id);
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop)');
db.exec('CREATE INDEX IF NOT EXISTS idx_products_url ON products(url)');
db.exec('CREATE INDEX IF NOT EXISTS idx_products_item ON products(item_id)');

const PSORTS = { new: 'id DESC', sales: 'sales DESC, id DESC', posted: 'last_posted DESC, id DESC' };

// ค้นหา + เรียง + แบ่งหน้า → { items, total } (คลังอาจมีหลายหมื่นรายการ)
function listProducts({ q = '', sort = 'new', limit = 50, offset = 0, shop = '' } = {}) {
  const order = PSORTS[sort] || PSORTS.new;
  const where = [], args = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(name LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' OR shop LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  if (shop) { where.push('shop = ?'); args.push(shop); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
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
// ร้านทั้งหมดในคลัง + จำนวนสินค้า (มากไปน้อย)
const productShops = () => db.prepare("SELECT shop, MAX(shop_id) AS shop_id, COUNT(*) AS n FROM products WHERE shop != '' GROUP BY shop ORDER BY n DESC, shop").all();
const getProduct = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id) || null;
function addProduct({ name, url, tags = '', note = '', sales = 0, brand = '', clip_name = '', say = '', image = '', item_id = '', src = '', shop = '', shop_id = '' }) {
  const r = db.prepare('INSERT INTO products (name, url, tags, note, sales, brand, clip_name, say, image, item_id, src, shop, shop_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(name, url, tags, note, sales, brand, clip_name, say, image, item_id, src, shop, shop_id, Date.now());
  return getProduct(Number(r.lastInsertRowid));
}
function updateProduct(id, f) {
  const keys = ['name', 'url', 'tags', 'note', 'sales', 'brand', 'clip_name', 'say', 'image', 'shop'].filter((k) => f[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
  return getProduct(id);
}
const removeProduct = (id) => db.prepare('DELETE FROM products WHERE id = ?').run(id);
// ล้างสินค้าที่นำเข้าจากมือถือ (src ขึ้นต้น 'pondy:') ทั้งหมด → จำนวนที่ลบ — ไม่แตะสินค้าที่เพิ่มเองด้วยมือ
// รูปสินค้าที่ยังมีสินค้าใช้อยู่ (กันลบไฟล์ตอนลบคลิปที่บังเอิญใช้รูปไฟล์เดียวกัน)
const productImages = () => new Set(db.prepare("SELECT image FROM products WHERE image != ''").all().map((r) => r.image));
// item id ของ Shopee ที่มีในคลังแล้ว (กันเก็บสินค้าซ้ำตอนหาจากเว็บแอฟฟิลิเอต)
function knownItems(ids) {
  if (!ids.length) return new Set();
  const q = db.prepare(`SELECT item_id FROM products WHERE item_id IN (${ids.map(() => '?').join(',')})`);
  return new Set(q.all(...ids).map((r) => r.item_id));
}
const productByItem = (id) => db.prepare('SELECT * FROM products WHERE item_id = ?').get(id) || null;
const clearImported = () => Number(db.prepare("DELETE FROM products WHERE src LIKE 'pondy:%'").run().changes);

const THUMB_DIR = path.join(OUT_DIR, 'thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });

module.exports = { handle: db, list, stats, SORTS, get, create, update, remove, listFeeds, getFeed, addFeed, removeFeed, listProducts, productShops, allProducts, addProductsBulk, getProduct, addProduct, updateProduct, removeProduct, clearImported, productImages, knownItems, productByItem, OUT_DIR, THUMB_DIR, DATA_DIR };
