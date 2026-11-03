// แผง "Arn Reels · หาสินค้า" บน affiliate.shopee.co.th (ใช้บัญชีแอฟฟิลิเอตที่คุณล็อกอินไว้ใน Chrome)
//  - เรียนรู้รูปแบบ "คำขอค้นสินค้า" จากการค้นของคุณในหน้า ข้อเสนอผลิตภัณฑ์ 1 ครั้ง (shopee-hook.js แอบดูคำตอบ API)
//  - จากนั้นพิมพ์คีย์เวิร์ดในแผง → แผงยิงคำขอแบบเดียวกัน (เปลี่ยนคีย์เวิร์ด/หน้า) → แสดงสินค้าให้ติ๊ก
//  - ขอลิงก์แอฟฟิลิเอต (คำขอเดียวกับปุ่ม "เอา ลิงก์" ของเว็บ — วิธีเดียวกับแอป Pondy) → ส่งเข้าคลังสินค้า Arn Reels (+ เข้าคิวคลิปสินค้า)
// ไม่กดปุ่มของเว็บแทนคุณ ไม่อ่านข้อมูลบัญชี/รายได้ ไม่ส่งข้อมูลไปที่อื่นนอกจาก Arn Reels ในเครื่องนี้
(() => {
  if (window.__arnShpPanel) return;
  window.__arnShpPanel = true;
  const TAG = 'arn-shp';

  const send = (type, extra = {}) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...extra }, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (r && r.ok) resolve(r.data); else reject(new Error((r && r.error) || 'ไม่มีคำตอบจากส่วนเสริม'));
    });
  });

  const st = {
    open: true, tpl: null, caps: [], items: [], picked: new Set(), known: new Set(), kw: '', count: 20, priceMin: 0,
    skipKnown: true, queue: true, msg: '', bad: false, busy: false, diag: '', lastList: null,
    blocked: '', page: 1, sig: '', pages: {}, gqlMute: 0, // เรียนจาก Pondy: blocked = เว็บขอยืนยันว่าไม่ใช่บอต · page/sig = หน้าปัจจุบัน + ลายเซ็นรายการ (5 id แรก) · pages = หน้าล่าสุดต่อคีย์เวิร์ด
    mode: 'kw', shops: [], shop: null, shopSort: 2, // ค้นร้านค้า: mode 'shop' · shops = ผลค้นร้าน · shop = ร้านที่เลือก · shopSort 2 = ขายดี / 5 = ค่าคอมสูง
  };

  // ---------- กันโดนมองว่าเป็นบอต (เรียนจาก Pondy) ----------
  // จังหวะต้องไม่คงที่: ทุกขั้นรอ ms + สุ่ม 0–50% (Shopee ติดป้าย crawler_item เมื่อจังหวะสม่ำเสมอแบบเครื่องจักร)
  const gate = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * ms * 0.5));
  const normKw = (k) => String(k || '').toLowerCase().replace(/\s+/g, ' ').trim();
  // หน้า CAPTCHA / ข้อความยืนยันว่าไม่ใช่บอต ในหน้า (ตรวจทุก 3 วิ) — แผงไม่แก้ CAPTCHA ให้ ต้องให้คนแก้เอง
  const CAPTCHA_RE = /captcha|ยืนยันว่าคุณ|ไม่ใช่โปรแกรม|ไม่ใช่บอท|เลื่อนเพื่อ|unusual traffic|are you a robot|puzzle|ปริศนา/i;
  function captchaOnPage() {
    if (/\/verify\/(captcha|traffic)/.test(location.pathname)) return 'หน้า /verify/captcha';
    const el = document.querySelector('iframe[src*=captcha], [class*=captcha], [id*=captcha], [class*=verify-slider]');
    if (el && !host.contains(el) && isVisible(el)) return 'กล่อง CAPTCHA ในหน้า';
    return '';
  }
  function setBlocked(why) {
    if (st.blocked) return;
    st.blocked = why; st.busy = false;
    try { chrome.storage.local.set({ shpBlockedAt: Date.now() }); } catch { /* ไม่เป็นไร */ }
    setMsg('', false);
  }
  setInterval(() => { const w = captchaOnPage(); if (w) setBlocked(w); }, 3000);

  // ---------- คุยกับ shopee-hook.js (โลกของหน้าเว็บ) ----------
  let seq = 0;
  const waiting = new Map();
  function pageFetch(req) {
    const id = `r${Date.now()}_${++seq}`;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { waiting.delete(id); reject(new Error('เว็บไม่ตอบ (หมดเวลา)')); }, 30000);
      waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
      window.postMessage({ tag: TAG, dir: 'down', id, ...req }, location.origin);
    });
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.tag !== TAG || m.dir !== 'up') return;
    if (m.kind === 'reply') { const cb = waiting.get(m.id); if (cb) { waiting.delete(m.id); cb(m); } return; }
    if (m.kind === 'cap') onCapture(m);
  });

  // ลิงก์ยาวที่เว็บแนบมากับสินค้า = ลิงก์แอฟฟิลิเอตของบัญชีนี้ (shopee.co.th/universal-link/… utm_medium=affiliates utm_source=an_<รหัส>) — ตรวจกับเว็บจริงแล้ว 31 ต.ค.
  function affLink(u) {
    try { const x = new URL(String(u)); return x.hostname === 'shopee.co.th' && x.searchParams.get('utm_medium') === 'affiliates' && /^an_\d+$/.test(x.searchParams.get('utm_source') || '') ? x.href : ''; } catch { return ''; }
  }

  // ---------- อ่านสินค้าจาก JSON (โครงสร้างจริงของเว็บไม่แน่นอน จึงเดินหาวัตถุที่ "ดูเหมือนสินค้า") ----------
  const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
  const deepPick = (o, keys, depth = 2) => {
    const v = pick(o, keys);
    if (v !== undefined || depth <= 0) return v;
    for (const x of Object.values(o)) if (x && typeof x === 'object' && !Array.isArray(x)) { const w = deepPick(x, keys, depth - 1); if (w !== undefined) return w; }
    return undefined;
  };
  const imgUrl = (v) => {
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === 'object') v = v.url || v.image || v.hash;
    v = String(v || '').trim();
    if (!v) return '';
    if (/^https?:\/\//.test(v)) return v.replace(/_tn(?=(\.[a-z0-9]+)?([?#]|$))/i, '');
    if (/^[\w-]{16,}$/.test(v)) return `https://down-th.img.susercontent.com/file/${v}`;
    return '';
  };
  const money = (v) => {
    let n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
    if (!(n > 0)) return '';
    if (n >= 100000 && Number.isInteger(n)) n /= 100000; // ราคาของ Shopee มักคูณ 100000
    return n.toLocaleString('th-TH', { maximumFractionDigits: 2 });
  };
  const pct = (v) => {
    if (v === undefined || v === null || v === '') return '';
    const s = String(v);
    if (/%/.test(s)) return s.replace(/\s+/g, '');
    let n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n > 1000) n /= 100000; else if (n < 1) n *= 100; // 0.12 = 12% · 1200000 = 12%
    return `${Math.round(n * 10) / 10}%`;
  };
  function parseItems(json) {
    const out = new Map();
    const walk = (node, depth) => {
      if (!node || depth > 9) return;
      if (Array.isArray(node)) { node.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof node !== 'object') return;
      const id = pick(node, ['item_id', 'itemid', 'itemId', 'item_id_str']);
      const name = deepPick(node, ['name', 'item_name', 'product_name', 'productName', 'title'], 1);
      if (id && name && typeof name === 'string' && /^\d{4,20}$/.test(String(id))) {
        const key = String(id);
        if (!out.has(key)) {
          const prefer = ['seller_commission_rate', 'default_commission_rate', 'commission_rate', 'commissionRate'].find((k) => node[k] !== undefined && node[k] !== '' && !/^0(\.0+)?%?$/.test(String(node[k])));
          const commissionKey = prefer || Object.keys(node).find((k) => /commission/i.test(k) && /rate|pct|percent/i.test(k) && !/^0(\.0+)?%?$/.test(String(node[k])));
          out.set(key, {
            item_id: key,
            shop_id: String(deepPick(node, ['shop_id', 'shopid', 'shopId']) ?? ''),
            name: name.replace(/\s+/g, ' ').trim(),
            image_url: imgUrl(deepPick(node, ['image', 'image_url', 'imageUrl', 'images', 'item_image', 'cover', 'img'])),
            price: money(deepPick(node, ['price', 'price_min', 'priceMin', 'item_price', 'min_price'])),
            commission: pct(commissionKey ? node[commissionKey] : deepPick(node, ['commission_rate', 'commissionRate', 'seller_commission_rate', 'default_commission_rate', 'commission'])),
            sales: Number(deepPick(node, ['sold', 'historical_sold', 'sales', 'sold_count', 'sold_cnt']) || 0) || 0,
            shop: String(deepPick(node, ['shop_name', 'shopName']) || ''),
            aff_url: affLink(node.long_link || node.longLink || ''),
          });
        }
        return;
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
    };
    walk(json, 0);
    return [...out.values()];
  }

  // ---------- เรียนรู้คำขอค้นหา จากคำขอจริงของหน้า ----------
  const KW_KEY = /^(key_?word|keyword|query|q|search(_?(key|text|word))?|kw)$/i;
  const PAGE_KEY = /^(page(_?(num|no|index))?|offset|page_offset|pageOffset|cursor)$/i;
  function findKeyPath(obj, re, path = []) {
    if (!obj || typeof obj !== 'object') return null;
    for (const [k, v] of Object.entries(obj)) {
      if (re.test(k) && (typeof v === 'string' || typeof v === 'number')) return [...path, k];
      if (v && typeof v === 'object') { const r = findKeyPath(v, re, [...path, k]); if (r) return r; }
    }
    return null;
  }
  const setPath = (obj, p, v) => { let o = obj; for (let i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = v; };
  const getPath = (obj, p) => p.reduce((o, k) => (o == null ? o : o[k]), obj);
  function learn(cap) {
    const u = new URL(cap.url);
    let kw = null, page = null, where = 'query', body = null;
    for (const k of u.searchParams.keys()) { if (!kw && KW_KEY.test(k)) kw = [k]; if (!page && PAGE_KEY.test(k)) page = [k]; }
    if (!kw && cap.body) {
      try { body = JSON.parse(cap.body); kw = findKeyPath(body, KW_KEY); page = findKeyPath(body, PAGE_KEY); where = 'body'; } catch { /* ไม่ใช่ JSON */ }
    } else if (cap.body) { try { body = JSON.parse(cap.body); } catch { /* ข้าม */ } }
    if (!kw) return null; // คำขอนี้ไม่มีช่องคีย์เวิร์ด — ยังเรียนรู้ไม่ได้
    const pageVal = where === 'query' ? (page ? u.searchParams.get(page[0]) : null) : (page ? getPath(body, page) : null);
    const limitKey = [...u.searchParams.keys()].find((k) => /^(limit|page_?size|pageSize|page_limit)$/i.test(k));
    return {
      url: cap.url, method: cap.method, headers: cap.headers || {}, body: cap.body || '', where, kw, page,
      pageBase: pageVal, limit: limitKey ? Number(u.searchParams.get(limitKey)) || 20 : 20, learnedAt: Date.now(),
    };
  }
  function buildReq(tpl, keyword, pageIdx) {
    const u = new URL(tpl.url);
    let body = tpl.body;
    const pageValue = () => {
      const base = Number(tpl.pageBase);
      if (tpl.page && /offset/i.test(tpl.page[tpl.page.length - 1])) return pageIdx * (tpl.limit || 20); // offset = ข้ามกี่ชิ้น
      return (Number.isFinite(base) && base === 0 ? 0 : 1) + pageIdx; // เลขหน้าเริ่ม 0 หรือ 1 ตามที่เว็บใช้
    };
    if (tpl.where === 'query') {
      u.searchParams.set(tpl.kw[0], keyword);
      if (tpl.page) u.searchParams.set(tpl.page[0], String(pageValue()));
    } else {
      const b = JSON.parse(tpl.body);
      setPath(b, tpl.kw, keyword);
      if (tpl.page) setPath(b, tpl.page, pageValue());
      body = JSON.stringify(b);
    }
    return { url: u.href, method: tpl.method, headers: tpl.headers, body };
  }

  function onCapture(cap) {
    // คำตอบถูกปฏิเสธแบบกันบอต: error 90309999 อยู่ใน body (ไม่ใช่แค่ status) หรือ 403 ที่สั่ง action_type
    if (/90309999/.test(cap.text) || (cap.status === 403 && /action_type|anti_bot|captcha/i.test(cap.text))) { setBlocked('เว็บปฏิเสธคำขอ (กันบอต)'); return; }
    let json;
    try { json = JSON.parse(cap.text); } catch { return; }
    st.caps.unshift({ url: cap.url, method: cap.method, n: 0 });
    st.caps.length = Math.min(st.caps.length, 12);
    if (/\/offer\/shop\/list/.test(cap.url)) { st.shops = readShops(json); st.caps[0].n = st.shops.length; render(); return; }
    const items = parseItems(json);
    st.caps[0].n = items.length;
    if (!items.length) return;
    st.lastList = { url: cap.url, keys: Object.keys(firstObjWith(json) || {}).slice(0, 30) };
    st.sig = items.slice(0, 5).map((x) => x.item_id).join(',');
    try { const q = new URL(cap.url).searchParams, lim = Number(q.get('page_limit')) || 20; st.page = Math.floor((Number(q.get('page_offset')) || 0) / lim) + 1; } catch { /* ไม่เป็นไร */ }
    const pk = st.mode === 'shop' && st.shop ? `shop:${st.shop.shop_id}` : normKw(st.kw);
    if (pk && st.page > (st.pages[pk] || 0)) { st.pages[pk] = st.page; chrome.storage.local.set({ shpPages: st.pages }).catch(() => {}); }
    const t = learn(cap);
    if (t) { st.tpl = t; chrome.storage.local.set({ shpTpl: t }).catch(() => {}); }
    // หน้าเว็บโหลดรายการสินค้า (คุณค้น/เลื่อน/เปลี่ยนหน้าเอง หรือแผงกดปุ่มของเว็บให้) → แสดงในแผง
    const shopHere = shopIdInPage();
    mergeItems(shopHere ? items.map((x) => ({ ...x, shop_id: x.shop_id || shopHere })) : items, cap.url);
    if (shopHere && items[0] && items[0].shop) st.shop = { shop_id: shopHere, name: items[0].shop };
    checkKnown().then(() => { if (!st.picked.size) pickDefault(); render(); }, render);
    render();
  }
  function firstObjWith(json) {
    let found = null;
    const walk = (n, d) => { if (found || !n || d > 9 || typeof n !== 'object') return; if (!Array.isArray(n) && (n.item_id || n.itemid || n.itemId)) { found = n; return; } Object.values(n).forEach((v) => walk(v, d + 1)); };
    walk(json, 0);
    return found;
  }
  function mergeItems(items, src) {
    const have = new Map(st.items.map((x) => [x.item_id, x]));
    for (const it of items) if (!have.has(it.item_id)) { have.set(it.item_id, { ...it, keyword: st.kw }); }
    st.items = [...have.values()].slice(0, 200);
  }
  async function checkKnown() {
    const ids = st.items.map((x) => x.item_id).filter((id) => !st.known.has(id));
    if (!ids.length) return;
    const r = await send('shopeeKnown', { ids });
    r.known.forEach((id) => st.known.add(id));
    for (const it of st.items) if (!st.known.has(it.item_id) && !st.picked.has(it.item_id) && passPrice(it)) st.picked.add(it.item_id);
  }
  const priceNum = (it) => Number(String(it.price || '').replace(/,/g, '')) || 0;
  const passPrice = (it) => !st.priceMin || !priceNum(it) || priceNum(it) >= st.priceMin;

  // ---------- หาสินค้าตามคีย์เวิร์ด ----------
  // ---------- กดหน้าเว็บแบบคน (วิธีเดียวกับแอป Pondy: app/src/main/assets/shopee_pick.js ที่ใช้งานจริงบนมือถือ) ----------
  const normT = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const isVisible = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  // ช่องค้นหาหลัก: กว้าง อยู่บนสุด placeholder มีคำว่า ค้นหา (แบบ Pondy)
  function searchInput(phRe) {
    let best = null, bestScore = -1;
    for (const el of document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')) {
      if (!isVisible(el) || host.contains(el)) continue;
      const r = el.getBoundingClientRect(), ph = normT(el.placeholder);
      let sc = (phRe.test(ph) ? 200 : 0) + (/ค้นหา|search|สินค้า/.test(ph) ? 100 : 0) + (r.width > 200 ? 30 : 0) + (r.top < innerHeight * 0.4 ? 10 : 0) - r.top / 100;
      if (sc > bestScore) { bestScore = sc; best = el; }
    }
    return best;
  }
  function clickSearchButton(input) {
    const ir = input.getBoundingClientRect();
    let best = null, bestScore = -1;
    for (const el of document.querySelectorAll('button,[role="button"],input[type="submit"],.ant-input-search-button,[class*="earch"]')) {
      if (!isVisible(el) || host.contains(el)) continue;
      const r = el.getBoundingClientRect();
      const t = normT(`${el.innerText || el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${typeof el.className === 'string' ? el.className : ''}`);
      const sameRow = Math.abs((r.top + r.height / 2) - (ir.top + ir.height / 2)) < 50, toRight = r.left >= ir.left && r.left <= ir.right + 260;
      const sc = (/ค้นหา|search|magnifier|submit/.test(t) ? 1000 : 0) + (sameRow && toRight ? 400 : 0) + (el.tagName === 'BUTTON' ? 60 : 0) - (el.contains(input) ? 500 : 0) - Math.min(50, r.width / 20); // ปุ่มจริง ไม่ใช่กรอบที่ห่อช่องค้นหา
      if (sc > bestScore) { bestScore = sc; best = el; }
    }
    if (best && bestScore > 200) best.click();
  }
  // กรอกช่องค้นหาของหน้าเว็บ + Enter + กดปุ่ม "ค้นหา" ของเว็บ — คำขอที่เว็บยิงเองผ่านระบบกันบอต แผงแค่อ่านผล
  function siteSearch(text, phRe) {
    const input = searchInput(phRe);
    if (!input) return false;
    try { input.scrollIntoView({ block: 'center' }); } catch { /* ข้าม */ }
    input.focus(); input.click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (const ty of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(ty, { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    clickSearchButton(input);
    return true;
  }
  // ปุ่ม/ป้ายที่ข้อความตรงเป๊ะ (กันไปโดนคำว่า "ขายดี" บนการ์ดสินค้า)
  function chip(re) {
    return [...document.querySelectorAll('button,[role="button"],a,div,span,li,label')].find((el) => { const t = (el.textContent || '').trim(); return t.length < 24 && re.test(t) && isVisible(el) && !host.contains(el); }) || null;
  }
  const goWithHandoff = (path, extra) => {
    try { sessionStorage.setItem('arnShpKw', JSON.stringify({ kw: st.kw.trim(), n: st.count, at: Date.now(), ...extra })); } catch { /* ไม่มีที่เก็บ */ }
    location.assign(path);
  };
  const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
  async function search() {
    const kw = st.kw.trim();
    if (!kw) throw new Error('พิมพ์คีย์เวิร์ดก่อน');
    if (st.blocked) throw new Error('เว็บยังขอยืนยันว่าไม่ใช่บอต — แก้ CAPTCHA เองแล้วกด “โหลดหน้าใหม่” ก่อน');
    if (!/\/offer\/product_offer/.test(location.pathname)) { setMsg('กำลังเปิดหน้า ข้อเสนอผลิตภัณฑ์…'); return goWithHandoff('/offer/product_offer', {}); }
    st.items = []; st.picked.clear();
    // ลำดับเดียวกับ Pondy: แท็บ "ค่าคอมพิเศษ" → ค้นหา → เรียง "ขายดี"
    const tab = chip(/ค่าคอมพิเศษ/);
    await gate(900);
    if (tab && !/active|selected|checked/i.test(`${tab.className} ${tab.parentElement && tab.parentElement.className}`)) { tab.click(); await gate(2200); }
    if (!siteSearch(kw, /ค้นหา|สินค้า|product/i)) throw new Error('ไม่เจอช่องค้นหาของเว็บ — พิมพ์คำค้นในช่องของเว็บเองได้ แผงจะอ่านผลให้');
    st.page = 1;
    gate(2200).then(() => { if (!st.blocked) siteSort(2); });
    setMsg(`ค้น “${kw}” ด้วยช่องค้นหาของเว็บแล้ว — รอผล…`);
    if (!(await waitFor(() => st.items.length || st.blocked))) return setMsg('ยังไม่เห็นผลค้นหา — ถ้าเว็บแสดงสินค้าแล้วแต่แผงไม่ขึ้น กด “ตรวจหน้า” แล้วส่งข้อความมา', true);
    if (st.blocked) return;
    pickDefault();
    const last = st.pages[normKw(kw)];
    if (last > 1) setMsg(`${st.msg} · ครั้งก่อนคีย์นี้ไปถึงหน้า ${last} — กด “⏩ ไปหน้า ${last + 1}” ได้สินค้าที่ยังไม่เคยเห็น`);
  }
  // ติ๊กให้ count ชิ้นแรกที่ยังไม่มีในคลัง
  function pickDefault() {
    const show = visibleItems();
    st.picked = new Set(show.filter((x) => !st.known.has(x.item_id)).slice(0, st.count).map((x) => x.item_id));
    setMsg(`เห็น ${st.items.length} ชิ้นในหน้านี้ · ใหม่ ${show.filter((x) => !st.known.has(x.item_id)).length} ชิ้น — ติ๊กไว้ให้ ${st.picked.size} ชิ้น · อยากได้เพิ่มกด “หน้าถัดไปของเว็บ”`);
  }
  const visibleItems = () => st.items.filter((x) => (!st.skipKnown || !st.known.has(x.item_id)) && passPrice(x));

  // ---------- ค้นจากร้านค้า (หน้า ข้อเสนอร้านค้า) ----------
  // แผงไม่ยิงคำขอเอง (ยิงเองแล้วเว็บตอบ 403 / พาไปหน้า CAPTCHA — เจอจริง 31 ต.ค.): กรอกช่อง "ค้นหาร้านค้า" + กดปุ่มของเว็บ แล้วอ่านคำตอบที่เว็บโหลดมา
  //   รายชื่อร้าน: /api/v3/offer/shop/list → data.list[{shop_id, shop_name, shop_image, commission_rate}]
  //   สินค้าในร้าน: เปิดหน้า /offer/brand_offer/<shop_id> → เว็บโหลด /api/v3/offer/product/list?list_type=5&match_id=<shop_id> เอง
  function readShops(json) {
    const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : [];
    return list.filter((x) => x && x.shop_id && x.shop_name && !x.item_id).map((x) => ({ shop_id: String(x.shop_id), name: String(x.shop_name), image: imgUrl(x.shop_image), commission: String(x.commission_rate || '') }));
  }
  async function searchShops() {
    const kw = st.kw.trim();
    if (!kw) throw new Error('พิมพ์ชื่อร้านก่อน');
    if (st.blocked) throw new Error('เว็บยังขอยืนยันว่าไม่ใช่บอต — แก้ CAPTCHA เองแล้วกด “โหลดหน้าใหม่” ก่อน');
    if (!/^\/offer\/brand_offer\/?$/.test(location.pathname)) { setMsg('กำลังเปิดหน้า ข้อเสนอร้านค้า…'); return goWithHandoff('/offer/brand_offer', { shop: true }); }
    st.shops = []; st.shop = null; st.items = []; st.picked.clear(); st.shopsFor = kw;
    if (!siteSearch(kw, /ร้าน/)) throw new Error('ไม่เจอช่อง “ค้นหาร้านค้า” ของเว็บ — พิมพ์ชื่อร้านในช่องของเว็บเองได้ แผงจะอ่านผลให้');
    setMsg(`ค้นร้าน “${kw}” ด้วยช่องค้นหาของเว็บแล้ว — รอผล…`);
    if (!(await waitFor(() => st.shops.length))) return setMsg(`ยังไม่เห็นผล — ถ้าเว็บขึ้นว่าไม่พบร้าน แปลว่าร้าน “${kw}” ไม่ได้ร่วมข้อเสนอร้านค้า`, true);
    const exact = st.shops.filter((x) => x.name.toLowerCase() === kw.toLowerCase());
    if (st.shops.length === 1 || exact.length === 1) return loadShop(exact[0] || st.shops[0]);
    setMsg(`เจอ ${st.shops.length} ร้าน — กด “ดูสินค้า” ที่ร้านที่ต้องการ`);
  }
  // เปิดหน้ารายละเอียดร้าน (เว็บโหลดสินค้าของร้านเอง) — จำไว้ว่ากำลังดูร้านไหน เพื่อให้แผงหลังโหลดหน้าใหม่ทำต่อ
  function loadShop(shop) {
    try { sessionStorage.setItem('arnShpShop', JSON.stringify({ shop, sort: st.shopSort, count: st.count, at: Date.now() })); } catch { /* ไม่มีที่เก็บ */ }
    setMsg(`กำลังเปิดหน้าร้าน ${shop.name}…`);
    if (location.pathname === `/offer/brand_offer/${shop.shop_id}`) return location.reload();
    location.assign(`/offer/brand_offer/${shop.shop_id}`);
  }
  // อยู่ในหน้ารายละเอียดร้าน (/offer/brand_offer/<shop_id>)
  const shopIdInPage = () => (/\/offer\/brand_offer\/(\d+)/.exec(location.pathname) || [])[1] || '';
  // คลิกตัวเลือกเรียงของเว็บ (ขายดี / คอมมิชชั่น) — เว็บโหลดใหม่เอง
  function siteSort(sort) {
    const el = chip(sort === 5 ? /^คอมมิช/ : /^ขายดี$/);
    if (!el) return false;
    st.items = []; st.picked.clear();
    el.click();
    return true;
  }
  // หน้าถัดไป: หาแถวเลขหน้าที่เลข 1 2 3… เรียงกัน (แบบ Pondy) แล้วกดเลขถัดจากหน้าปัจจุบัน · ไม่เจอ → ปุ่ม next ของ ant-design
  function siteNext() {
    const nums = [];
    for (const el of document.querySelectorAll('a,button,li,span,div')) {
      if (!isVisible(el) || host.contains(el)) continue;
      const t = normT(el.innerText || el.textContent);
      if (!/^\d{1,3}$/.test(t)) continue;
      if ([...el.querySelectorAll('*')].some((c) => normT(c.innerText || c.textContent) === t)) continue; // เอาตัวในสุด
      const r = el.getBoundingClientRect();
      nums.push({ n: Number(t), el, left: r.left, cy: r.top + r.height / 2, on: /active|current|selected/i.test(`${el.className} ${el.parentElement && el.parentElement.className}`) });
    }
    const groups = [];
    for (const it of nums) { const g = groups.find((x) => Math.abs(x.cy - it.cy) < 24); if (g) g.items.push(it); else groups.push({ cy: it.cy, items: [it] }); }
    const row = groups.filter((g) => g.items.length >= 2).sort((a, b) => b.cy - a.cy)[0];
    if (row) {
      const items = row.items.sort((a, b) => a.left - b.left);
      const cur = items.find((x) => x.on) || items[0];
      const nx = items.find((x) => x.n === cur.n + 1);
      if (nx) { (nx.el.closest('a,button,li,[role="button"]') || nx.el).click(); return true; }
    }
    const el = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled), [class*=pagination] [class*=next]:not([class*=disabled])');
    if (!el) return false;
    el.click();
    return true;
  }

  // เปลี่ยนหน้าแบบ Pondy: จำลายเซ็นรายการไว้ก่อนกด → รอจนรายการเปลี่ยนจริง (ไม่เกิน 15 วิ) · เว้นระยะสุ่มระหว่างหน้า
  let lastPageAt = 0;
  async function nextPage() {
    if (st.blocked) throw new Error('เว็บยังขอยืนยันว่าไม่ใช่บอต — แก้ CAPTCHA เองแล้วกด “โหลดหน้าใหม่” ก่อน');
    const wait = 4000 - (Date.now() - lastPageAt);
    if (wait > 0) { setMsg('พักจังหวะสักครู่ก่อนเปลี่ยนหน้า (กันโดนมองว่าเป็นบอต)…'); await gate(wait); }
    const before = st.sig, p0 = st.page;
    await gate(1200);
    if (!siteNext()) throw new Error('ไม่มีหน้าถัดไปแล้ว (หรือไม่เจอปุ่ม) — เลื่อนลงไปกดในเว็บเองได้');
    lastPageAt = Date.now();
    if (!(await waitFor(() => (st.sig && st.sig !== before) || st.blocked, 15000))) throw new Error('กดหน้าถัดไปแล้วแต่รายการไม่เปลี่ยน — รอสักครู่ หรือกด “โหลดหน้าใหม่”');
    if (st.blocked) return false;
    if (st.page <= p0) st.page = p0 + 1; // คำขอไม่มี page_offset → นับเอง
    setMsg(`หน้า ${st.page} · เห็นรวม ${st.items.length} ชิ้น`);
    return true;
  }
  async function gotoPage(n) {
    st.busy = true; render();
    try { while (st.page < n) { if (!(await nextPage())) return; await gate(2500); } } finally { st.busy = false; render(); }
    pickDefault();
  }

  // ขอลิงก์แอฟฟิลิเอตแบบปุ่ม "เอา ลิงก์" (ใช้เฉพาะสินค้าที่ข้อมูลไม่มีลิงก์ยาวมาให้ — ยิงผ่าน fetch ของหน้า แบบแอป Pondy)
  const OFFER_Q = '\n      query batchGetProductOfferLink (\n        $sourceCaller: SourceCaller!\n        $productOfferLinkParams: [ProductOfferLinkParam!]!\n        $advancedLinkParams: AdvancedLinkParams\n      ){\n        productOfferLinks(\n          productOfferLinkParams: $productOfferLinkParams,\n          sourceCaller: $sourceCaller,\n          advancedLinkParams: $advancedLinkParams\n        ) {\n          itemId\n          shopId\n          productOfferLink\n        }\n      }\n      ';
  async function offerLinks(items) {
    const out = new Map();
    for (let i = 0; i < items.length; i += 20) {
      const chunk = items.slice(i, i + 20);
      const r = await pageFetch({
        url: `${location.origin}/api/v3/gql?q=productOfferLinks`, method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationName: 'batchGetProductOfferLink', query: OFFER_Q, variables: { productOfferLinkParams: chunk.map((it) => ({ itemId: String(it.item_id), shopId: Number(it.shop_id), trace: '' })), sourceCaller: 'WEB_SITE_CALLER', advancedLinkParams: { subId1: '', subId2: '', subId3: '', subId4: '', subId5: '' } } }),
      });
      if (!r.ok) throw new Error(`ขอลิงก์ไม่ได้ (เว็บตอบ ${r.status || ''})`);
      let j; try { j = JSON.parse(r.text); } catch { throw new Error('คำตอบตอนขอลิงก์ไม่ใช่ข้อมูล'); }
      for (const l of (j.data && j.data.productOfferLinks) || []) if (l && l.productOfferLink) out.set(String(l.itemId), l.productOfferLink);
      if (i + 20 < items.length) await new Promise((res) => setTimeout(res, 800));
    }
    return out;
  }
  async function addToReels() {
    const items = st.items.filter((x) => st.picked.has(x.item_id));
    if (!items.length) throw new Error('ยังไม่ได้ติ๊กสินค้า');
    st.busy = true; render();
    try {
      // ลิงก์แอฟฟิลิเอตที่มากับข้อมูลสินค้าของหน้าเว็บ (ไม่ต้องขอเพิ่ม) · ไม่มีค่อยขอแบบปุ่ม "เอา ลิงก์"
      const links = new Map(items.filter((x) => x.aff_url).map((x) => [x.item_id, x.aff_url]));
      const need = items.filter((x) => !links.has(x.item_id) && /^\d+$/.test(x.shop_id));
      // ขอลิงก์ผ่าน GQL เป็นทางเดียวกับที่ทำให้เจอ CAPTCHA (Pondy) → ใช้เฉพาะเมื่อจำเป็น และพัก 30 นาทีหลังโดนปฏิเสธ
      if (need.length && !st.blocked && Date.now() > st.gqlMute) {
        setMsg(`กำลังขอลิงก์แอฟฟิลิเอต ${need.length} ชิ้น…`);
        try { for (const [k, v] of await offerLinks(need)) links.set(k, v); } catch (e) {
          st.gqlMute = Date.now() + 30 * 60000; chrome.storage.local.set({ shpGqlMute: st.gqlMute }).catch(() => {});
          if (!links.size) throw e;
        }
      }
      const ready = items.filter((x) => links.get(x.item_id)).map((x) => ({ ...x, url: links.get(x.item_id), keyword: x.keyword || st.kw }));
      if (!ready.length) throw new Error('ไม่ได้ลิงก์แอฟฟิลิเอตเลย — กด “เอา ลิงก์” ที่สินค้าในเว็บเองดูว่าบัญชีขอลิงก์ได้ไหม');
      setMsg(`ได้ลิงก์ ${ready.length} ชิ้น กำลังส่งเข้า Arn Reels (ดึงรูปสินค้า)…`);
      const r = await send('shopeeImport', { items: ready, queue: st.queue });
      ready.forEach((x) => { st.known.add(x.item_id); st.picked.delete(x.item_id); });
      const miss = items.length - ready.length;
      setMsg(`✓ เพิ่มเข้าคลังสินค้า ${r.added} ชิ้น${r.duplicates ? ` · มีอยู่แล้ว ${r.duplicates}` : ''}${miss ? ` · ไม่ได้ลิงก์ ${miss}` : ''}${r.failed.length ? ` · ข้าม ${r.failed.length}` : ''}${st.queue ? ` · เข้าคิวคลิปสินค้า ${r.queued} (รอทำบน meta.ai ทั้งหมด ${r.queue})` : ''} — กลับไปที่ Arn Reels ได้เลย`);
    } finally { st.busy = false; render(); }
  }

  // ---------- UI ----------
  const host = document.createElement('div');
  host.id = 'arn-shp-host';
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('style');
  css.textContent = `
    * { box-sizing: border-box; font-family: "Leelawadee UI", Tahoma, sans-serif; }
    .box { width: 380px; max-height: 84vh; overflow: auto; background: #12152a; color: #e8eaf6; border: 1px solid #3b4170; border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.5); font-size: 13px; line-height: 1.45; }
    .head { display: flex; gap: 8px; padding: 10px 12px; cursor: pointer; background: #1a1e3a; border-radius: 14px; font-weight: 700; }
    .box.open .head { border-radius: 14px 14px 0 0; } .head .t { flex: 1; }
    .body { padding: 10px 12px 12px; display: grid; gap: 8px; }
    input[type=text], input[type=number], select { background: #0c0e1d; color: #fff; border: 1px solid #343a5c; border-radius: 8px; padding: 6px 8px; font-size: 13px; }
    input[type=text] { flex: 1; min-width: 0; } input[type=number] { width: 80px; }
    button { font-size: 13px; padding: 7px 11px; border-radius: 8px; border: 1px solid #4a5190; background: #222750; color: #e8eaf6; cursor: pointer; }
    button.p { background: #ee4d2d; border-color: #ee4d2d; color: #fff; font-weight: 700; } button:disabled { opacity: .5; cursor: not-allowed; }
    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; } .hint { color: #9aa0c8; font-size: 12px; }
    .ok { color: #7be0a0; } .bad { color: #ff9b9b; } label { display: flex; gap: 5px; align-items: center; }
    .it { display: grid; grid-template-columns: 18px 46px 1fr; gap: 8px; align-items: center; background: #0c0e1d; border: 1px solid #2c3155; border-radius: 10px; padding: 6px; }
    .it.known { opacity: .5; } .it img { width: 46px; height: 46px; object-fit: cover; border-radius: 6px; background: #000; }
    .it .n { font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } .it .m { font-size: 11.5px; color: #9aa0c8; }
    pre { white-space: pre-wrap; word-break: break-all; font-size: 11px; background: #0c0e1d; padding: 6px; border-radius: 6px; max-height: 180px; overflow: auto; margin: 0; }
  `;
  const box = document.createElement('div');
  shadow.append(css, box);
  document.documentElement.append(host);

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n[k] = v; }
    n.append(...kids);
    return n;
  };
  const setMsg = (t, bad = false) => { st.msg = t; st.bad = bad; render(); };
  const guard = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } catch (e) { setMsg(e.message, true); } finally { btn.disabled = false; } };

  function render() {
    box.className = `box${st.open ? ' open' : ''}`;
    const head = el('div', { class: 'head', onclick: () => { st.open = !st.open; render(); } }, el('span', { class: 't', textContent: '🛍 Arn Reels · หาสินค้า' }), el('span', { textContent: st.open ? '▾' : '▸' }));
    if (!st.open) { box.replaceChildren(head); return; }
    const body = el('div', { class: 'body' });
    const tab = (m, t) => el('button', { textContent: t, class: st.mode === m ? 'p' : '', onclick: () => { st.mode = m; st.msg = ''; render(); } });
    body.append(el('div', { class: 'row' }, tab('kw', '🔎 ค้นสินค้า'), tab('shop', '🏪 ค้นร้านค้า')));
    const isShop = st.mode === 'shop';
    body.append(el('div', { class: 'hint', textContent: isShop
      ? 'พิมพ์ชื่อร้าน → หาร้าน → ดูสินค้า → ติ๊ก → เพิ่มเข้า Arn Reels · แผงกดช่องค้นหา/ปุ่มของเว็บให้ แล้วอ่านสิ่งที่เว็บแสดง (ไม่ยิงคำขอเอง กันโดนมองว่าเป็นบอต)'
      : 'พิมพ์คีย์เวิร์ด → หาสินค้า (ใช้ช่องค้นหาของหน้า ข้อเสนอผลิตภัณฑ์) · ค้น/เลื่อน/เปลี่ยนหน้าในเว็บเองก็ได้ แผงอ่านรายการให้' }));
    if (st.blocked) {
      const rl = el('button', { class: 'p', textContent: '↻ โหลดหน้าใหม่', title: 'โหลดหน้าใหม่ทั้งหน้า (โหลดแบบ soft จะทิ้งกล่อง CAPTCHA ค้าง)', onclick: () => { location.assign(`${location.origin}/offer/product_offer`); } });
      body.append(el('div', { class: 'bad', textContent: `⛔ Shopee ขอยืนยันว่าไม่ใช่บอต (${st.blocked}) — แผงหยุดกดให้แล้ว · แก้ CAPTCHA ในหน้าเว็บด้วยตัวเอง แล้วพัก 5–10 นาที ค่อยกดโหลดหน้าใหม่` }), el('div', { class: 'row' }, rl));
    }
    const kw = el('input', { type: 'text', value: st.kw, placeholder: isShop ? 'ชื่อร้าน เช่น GUCUT' : 'คีย์เวิร์ด เช่น ครีมกันแดด', oninput: () => { st.kw = kw.value; } });
    const go = el('button', { class: 'p', textContent: isShop ? '🏪 หาร้าน' : '🔎 หาสินค้า', disabled: st.busy });
    go.onclick = guard(go, isShop ? searchShops : search);

    kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    body.append(el('div', { class: 'row' }, kw, go));
    if (isShop) {
      const ss = el('select', { onchange: () => { st.shopSort = Number(ss.value); if (shopIdInPage() && !siteSort(st.shopSort)) setMsg('ไม่เจอปุ่มเรียงของเว็บ — กดเรียงในหน้าเว็บเองได้', true); } },
        el('option', { value: '2', textContent: 'เรียง: ขายดี', selected: st.shopSort === 2 }), el('option', { value: '5', textContent: 'เรียง: ค่าคอมสูง', selected: st.shopSort === 5 }));
      body.append(el('div', { class: 'row' }, ss, st.shop ? el('span', { class: 'hint', textContent: `ร้าน: ${st.shop.name}` }) : ''));
      if (!st.shop) for (const sh of st.shops) {
        const b = el('button', { class: 'p', textContent: 'ดูสินค้า', disabled: st.busy });
        b.onclick = guard(b, () => loadShop(sh));
        body.append(el('div', { class: 'it' }, el('img', { src: sh.image || '', alt: '', referrerPolicy: 'no-referrer' }), el('div', {}, el('div', { class: 'n', textContent: sh.name }), el('div', { class: 'm', textContent: sh.commission ? `ค่าคอมสูงสุด ${sh.commission}` : '' })), b));
      }
    }
    if (st.items.length) {
      const nx = el('button', { textContent: `➡ หน้าถัดไป (ตอนนี้หน้า ${st.page})`, title: 'เปิดหน้าถัดไปของรายการในเว็บ แผงเก็บสินค้าเพิ่มให้', disabled: st.busy || !!st.blocked });
      nx.onclick = guard(nx, async () => { if (await nextPage()) pickDefault(); });
      const pk = st.mode === 'shop' && st.shop ? `shop:${st.shop.shop_id}` : normKw(st.kw), last = st.pages[pk] || 0;
      const row = el('div', { class: 'row' }, nx);
      if (last >= st.page) { const gt = el('button', { textContent: `⏩ ไปหน้า ${last + 1}`, title: 'ข้ามไปหน้าที่ยังไม่เคยดูของคีย์นี้ (กดหน้าถัดไปให้ทีละหน้า เว้นจังหวะ)', disabled: st.busy || !!st.blocked }); gt.onclick = guard(gt, () => gotoPage(last + 1)); row.append(gt); }
      body.append(row);
    }
    const cnt = el('select', { onchange: () => { st.count = Number(cnt.value); chrome.storage.local.set({ shpCount: st.count }).catch(() => {}); } },
      ...[5, 10, 20, 30, 50].map((n) => el('option', { value: String(n), textContent: `${n} ชิ้น`, selected: n === st.count })));
    const pmin = el('input', { type: 'number', min: 0, step: 10, value: st.priceMin || '', placeholder: 'ขั้นต่ำ', onchange: () => { st.priceMin = Number(pmin.value) || 0; chrome.storage.local.set({ shpPriceMin: st.priceMin }).catch(() => {}); render(); } });
    const sk = el('input', { type: 'checkbox', checked: st.skipKnown, onchange: () => { st.skipKnown = sk.checked; render(); } });
    body.append(el('div', { class: 'row' }, el('span', { class: 'hint', textContent: 'เอา' }), cnt, el('span', { class: 'hint', textContent: 'ราคา ≥ ฿' }), pmin, el('label', { class: 'hint' }, sk, 'ซ่อนที่มีในคลังแล้ว')));

    const list = visibleItems();
    if (list.length) {
      const all = el('button', { textContent: 'ติ๊กทั้งหมด', onclick: () => { list.forEach((x) => { if (!st.known.has(x.item_id)) st.picked.add(x.item_id); }); render(); } });
      const none = el('button', { textContent: 'ล้าง', onclick: () => { st.picked.clear(); render(); } });
      body.append(el('div', { class: 'row' }, el('span', { class: 'hint', textContent: `${list.length} ชิ้น · ติ๊ก ${st.picked.size}` }), all, none));
      for (const it of list.slice(0, 100)) {
        const known = st.known.has(it.item_id);
        const cb = el('input', { type: 'checkbox', checked: st.picked.has(it.item_id), disabled: known, onchange: () => { if (cb.checked) st.picked.add(it.item_id); else st.picked.delete(it.item_id); render(); } });
        const meta = [it.price && `฿${it.price}`, it.commission && `ค่าคอม ${it.commission}`, it.sales && `ขาย ${it.sales.toLocaleString('th-TH')}`, known && 'มีในคลังแล้ว'].filter(Boolean).join(' · ');
        body.append(el('label', { class: `it${known ? ' known' : ''}` }, cb, el('img', { src: it.image_url || '', alt: '', referrerPolicy: 'no-referrer' }), el('div', {}, el('div', { class: 'n', textContent: it.name }), el('div', { class: 'm', textContent: meta }))));
      }
      const q = el('input', { type: 'checkbox', checked: st.queue, onchange: () => { st.queue = q.checked; chrome.storage.local.set({ shpQueue: st.queue }).catch(() => {}); } });
      body.append(el('label', { class: 'hint' }, q, 'เข้าคิวทำคลิปสินค้า (Meta AI) ให้เลย'));
      const add = el('button', { class: 'p', textContent: `➕ เพิ่ม ${st.picked.size} ชิ้นเข้า Arn Reels`, disabled: st.busy || !st.picked.size });
      add.onclick = guard(add, addToReels);
      body.append(el('div', { class: 'row' }, add));
    }
    if (st.msg) body.append(el('div', { class: st.bad ? 'bad' : 'ok', textContent: st.msg }));
    const dg = el('button', { textContent: 'ตรวจหน้า', title: 'ดูว่าแผงเห็นคำขอ/ข้อมูลสินค้าอะไรบ้าง (ส่งข้อความนี้ให้ผู้ดูแลถ้าค้นไม่ได้)' });
    dg.onclick = () => {
      st.diag = [`หน้า: ${location.pathname}`,
        `เรียนรู้แล้ว: ${st.tpl ? `${st.tpl.method} ${st.tpl.url.replace(/^https:\/\/[^/]+/, '')} · คีย์เวิร์ด=${st.tpl.where}:${st.tpl.kw.join('.')} · หน้า=${st.tpl.page ? st.tpl.page.join('.') : '(ไม่มี)'}` : 'ยัง'}`,
        `คำขอ API ล่าสุด (${st.caps.length}):`, ...st.caps.map((c) => `${c.method} ${c.url.replace(/^https:\/\/[^/]+/, '').slice(0, 110)} → สินค้า ${c.n}`),
        st.lastList ? `ฟิลด์ของสินค้าชิ้นแรก: ${st.lastList.keys.join(', ')}` : 'ยังไม่เห็นข้อมูลสินค้า',
        st.items[0] ? `ตัวอย่างที่อ่านได้: ${JSON.stringify(st.items[0]).slice(0, 300)}` : ''].join('\n');
      render();
    };
    const forget = el('button', { textContent: 'ลืมวิธีค้น', title: 'ล้างสิ่งที่เรียนรู้ไว้ แล้วค้นในเว็บใหม่ 1 ครั้ง', onclick: () => { st.tpl = null; chrome.storage.local.remove('shpTpl').catch(() => {}); render(); } });
    body.append(el('div', { class: 'row' }, dg, forget));
    if (st.diag) body.append(el('pre', { textContent: st.diag }));
    box.replaceChildren(head, body);
  }

  chrome.storage.local.get(['shpTpl', 'shpCount', 'shpPriceMin', 'shpQueue', 'shpPages', 'shpGqlMute']).then((v) => {
    if (v.shpPages && typeof v.shpPages === 'object') st.pages = v.shpPages;
    if (v.shpGqlMute) st.gqlMute = v.shpGqlMute;
    if (v.shpTpl && v.shpTpl.url) st.tpl = v.shpTpl;
    if (v.shpCount) st.count = v.shpCount;
    if (v.shpPriceMin) st.priceMin = v.shpPriceMin;
    if (v.shpQueue === false) st.queue = false;
    takeHandoff();
    resumeShop();
    render();
  }).catch(() => { takeHandoff(); resumeShop(); render(); });

  function resumeShop() {
    // สินค้าที่หน้าโหลดก่อนแผงพร้อม (hook เก็บไว้ให้)
    window.postMessage({ tag: TAG, dir: 'down', op: 'dump' }, location.origin);
    if (!shopIdInPage()) return;
    st.mode = 'shop';
    let h = null;
    try { h = JSON.parse(sessionStorage.getItem('arnShpShop') || 'null'); sessionStorage.removeItem('arnShpShop'); } catch { /* ไม่มี */ }
    if (!h || Date.now() - (h.at || 0) > 10 * 60 * 1000 || !h.shop || h.shop.shop_id !== shopIdInPage()) return;
    st.open = true; st.shop = h.shop; st.shopSort = h.sort || 2;
    if ([5, 10, 20, 30, 50].includes(h.count)) st.count = h.count;
    // หน้ารายละเอียดร้านเปิดมาเรียง "คอมมิชชั่น" → ถ้าเลือกขายดีไว้ กดปุ่มเรียงของเว็บให้
    if (st.shopSort === 2) gate(2500).then(() => { if (!st.blocked) siteSort(2); });
  }

  // คีย์เวิร์ดที่ส่งมาจาก Arn Reels (ปุ่ม "หาใน Shopee") → ใส่ในแผงแล้วค้นให้เลย (ถ้าเรียนรู้วิธีค้นแล้ว)
  function takeHandoff() {
    let h = null;
    try { h = JSON.parse(sessionStorage.getItem('arnShpKw') || 'null'); sessionStorage.removeItem('arnShpKw'); } catch { /* ไม่มี */ }
    if (!h || !h.kw || Date.now() - (h.at || 0) > 10 * 60 * 1000) return;
    st.kw = h.kw; st.open = true;
    if ([5, 10, 20, 30, 50].includes(h.n)) st.count = h.n;
    if (h.shop) { st.mode = 'shop'; setTimeout(() => { if (!st.busy) searchShops().catch((e) => setMsg(e.message, true)); }, 2500); return; }
    setTimeout(() => { if (!st.busy) search().catch((e) => setMsg(e.message, true)); }, 2500);
  }
  render();
})();
