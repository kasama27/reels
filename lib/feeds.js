// ดึงข่าวจากฟีด RSS/Atom ที่ผู้ใช้เพิ่มไว้ + อ่านเนื้อบทความ (หน้าเดียวที่ผู้ใช้เลือก) — ไม่มี dependency
// เซิร์ฟเวอร์เป็นคนยิงออกเน็ตตามลิงก์ที่ผู้ใช้ให้ จึงกันลิงก์เข้าเครือข่ายภายใน (SSRF) ทุกครั้งที่ตามลิงก์/redirect
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (compatible; ArnReels/1.0; personal news summarizer)';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

async function safeUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('ลิงก์ไม่ถูกต้อง'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('รองรับเฉพาะลิงก์ http/https');
  if (url.username || url.password) throw new Error('ไม่รองรับลิงก์ที่มีชื่อผู้ใช้/รหัสผ่าน');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error(`หาเซิร์ฟเวอร์ ${host} ไม่เจอ`); });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('ไม่อนุญาตลิงก์ที่ชี้ไปเครือข่ายภายใน');
  return url;
}

// อ่านข้อความจากลิงก์: ตาม redirect เองทีละทอด (เช็ก SSRF ทุกทอด) จำกัดขนาด/เวลา และถอดรหัสตาม charset
async function fetchText(raw, { max = 2_000_000, timeout = 15000 } = {}) {
  let url = await safeUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml,text/xml;q=0.9,*/*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await safeUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    if (!res.ok) throw new Error(`เว็บตอบกลับ ${res.status}`);
    const chunks = [];
    let size = 0;
    for await (const c of res.body) {
      size += c.length;
      if (size > max) break; // ตัดแค่ที่ต้องใช้ (ฟีด/บทความไม่ควรใหญ่กว่านี้)
      chunks.push(c);
    }
    const buf = Buffer.concat(chunks);
    const charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1]
      || buf.subarray(0, 1024).toString('latin1').match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
    let text;
    try { text = new TextDecoder(charset).decode(buf); } catch { text = buf.toString('utf8'); }
    return { text, url: url.href };
  }
  throw new Error('redirect มากเกินไป');
}

// ดาวน์โหลดไฟล์ไบนารี (รูป): ตาม redirect เอง เช็ก SSRF ทุกทอด จำกัดขนาด/เวลา ใส่ Referer เหมือนเบราว์เซอร์เปิดจากหน้านั้น (เว็บบางเจ้าบล็อกลิงก์รูปที่ไม่มี Referer)
async function fetchRaw(raw, { max = 8_000_000, timeout = 20000, referer = '' } = {}) {
  let url = await safeUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', ...(referer ? { referer } : {}) },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await safeUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    if (!res.ok) throw new Error(`เว็บตอบกลับ ${res.status}`);
    const chunks = [];
    let size = 0;
    for await (const c of res.body) {
      size += c.length;
      if (size > max) throw new Error('ไฟล์ใหญ่เกินไป');
      chunks.push(c);
    }
    return { buf: Buffer.concat(chunks), url: url.href };
  }
  throw new Error('redirect มากเกินไป');
}

// รูป jpeg/png/webp เท่านั้น ตรวจจากลายเซ็นไฟล์จริง (ไม่เชื่อ content-type / นามสกุล) — SVG/GIF/อื่น ๆ ไม่รับ
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

async function fetchImage(raw, referer = '') {
  const { buf } = await fetchRaw(raw, { referer });
  const kind = sniffImage(buf);
  if (!kind) throw new Error('ไฟล์นี้ไม่ใช่รูป jpeg/png/webp');
  return { buf, ...kind };
}

// รายการรูปในหน้าเว็บ: og:image / twitter:image ก่อน แล้วรูปในบทความ แล้วรูปอื่น — ตัดไอคอน/โลโก้/โฆษณา/รูปจิ๋วออกคร่าว ๆ
const BAD_IMG = /(logo|icon|sprite|avatar|favicon|pixel|spacer|blank|1x1|\/ads?\/|emoji|badge|placeholder|banner|promo|premium|subscribe|homedelivery|enews|appstore|googleplay|\/static\/img\/|\.svg|\.gif|\.ico)/i;
async function readImages(raw) {
  rejectSocial(raw);
  const { text: html, url: base } = await fetchText(raw, { max: 3_000_000 });
  const out = [], seen = new Set();
  const add = (src, alt = '', from = 'page') => { // from: meta (og:image ฯลฯ) | article (รูปในบทความ) | page (รูปอื่นในหน้า)
    if (!src || out.length >= 30) return;
    let u;
    try { u = new URL(decode(String(src).trim()), base); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || BAD_IMG.test(u.pathname + u.search) || seen.has(u.href)) return;
    seen.add(u.href);
    out.push({ url: u.href, alt: text(alt).slice(0, 120), from });
  };
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (/(property|name)=["'](og:image(:secure_url)?|twitter:image(:src)?)["']/i.test(tag)) add(tag.match(/content=["']([^"']+)["']/i)?.[1], '', 'meta');
  }
  add((html.match(/<link\b[^>]*rel=["']image_src["'][^>]*>/i) || [''])[0].match(/href=["']([^"']+)["']/i)?.[1], '', 'meta');
  const art = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || '';
  const imgs = (chunk, from) => {
    for (const tag of chunk.match(/<img\b[^>]*>/gi) || []) {
      const dim = (n) => Number(tag.match(new RegExp(`\\b${n}=["']?(\\d+)`, 'i'))?.[1] || 0);
      if ((dim('width') && dim('width') < 200) || (dim('height') && dim('height') < 150)) continue;
      const srcset = tag.match(/(?:data-)?srcset=["']([^"']+)["']/i)?.[1];
      const big = srcset ? srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop() : '';
      add(big || tag.match(/(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i)?.[1], tag.match(/alt=["']([^"']*)["']/i)?.[1], from);
    }
  };
  imgs(art, 'article');
  imgs(html, 'page');
  return { page: base, images: out };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const strip = (s) => decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// ในฟีดบางเจ้า description เป็น HTML ที่ถูก escape มาอีกชั้น (&lt;p&gt;) → decode แล้วลอกแท็กอีกรอบ
const text = (s) => strip(strip(s));

function pick(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m && m[1].trim()) return m[1];
  }
  return '';
}

function parseFeed(xml) {
  const head = xml.split(/<(?:item|entry)[\s>]/i)[0];
  const title = text(pick(head, ['title'])) || '';
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  const items = blocks.map((b) => {
    let link = text(pick(b, ['link']));
    if (!/^https?:/i.test(link)) { // Atom: <link href="..."/>
      const m = b.match(/<link[^>]*?href=["']([^"']+)["'][^>]*>/i);
      link = m ? decode(m[1]) : '';
    }
    const when = text(pick(b, ['pubDate', 'published', 'updated', 'dc:date']));
    const ts = Date.parse(when);
    return {
      title: text(pick(b, ['title'])),
      link,
      date: Number.isNaN(ts) ? null : ts,
      summary: text(pick(b, ['content:encoded', 'description', 'summary', 'content'])).slice(0, 2000),
    };
  }).filter((i) => i.title && /^https?:/i.test(i.link));
  items.sort((a, b) => (b.date || 0) - (a.date || 0));
  return { title, items: items.slice(0, 30) };
}

const isFeed = (xml) => /<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 5000));
const GUESS = ['/rss', '/feed', '/rss.xml', '/feed.xml', '/rss/news', '/feeds/rss'];

// หาลิงก์ฟีดจากหน้าเว็บ: <link rel="alternate" type="application/rss+xml"> ก่อน แล้วค่อยลองพาธยอดนิยม
function discoverFeeds(html, base) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) try { out.push(new URL(decode(href), base).href); } catch { /* ข้ามลิงก์เสีย */ }
  }
  const origin = new URL(base).origin;
  for (const p of GUESS) out.push(origin + p);
  return [...new Set(out)];
}

// อ่านฟีด — ถ้าลิงก์ที่ให้มาเป็นหน้าเว็บทั่วไป (เช่น หน้าแรก) จะหาฟีดของเว็บนั้นให้เอง; คืน url ของฟีดจริงมาด้วย
// โซเชียลต้องล็อกอินและบล็อกการดึงอัตโนมัติ → บอกทางออกแทนที่จะได้หน้าเปล่า
function rejectSocial(raw) {
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return; }
  if (/(^|\.)(facebook\.com|fb\.com|fb\.watch|instagram\.com|tiktok\.com|twitter\.com|x\.com)$/.test(host)) {
    throw new Error('ลิงก์โซเชียล (Facebook ฯลฯ) ดึงเนื้อหาไม่ได้ เพราะต้องล็อกอิน — ให้วางข้อความโพสต์ (หรือภาพแคปหน้าจอ) ในช่องเนื้อหาแทน หรือใช้ลิงก์ข่าว/RSS ของเว็บข่าวนั้น');
  }
}

async function readFeed(url) {
  rejectSocial(url);
  const { text: xml, url: finalUrl } = await fetchText(url, { max: 3_000_000 });
  if (isFeed(xml)) return { ...parseFeed(xml), url: finalUrl };
  for (const cand of discoverFeeds(xml, finalUrl).slice(0, 8)) {
    try {
      const r = await fetchText(cand, { max: 3_000_000, timeout: 8000 });
      if (isFeed(r.text)) return { ...parseFeed(r.text), url: r.url };
    } catch { /* ลองตัวถัดไป */ }
  }
  throw new Error('ลิงก์นี้ไม่ใช่ฟีด RSS/Atom และหาฟีดของเว็บนี้ไม่เจอ — ลองหาลิงก์ RSS ของเว็บแล้ววางแทน');
}

// ข้อความบทความ: เอาย่อหน้า <p> ที่ยาวพอ (ภายใน <article> ถ้ามี) — แบบง่าย ใช้ได้กับเว็บข่าวส่วนใหญ่
async function readArticle(url) {
  rejectSocial(url);
  const { text: html } = await fetchText(url, { max: 3_000_000 });
  const title = text(html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  let body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|nav|header|footer|aside|form|svg)[\s\S]*?<\/\1>/gi, ' ');
  const art = body.match(/<article[\s\S]*?<\/article>/i);
  if (art) body = art[0];
  const paras = (body.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map(text).filter((p) => p.length >= 40);
  return { title, text: paras.join('\n').slice(0, 8000) };
}

module.exports = { readFeed, readArticle, safeUrl, parseFeed, readImages, fetchImage };
