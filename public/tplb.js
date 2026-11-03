// เทมเพลต B (สปอยล์ภาพนิ่ง): ชั้นวาดทับช็อต — ป้ายตอน, มิเตอร์ระดับสปอยล์, แถบบรรยายบน, กล่องข้อความไฮไลต์, คำเสียง, การ์ดปก/การ์ดจบ
// วาดด้วยโค้ดล้วน ไม่ใช้รูปประกอบ; หน้าตาเป็นของเราเอง (กรมท่า + ทอง + ส้มแดง, ป้ายทรงแคปซูล/กล่องเงาแข็ง)
// ระยะที่ 1: ยังไม่ต่อกับ ReelRender.assemble — ดูผลได้ที่ /tplb-test.html
window.ReelTplB = (() => {
  const FONT = '"Leelawadee UI", Tahoma, "Noto Sans Thai", sans-serif';
  const seg = new Intl.Segmenter('th', { granularity: 'word' });
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;
  const easeBack = (x) => { const p = clamp01(x) - 1; return 1 + 2.70158 * p ** 3 + 1.70158 * p ** 2; };
  const MARGIN = 44;
  const METER_COLORS = ['#ffd36b', '#ffc15a', '#ff9f43', '#ff7a4d', '#ff5a4d'];

  const palette = (theme) => ({
    ink: '#0b1020', navy: (theme && theme.colors && theme.colors[1]) || '#1b2550',
    gold: (theme && theme.accent) || '#ffd36b', coral: '#ff5a4d', cream: '#f6f1e4', white: '#ffffff',
  });

  // "ข้อความ {{คำเน้น}} ต่อ" → [{ t, hl }]
  function parseMarkup(text) {
    const out = [];
    String(text || '').split(/(\{\{.+?\}\})/).forEach((part) => {
      if (!part) return;
      const m = /^\{\{(.+)\}\}$/.exec(part);
      out.push({ t: m ? m[1] : part, hl: !!m });
    });
    return out;
  }

  // จัดบรรทัดตามคำ (ตัดคำไทยด้วย Intl.Segmenter) โดยคงสถานะไฮไลต์ของแต่ละคำ — ctx.font ต้องตั้งไว้ก่อนเรียก
  function layoutRich(ctx, text, maxW) {
    const toks = [];
    parseMarkup(text).forEach((p) => { for (const s of seg.segment(p.t)) toks.push({ w: s.segment, hl: p.hl }); });
    const lines = [];
    let cur = { toks: [], width: 0 };
    for (const tk of toks) {
      tk.width = ctx.measureText(tk.w).width;
      if (cur.toks.length && cur.width + tk.width > maxW && tk.w.trim()) { lines.push(cur); cur = { toks: [], width: 0 }; }
      if (!cur.toks.length && !tk.w.trim()) continue; // ไม่ขึ้นบรรทัดด้วยช่องว่าง
      cur.toks.push(tk); cur.width += tk.width;
    }
    if (cur.toks.length) lines.push(cur);
    lines.forEach((l) => { while (l.toks.length && !l.toks[l.toks.length - 1].w.trim()) { l.width -= l.toks.pop().width; } });
    return lines;
  }

  function fitFont(ctx, weight, size, minSize, text, maxW) {
    let s = size;
    ctx.font = `${weight} ${s}px ${FONT}`;
    while (s > minSize && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${FONT}`; }
    return s;
  }

  // ---------- ส่วนหัว: ป้ายตอน (ซ้าย) + มิเตอร์ระดับสปอยล์ (ขวา) ----------
  function drawEpChip(ctx, o, pal, lt) {
    if (!o.epLabel) return;
    const h = 64, x = MARGIN, y = 150, maxW = 560;
    ctx.save();
    ctx.globalAlpha = easeOut(lt / 0.4);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    fitFont(ctx, 800, 36, 24, o.epLabel, maxW - 56);
    const w = Math.min(maxW, ctx.measureText(o.epLabel).width + 56);
    ctx.fillStyle = 'rgba(11,16,32,.9)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
    ctx.fillStyle = pal.gold;
    ctx.beginPath(); ctx.arc(x + 26, y + h / 2, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.white;
    ctx.fillText(o.epLabel, x + 46, y + h / 2 + 2);
    ctx.restore();
  }

  function drawMeter(ctx, o, level, prev, pal, lt) {
    if (!(level >= 0) || o.meter === false) return;
    const w = 322, h = 72, x = ctx.canvas.width - MARGIN - w, y = 146;
    ctx.save();
    ctx.globalAlpha = easeOut(lt / 0.4);
    ctx.fillStyle = 'rgba(11,16,32,.9)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `700 22px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.fillText(o.meterLabel || 'ระดับสปอยล์', x + 22, y + 20);
    const pw = 46, ph = 16, gap = 8, px = x + 22;
    for (let i = 0; i < 5; i++) {
      const on = i < level, fresh = on && i >= prev; // ช่องที่เพิ่งติดในช็อตนี้ป๊อปเข้า
      const k = fresh ? easeBack((lt - 0.15) / 0.3) : 1;
      ctx.fillStyle = on ? METER_COLORS[i] : 'rgba(255,255,255,.2)';
      const ah = ph * (fresh ? Math.max(0.2, k) : 1);
      ctx.beginPath(); ctx.roundRect(px + i * (pw + gap), y + 44 + (ph - ah) / 2, pw, ah, ph / 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- แถบบรรยายด้านบน ----------
  function drawNarrStrip(ctx, text, lt, dur, pal) {
    if (!text) return;
    const W = ctx.canvas.width;
    ctx.save();
    const a = Math.min(easeOut((lt - 0.05) / 0.25), clamp01((dur - lt) / 0.25));
    if (a <= 0) { ctx.restore(); return; }
    ctx.globalAlpha = a;
    ctx.font = `800 46px ${FONT}`;
    const lines = layoutRich(ctx, text.replace(/\{\{|\}\}/g, ''), W - 2 * MARGIN - 64).slice(0, 3);
    const lh = 62, h = lines.length * lh + 34, x = MARGIN, y = 250, w = W - 2 * MARGIN;
    ctx.fillStyle = 'rgba(8,10,26,.86)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 20); ctx.fill();
    ctx.fillStyle = pal.white; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l.toks.map((t) => t.w).join(''), x + 32, y + 17 + i * lh));
    ctx.restore();
  }

  // ---------- กล่องข้อความล่าง (ไฮไลต์ทอง) ----------
  function drawCaptionBox(ctx, text, lt, pal) {
    if (!text) return;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const k = easeBack((lt - 0.3) / 0.35);
    if (k <= 0.01) return;
    ctx.save();
    ctx.font = `900 64px ${FONT}`;
    const lines = layoutRich(ctx, text, W - 2 * MARGIN - 150).slice(0, 3);
    const lh = 86, padX = 46, padY = 34;
    const bw = Math.min(W - 2 * MARGIN, Math.max(...lines.map((l) => l.width)) + padX * 2), bh = lines.length * lh + padY * 2;
    const cx = W / 2, cy = H - 330 - bh / 2 + (1 - Math.min(k, 1)) * 60;
    ctx.translate(cx, cy); ctx.rotate(-0.02); ctx.scale(0.88 + 0.12 * k, 0.88 + 0.12 * k);
    ctx.globalAlpha = clamp01(k * 1.4);
    ctx.fillStyle = pal.ink; // เงาแข็ง
    ctx.beginPath(); ctx.roundRect(-bw / 2 + 12, -bh / 2 + 12, bw, bh, 22); ctx.fill();
    ctx.fillStyle = pal.cream; ctx.strokeStyle = pal.ink; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 22); ctx.fill(); ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      let x = -l.width / 2;
      const y = -bh / 2 + padY + lh * i + lh / 2;
      for (const tk of l.toks) {
        if (tk.hl) { ctx.fillStyle = pal.gold; ctx.beginPath(); ctx.roundRect(x - 6, y - 38, tk.width + 12, 76, 12); ctx.fill(); }
        ctx.fillStyle = pal.ink; ctx.fillText(tk.w, x, y + 3);
        x += tk.width;
      }
    });
    ctx.restore();
  }

  // ---------- คำเสียง/อารมณ์ตัวใหญ่ ----------
  function drawSfx(ctx, text, lt, dur, pal, shotIndex = 0) {
    if (!text) return;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const k = easeBack((lt - 0.12) / 0.25), out = clamp01((dur - lt) / 0.25);
    if (k <= 0.01 || out <= 0) return;
    ctx.save();
    const size = fitFont(ctx, 900, 200, 80, text, W - 200);
    const shake = lt < 0.5 ? Math.sin(lt * 70) * 6 * (1 - lt / 0.5) : 0;
    const rot = (shotIndex % 2 ? 1 : -1) * 0.12;
    ctx.translate(W / 2 + shake, H * 0.34); ctx.rotate(rot); ctx.scale(k, k);
    ctx.globalAlpha = out;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.strokeStyle = pal.ink; ctx.lineWidth = size * 0.17; ctx.strokeText(text, 0, 0);
    ctx.strokeStyle = pal.white; ctx.lineWidth = size * 0.07; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = pal.coral; ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // รวมชั้นทับของ 1 ช็อต — shot: { narration, caption, sfx, meter, meterPrev, index }, lt = วินาทีตั้งแต่เริ่มช็อต
  // o: { epLabel, meterLabel, theme, narrOnTop } — ชั้นล่างสุด (ภาพ) ผู้เรียกวาดเอง
  function drawShotOverlay(ctx, shot, lt, dur, o = {}) {
    const pal = palette(o.theme);
    drawEpChip(ctx, o, pal, lt);
    drawMeter(ctx, o, shot.meter, shot.meterPrev === undefined ? shot.meter : shot.meterPrev, pal, lt);
    if (o.narrOnTop !== false) drawNarrStrip(ctx, shot.narration, lt, dur, pal);
    drawSfx(ctx, shot.sfx, lt, dur, pal, shot.index || 0);
    drawCaptionBox(ctx, shot.caption, lt, pal);
  }

  // ---------- เส้นความเร็วแบบมังงะ (พื้นหลังฉากเร่ง) ----------
  function drawSpeedLines(ctx, t, { color = '#fff', alpha = 0.9, cx, cy, inner = 0.2 } = {}) {
    const W = ctx.canvas.width, H = ctx.canvas.height, X = cx ?? W / 2, Y = cy ?? H / 2, R = Math.hypot(W, H);
    const step = Math.floor(t * 12); // กระพริบ 12 ครั้ง/วิ
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = alpha;
    for (let i = 0; i < 64; i++) {
      const r1 = Math.sin((i + 1) * 91.7 + step * 13.3), r2 = Math.sin((i + 1) * 37.1 + step * 7.9);
      const a = (i / 64) * Math.PI * 2 + r1 * 0.04, half = 0.008 + 0.018 * Math.abs(r2);
      const r0 = Math.min(W, H) * (inner + 0.1 * Math.abs(r1));
      ctx.beginPath();
      ctx.moveTo(X + Math.cos(a) * r0, Y + Math.sin(a) * r0);
      ctx.lineTo(X + Math.cos(a - half) * R, Y + Math.sin(a - half) * R);
      ctx.lineTo(X + Math.cos(a + half) * R, Y + Math.sin(a + half) * R);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- เลย์เอาต์ "แผ่นภาพ": พื้นครีมลายจุด + ภาพในกรอบ (กล่องข้อความอยู่ใต้กรอบ) ----------
  function plateRect(W, H) { const w = W - 2 * 76; return { x: 76, y: 390, w, h: Math.min(Math.round(w * 1.05), H - 390 - 520) }; }
  function drawPlateBackdrop(ctx, pal) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = pal.cream; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(11,16,32,.07)';
    for (let y = 12; y < H; y += 28) for (let x = (y / 28) % 2 ? 26 : 12; x < W; x += 28) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
  }
  function drawPlateFrame(ctx, r, pal) {
    ctx.save();
    ctx.strokeStyle = pal.ink; ctx.lineWidth = 8; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
  function plateShadow(ctx, r, pal) { ctx.fillStyle = pal.ink; ctx.fillRect(r.x + 14, r.y + 14, r.w, r.h); }

  // ---------- การ์ดปก / การ์ดจบ (วาดล้วน) ----------
  // o.card: { word, title, ep, sub } สำหรับปก | { title, line, credit } สำหรับจบ
  function drawStripes(ctx, lt, pal) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = pal.ink; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.fillStyle = pal.gold; ctx.globalAlpha = 0.1;
    const off = (lt * 60) % 160;
    for (let x = -H - 160; x < W + 160; x += 160) {
      ctx.beginPath(); ctx.moveTo(x + off, H); ctx.lineTo(x + off + 70, H); ctx.lineTo(x + off + 70 + H, 0); ctx.lineTo(x + off + H, 0); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  const pop = (lt, delay) => easeBack((lt - delay) / 0.3);

  function drawWarnTriangle(ctx, cx, cy, s, pal) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0.92, 0.6); ctx.lineTo(-0.92, 0.6); ctx.closePath();
    ctx.fillStyle = pal.gold; ctx.strokeStyle = pal.gold; ctx.lineWidth = 0.14; ctx.fill(); ctx.stroke();
    ctx.fillStyle = pal.ink; ctx.beginPath(); ctx.roundRect(-0.07, -0.42, 0.14, 0.62, 0.06); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0.37, 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawCard(ctx, kind, lt, dur, o = {}) {
    const W = ctx.canvas.width, H = ctx.canvas.height, pal = palette(o.theme), c = o.card || {};
    drawStripes(ctx, lt, pal);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const out = clamp01((dur - lt) / 0.2);
    ctx.globalAlpha = out;
    if (kind === 'cover') {
      let k = pop(lt, 0);
      if (k > 0.01) { drawWarnTriangle(ctx, W / 2, H * 0.28, 120 * k, pal); }
      k = pop(lt, 0.1);
      if (k > 0.01) {
        ctx.save(); ctx.translate(W / 2, H * 0.42); ctx.scale(k, k);
        const s = fitFont(ctx, 900, 170, 90, c.word || 'สปอยล์', W - 160);
        ctx.strokeStyle = pal.coral; ctx.lineWidth = s * 0.12; ctx.strokeText(c.word || 'สปอยล์', 0, 0);
        ctx.fillStyle = pal.gold; ctx.fillText(c.word || 'สปอยล์', 0, 0); ctx.restore();
      }
      k = pop(lt, 0.2);
      if (k > 0.01 && c.title) {
        ctx.save(); ctx.translate(W / 2, H * 0.53); ctx.scale(k, k);
        fitFont(ctx, 800, 88, 48, c.title, W - 140);
        ctx.fillStyle = pal.white; ctx.fillText(c.title, 0, 0); ctx.restore();
      }
      k = pop(lt, 0.3);
      if (k > 0.01 && c.ep) {
        ctx.save(); ctx.translate(W / 2, H * 0.63); ctx.scale(k, k);
        fitFont(ctx, 900, 200, 90, c.ep, W - 140);
        ctx.fillStyle = pal.white; ctx.fillText(c.ep, 0, 0); ctx.restore();
      }
      k = pop(lt, 0.42);
      if (k > 0.01 && c.sub) {
        ctx.save(); ctx.translate(W / 2, H * 0.74); ctx.scale(k, k);
        ctx.font = `800 54px ${FONT}`;
        const w = Math.min(W - 120, ctx.measureText(c.sub).width + 90);
        ctx.fillStyle = pal.coral; ctx.beginPath(); ctx.roundRect(-w / 2, -48, w, 96, 48); ctx.fill();
        ctx.fillStyle = pal.white; ctx.fillText(c.sub, 0, 3); ctx.restore();
      }
    } else { // end
      let k = pop(lt, 0.05);
      if (k > 0.01) {
        ctx.save(); ctx.translate(W / 2, H * 0.4); ctx.scale(k, k);
        const t = c.endTitle || 'ภาคต่อ';
        const s = fitFont(ctx, 900, 150, 80, t, W - 160);
        ctx.strokeStyle = pal.coral; ctx.lineWidth = s * 0.12; ctx.strokeText(t, 0, 0);
        ctx.fillStyle = pal.gold; ctx.fillText(t, 0, 0); ctx.restore();
      }
      k = pop(lt, 0.25);
      if (k > 0.01 && c.line) {
        ctx.save(); ctx.globalAlpha = out * clamp01(k); ctx.font = `800 62px ${FONT}`;
        const lines = layoutRich(ctx, c.line, W - 200).slice(0, 3);
        ctx.fillStyle = pal.white;
        lines.forEach((l, i) => ctx.fillText(l.toks.map((t) => t.w).join(''), W / 2, H * 0.52 + i * 84));
        ctx.restore();
      }
      if (c.credit) {
        ctx.globalAlpha = out * easeOut((lt - 0.5) / 0.4); ctx.font = `600 30px ${FONT}`;
        const lines = layoutRich(ctx, c.credit, W - 200).slice(0, 3);
        ctx.fillStyle = 'rgba(255,255,255,.72)';
        lines.forEach((l, i) => ctx.fillText(l.toks.map((t) => t.w).join(''), W / 2, H * 0.86 + i * 42));
      }
    }
    ctx.restore();
  }

  return { palette, parseMarkup, layoutRich, drawShotOverlay, drawCard, drawSpeedLines, plateRect, drawPlateBackdrop, drawPlateFrame, plateShadow };
})();
