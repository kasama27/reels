// ดึงรายการสินค้าที่เคยลงคลิปแล้วจากแอป Pondy บนมือถือ (แอป com.affiliatemobile.spike) ผ่าน adb — อ่านอย่างเดียว
// แอปเก็บใน pipeline.db (ตาราง jobs: productName, affiliateLink, keyword, postedAt, state) แอปเป็น debug build จึงอ่านด้วย run-as ได้
// เราคัดลอกไฟล์ฐานข้อมูล (+ WAL) มาไว้ในโฟลเดอร์ชั่วคราวแล้วอ่านจากสำเนา ไม่แตะไฟล์บนมือถือ
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const PKG = 'com.affiliatemobile.spike';
const TMP = path.join(os.tmpdir(), 'arn-reels-pondy');
fs.mkdirSync(TMP, { recursive: true });
const SERIAL = /^[A-Za-z0-9._:-]{4,64}$/;

function run(cmd, args, { timeout = 30000, outFile } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '', out = '';
    const sink = outFile ? fs.createWriteStream(outFile) : null;
    if (sink) p.stdout.pipe(sink); else p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
    const timer = setTimeout(() => { p.kill(); reject(new Error('adb ตอบช้าเกินไป (หมดเวลา)')); }, timeout);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (sink) sink.end(() => resolve({ out, err, code })); else resolve({ out, err, code });
    });
  });
}

let adbExe = null;
// หา adb: config.adbPath → PATH → ตำแหน่งที่พบบ่อย (server อาจไม่ได้รับ PATH เหมือนเทอร์มินัล)
async function findAdb() {
  if (adbExe) return adbExe;
  const cands = [cfg.adbPath, 'adb',
    path.join(process.env.USERPROFILE || '', 'platform-tools-dl', 'platform-tools', 'adb.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe')].filter(Boolean);
  for (const c of cands) {
    if (c !== 'adb' && !fs.existsSync(c)) continue;
    try { if ((await run(c, ['version'], { timeout: 10000 })).code === 0) return (adbExe = c); } catch { /* ลองตัวถัดไป */ }
  }
  throw new Error('ไม่พบ adb ในเครื่อง — ติดตั้ง Android platform-tools หรือใส่ "adbPath" ใน config.json');
}

const adb = async (args, opts) => run(await findAdb(), args, opts);

// มือถือที่ต่ออยู่ + มีแอป Pondy + อ่านฐานข้อมูลได้ไหม
async function devices() {
  const { out } = await adb(['devices', '-l']);
  const list = [];
  for (const line of out.split('\n').slice(1)) {
    const m = line.trim().match(/^(\S+)\s+(\S+)(.*)$/);
    if (!m) continue;
    const [, serial, state, rest] = m;
    const d = { serial, state, model: (rest.match(/model:(\S+)/) || [])[1] || '', hasApp: false, readable: false };
    if (state === 'device' && SERIAL.test(serial)) {
      d.hasApp = (await adb(['-s', serial, 'shell', 'pm', 'list', 'packages', PKG])).out.includes(PKG);
      if (d.hasApp) d.readable = (await adb(['-s', serial, 'shell', 'run-as', PKG, 'ls', 'databases'])).out.includes('pipeline.db');
      if (d.readable) Object.assign(d, await summary(serial).catch(() => ({}))); // ช่วยแยกว่าเครื่องไหนคือเครื่องไหน
    }
    list.push(d);
  }
  return list;
}

const cache = new Map(); // serial -> { t, file }

async function pull(serial, force = false) {
  if (!SERIAL.test(serial)) throw new Error('serial ไม่ถูกต้อง');
  const hit = cache.get(serial);
  if (!force && hit && Date.now() - hit.t < 5 * 60 * 1000 && fs.existsSync(hit.file)) return hit.file;
  const dir = path.join(TMP, serial.replace(/[^\w.-]/g, '_'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'pipeline.db');
  for (const f of ['pipeline.db', 'pipeline.db-wal']) { // WAL มีข้อมูลล่าสุดที่ยังไม่ถูกรวมเข้าไฟล์หลัก
    await adb(['-s', serial, 'exec-out', 'run-as', PKG, 'cat', `databases/${f}`], { outFile: path.join(dir, f), timeout: 180000 });
  }
  const head = Buffer.alloc(15);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 15, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3') throw new Error('อ่านฐานข้อมูลจากมือถือไม่สำเร็จ (ไม่ใช่ไฟล์ SQLite) — เช็กว่ามือถือต่ออยู่และเปิดแอป Pondy ได้');
  cache.set(serial, { t: Date.now(), file });
  return file;
}

// สรุปต่อเครื่อง: จำนวนที่โพสต์แล้ว + คีย์เวิร์ด/เวลาของงานล่าสุด (ไว้โชว์ให้เลือกเครื่องถูก)
async function summary(serial) {
  const db = new DatabaseSync(await pull(serial));
  try {
    const posted = db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE postedAt IS NOT NULL').get().n;
    const last = db.prepare('SELECT keyword, postedAt FROM jobs WHERE postedAt IS NOT NULL ORDER BY postedAt DESC LIMIT 1').get();
    return { posted, lastKeyword: last?.keyword || '', lastPostedAt: last?.postedAt || 0 };
  } finally { db.close(); }
}

// สินค้าที่ลงคลิปแล้ว (ไม่ซ้ำลิงก์) ล่าสุดก่อน: { total, rows:[{name,url,keyword,last_posted,uses}] }
// opts: q (ค้นชื่อ/คีย์เวิร์ด), days (โพสต์ภายในกี่วัน, 0 = ทั้งหมด), limit
// ชนิดลิงก์: 'short' = ลิงก์สั้นของ Shopee (s.shopee.* / shope.ee — มักเป็นลิงก์แอฟฟิลิเอตที่สร้างจากบัญชีผู้ใช้) | 'plain' = ลิงก์สินค้าธรรมดา ไม่มีตัวติดตามแอฟฟิลิเอต
const SHORT_SQL = "(affiliateLink LIKE 'https://s.shopee.%' OR affiliateLink LIKE 'https://shope.ee/%')";
function linkKind(url) {
  try {
    const u = new URL(url);
    if (/^(s\.shopee\.|shope\.ee$)/i.test(u.hostname)) return 'short';
    if ([...u.searchParams.keys()].some((k) => /^(utm_source|af_|affiliate)/i.test(k))) return 'tracked';
  } catch { /* ไม่ใช่ URL */ }
  return 'plain';
}

async function readProducts(serial, { q = '', days = 0, limit = 300, shortOnly = false } = {}, retry = true) {
  const file = await pull(serial, !retry);
  let db;
  try {
    db = new DatabaseSync(file);
    const where = ["state = 'DONE'", 'postedAt IS NOT NULL', "affiliateLink IS NOT NULL AND affiliateLink <> ''", "productName IS NOT NULL AND productName <> ''"];
    const args = [];
    if (days > 0) { where.push('postedAt >= ?'); args.push(Date.now() - days * 86400000); }
    if (shortOnly) where.push(SHORT_SQL);
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(productName LIKE ? ESCAPE '\\' OR keyword LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    const w = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(DISTINCT affiliateLink) AS n FROM jobs WHERE ${w}`).get(...args).n;
    const rows = db.prepare(
      `SELECT productName AS name, affiliateLink AS url, keyword, MAX(postedAt) AS last_posted, COUNT(*) AS uses
       FROM jobs WHERE ${w} GROUP BY affiliateLink ORDER BY last_posted DESC LIMIT ?`
    ).all(...args, Math.min(Math.max(1, limit), 100000));
    return { total, rows };
  } catch (e) {
    if (retry && /malformed|corrupt|not a database/i.test(e.message)) return readProducts(serial, { q, days, limit }, false); // คัดลอกตอนแอปกำลังเขียน → ดึงใหม่ 1 ครั้ง
    throw e;
  } finally {
    try { db?.close(); } catch { /* ปิดไม่ได้ก็ปล่อย */ }
  }
}

module.exports = { devices, readProducts, pull, linkKind };
