// เรียกโปรแกรม claude (Claude Code) แบบ headless ผ่านบัญชีที่ล็อกอินไว้ — ไม่ต้องมีคีย์ API
// ใช้โควตาของแผน Claude ของผู้ใช้เอง ทำงานในโฟลเดอร์ว่าง ปิดเครื่องมือทั้งหมด (ตอบเป็นข้อความอย่างเดียว)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');
const ctx = require('./ctx');

const WORK = path.join(os.tmpdir(), 'arn-reels-claude'); // cwd ว่าง กัน CLAUDE.md/โปรเจกต์อื่นมาปนคำตอบ
fs.mkdirSync(WORK, { recursive: true });

const ver = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
const newestFirst = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (y[i] || 0) - (x[i] || 0); return 0; };

// หา claude.exe: ค่าใน config → ตัวที่แอป Claude Desktop ติดมา (เวอร์ชันใหม่สุด) → 'claude' ใน PATH
// ตำแหน่งที่แอป Claude Desktop เก็บ claude-code เปลี่ยนได้ตามรุ่น/วิธีติดตั้ง (รุ่นแพ็กเกจ Store อยู่ใต้ %LOCALAPPDATA%\\Claude-Data\\<แพ็กเกจ>\\) จึงไล่หาหลายที่
function claudeBases() {
  const bases = [path.join(process.env.APPDATA || '', 'Claude', 'claude-code')];
  const local = process.env.LOCALAPPDATA || '';
  try {
    for (const d of fs.readdirSync(path.join(local, 'Claude-Data'))) bases.push(path.join(local, 'Claude-Data', d, 'claude-code'));
  } catch { /* ไม่มีโฟลเดอร์ */ }
  bases.push(path.join(local, 'Claude', 'claude-code'));
  return bases;
}

function findClaude() {
  if (cfg.claudePath && fs.existsSync(cfg.claudePath)) return cfg.claudePath;
  const found = [];
  for (const base of claudeBases()) {
    try {
      for (const v of fs.readdirSync(base)) {
        for (const d of fs.readdirSync(path.join(base, v))) {
          const exe = path.join(base, v, d, 'claude.exe');
          if (fs.existsSync(exe)) found.push({ v, exe });
        }
      }
    } catch { /* ไม่มีโฟลเดอร์นี้ */ }
  }
  found.sort((x, y) => newestFirst(x.v, y.v));
  return found.length ? found[0].exe : 'claude';
}

const CANCELLED = ctx.CANCELLED;

function run(args, { input, timeout = 150000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error(CANCELLED));
    const p = spawn(findClaude(), args, { cwd: WORK, windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const timer = setTimeout(() => { p.kill(); reject(new Error('Claude Code ตอบช้าเกินไป (หมดเวลา)')); }, timeout);
    const onAbort = () => { clearTimeout(timer); p.kill(); reject(new Error(CANCELLED)); }; // ผู้ใช้กดหยุด: ฆ่าโปรเซสทันที ไม่เสียโควตาต่อ
    signal?.addEventListener('abort', onAbort, { once: true });
    p.on('error', (e) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(new Error(e.code === 'ENOENT' ? 'ไม่พบโปรแกรม claude (Claude Code) ในเครื่อง' : e.message)); });
    p.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve({ code, out, err }); });
    p.stdin.on('error', () => {}); // โปรเซสปิดก่อนอ่านครบ ไม่ต้องทำให้เซิร์ฟเวอร์ล้ม
    p.stdin.end(input ?? '');
  });
}

let cache = null;
// ข้อมูลสถานะสำหรับหน้าตั้งค่า: เจอโปรแกรมไหม / ล็อกอินหรือยัง / คำสั่งล็อกอิน (แคช 20 วิ)
async function info(force = false) {
  if (!force && cache && Date.now() - cache.t < 20000) return cache.v;
  const exe = findClaude();
  const v = { found: false, loggedIn: false, loginCommand: `"${exe}" auth login` };
  try {
    v.found = (await run(['--version'], { timeout: 20000 })).code === 0;
    if (v.found) v.loggedIn = !!JSON.parse((await run(['auth', 'status'], { timeout: 20000 })).out).loggedIn;
  } catch { /* ถือว่าไม่พร้อม */ }
  cache = { t: Date.now(), v };
  return v;
}

const NOT_LOGGED_IN = 'ยังไม่ได้ล็อกอิน Claude Code — เปิด “ตั้งค่า” แล้วทำตามขั้นตอนล็อกอิน (หรือรัน claude auth login)';

let queue = Promise.resolve(); // ทีละงาน — โปรเซส claude หนัก ไม่ควรเปิดซ้อนหลายตัว
function ask(system, content, timeout, opts = {}) {
  const signal = ctx.getStore()?.signal; // ยกเลิกได้ทั้งตอนรอคิวและตอนรัน
  const job = queue.then(() => doAsk(system, content, timeout, { ...opts, signal }));
  queue = job.catch(() => {});
  return job;
}

// web: เปิดเฉพาะค้นเว็บ/เปิดอ่านหน้าเว็บ (ไม่มีเครื่องมืออ่านเขียนไฟล์หรือรันคำสั่ง)
const WEB_TOOLS = ['--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch'];

async function doAsk(system, content, timeout, { web = false, signal } = {}) {
  if (signal?.aborted) throw new Error(CANCELLED); // ถูกยกเลิกระหว่างรอคิว ไม่ต้องเริ่มรัน
  const base = ['-p', '--system-prompt', system, ...(web ? WEB_TOOLS : ['--tools=']), '--no-session-persistence', '--setting-sources=project', '--disable-slash-commands', '--strict-mcp-config'];
  let r;
  if (typeof content === 'string') {
    r = await run([...base, '--output-format', 'json'], { input: content, timeout, signal });
  } else { // มีรูป: ส่งเป็นข้อความ stream-json ที่มี image block
    const msg = { type: 'user', message: { role: 'user', content } };
    r = await run([...base, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], { input: `${JSON.stringify(msg)}\n`, timeout, signal });
  }
  let result = null;
  for (const line of r.out.split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o.type === 'result') result = o; } catch { /* บรรทัดที่ไม่ใช่ JSON */ }
  }
  if (!result) throw new Error(`Claude Code ไม่ตอบกลับ (exit ${r.code}) ${r.err.trim().split('\n').pop() || ''}`.trim());
  if (result.is_error) {
    cache = null;
    throw new Error(/log\s?in/i.test(String(result.result)) ? NOT_LOGGED_IN : String(result.result).slice(0, 300));
  }
  return String(result.result || '');
}

// ล็อกอินด้วยบัญชี Claude (แผนสมาชิก): `claude auth login` เปิดเบราว์เซอร์ให้เองแล้วรอผู้ใช้กดอนุญาต
// ผู้ใช้ทำขั้นตอนล็อกอินเองในเบราว์เซอร์ — แอปแค่สั่งเริ่มและคอยดูผล (ไม่เห็นรหัสผ่าน)
const login = { proc: null, url: '', output: '', startedAt: 0, finished: false };

function loginState() {
  return { running: !!login.proc, url: login.url, finished: login.finished, startedAt: login.startedAt };
}

function startLogin() {
  if (login.proc) return loginState(); // กำลังล็อกอินอยู่ ไม่เปิดซ้อน
  Object.assign(login, { url: '', output: '', startedAt: Date.now(), finished: false });
  const p = spawn(findClaude(), ['auth', 'login', '--claudeai'], { cwd: WORK, windowsHide: true });
  login.proc = p;
  const onData = (d) => {
    login.output = (login.output + d).slice(-4000);
    // เผื่อเบราว์เซอร์ไม่เด้งเอง: จับลิงก์ล็อกอินที่โปรแกรมพิมพ์ออกมาให้ผู้ใช้คลิกเอง
    const m = login.output.match(/https:\/\/[^\s"'<>]+/);
    if (m && !login.url) login.url = m[0];
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.stdin.on('error', () => {});
  const timer = setTimeout(() => p.kill(), 10 * 60 * 1000); // รอไม่เกิน 10 นาที
  const done = () => { clearTimeout(timer); login.proc = null; login.finished = true; cache = null; };
  p.on('error', () => done());
  p.on('close', () => done());
  return loginState();
}

module.exports = { ask, info, findClaude, startLogin, loginState };
