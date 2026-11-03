// เรนเดอร์คลิป 9:16 ในเบราว์เซอร์: วาดฉากลง canvas แล้วอัดด้วย MediaRecorder (ไม่ต้องใช้ ffmpeg)
// อัดแบบเรียลไทม์ — ความยาวไฟล์ = เวลาที่ใช้เรนเดอร์ และต้องเปิดแท็บนี้ค้างไว้ (แท็บเบื้องหลังจะถูกเบราว์เซอร์หน่วง)
window.ReelRender = (() => {
  const W = 1080, H = 1920, FPS = 30;
  const FONT = '"Leelawadee UI", Tahoma, "Noto Sans Thai", sans-serif';
  const MIMES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  const seg = new Intl.Segmenter('th', { granularity: 'word' });

  function pickMime() {
    return window.MediaRecorder ? (MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '') : '';
  }

  // สูตรเดียวกับฝั่งเซิร์ฟเวอร์ (lib/render.js): 0.11 วิ/ตัวอักษร + 1.2 วิ ขอบ 3–8 วิ
  const sceneSeconds = (t) => Math.min(8, Math.max(3, t.length * 0.11 + 1.2));

  function parseScenes(script) {
    return script.split('\n').map((s) => s.trim()).filter(Boolean).map((line) => {
      const parts = line.split('|').map((s) => s.trim()).filter(Boolean);
      return parts.length > 1
        ? { head: parts[0], body: parts.slice(1).join(' '), say: `${parts[0]} ${parts.slice(1).join(' ')}`, dur: sceneSeconds(line) }
        : { head: null, body: parts[0] || line, say: parts[0] || line, dur: sceneSeconds(line) };
    });
  }

  function wrap(ctx, text, maxW) {
    const lines = [];
    let cur = '';
    for (const { segment } of seg.segment(text)) {
      if (ctx.measureText(cur + segment).width > maxW && cur.trim()) {
        lines.push(cur.trim());
        cur = segment.trimStart();
      } else cur += segment;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }

  // ตำแหน่งดาวกำหนด seed ต่อฉาก — เรนเดอร์ซ้ำได้ผลเหมือนเดิม
  function stars(seed) {
    let s = (seed * 2654435761) % 4294967296 || 1;
    const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    return Array.from({ length: 46 }, () => ({ x: rnd() * W, y: rnd() * H, r: 2 + rnd() * 5, ph: rnd() * 6.28 }));
  }

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const ease = (x) => 1 - Math.pow(1 - clamp01(x), 3);
  const back = (x, s = 1.9) => { x = clamp01(x); return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };

  // ข้อความแบบ "สติกเกอร์" (ได้แรงบันดาลใจจากสกิล app-promo-video): ตัวหนา + ขอบเข้มหนา + เงานุ่ม — อ่านง่ายบนทุกพื้นหลัง
  function drawLines(ctx, lines, cx, y, size, color) {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    lines.forEach((l, k) => {
      const ly = y + k * size * 1.28;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = size * 0.2; ctx.shadowOffsetY = size * 0.09;
      ctx.strokeStyle = 'rgba(8,10,26,.92)'; ctx.lineWidth = size * 0.17;
      ctx.strokeText(l, cx, ly);
      ctx.restore();
      ctx.fillStyle = color;
      ctx.fillText(l, cx, ly);
    });
    return lines.length * size * 1.28;
  }

  // คลื่นด้านล่างจอ ไหวช้า ๆ ตลอดคลิป (สีเน้นของธีม)
  function drawWaves(ctx, theme, t) {
    const path = (off, lift) => {
      const a = Math.sin(t * 0.7 + off) * 26, y0 = H - W * 0.2 - lift;
      ctx.beginPath();
      ctx.moveTo(0, y0 + a);
      ctx.bezierCurveTo(W * 0.3, y0 + W * 0.13 + a, W * 0.62, y0 + W * 0.15 - a, W, y0 + W * 0.065 - a);
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    };
    ctx.save();
    ctx.fillStyle = theme.accent;
    ctx.globalAlpha = 0.16; path(1.7, 60); ctx.fill();
    ctx.globalAlpha = 0.28; path(0, 0); ctx.fill();
    ctx.restore();
  }

  // ท่าเข้าของข้อความ: zoom (ซูมออกมาจากใกล้) / pop (เด้งขยาย) / slide (สไลด์เข้าพร้อมเบลอ) — วนตามลำดับฉาก
  const KINDS = ['zoom', 'pop', 'slide'];
  function enter(kind, p) {
    const e = ease(p), a = Math.min(1, p * 8);
    if (kind === 'zoom') return { s: 2.4 - 1.4 * e, dx: 0, a, blur: (1 - e) * 10 };
    if (kind === 'pop') return { s: 0.35 + 0.65 * back(p), dx: 0, a, blur: 0 };
    return { s: 1, dx: (1 - e) * W * 0.9, a, blur: (1 - e) * 18 };
  }
  const ENTER_DUR = 0.5;
  function block(ctx, kind, lt, delay, cy, draw) {
    const en = enter(kind, clamp01((lt - delay) / ENTER_DUR));
    if (en.a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= en.a;
    ctx.translate(W / 2 + en.dx, cy); ctx.scale(en.s, en.s); ctx.translate(-W / 2, -cy);
    if (en.blur > 0.5) ctx.filter = `blur(${en.blur}px)`;
    draw();
    ctx.restore();
  }

  // ป้ายสรุป/CTA ท้ายคลิป: แคปซูลไล่สีเด้งขึ้นมา
  function drawPill(ctx, theme, lines, cx, y, size) {
    ctx.font = `800 ${size}px ${FONT}`;
    const w = Math.min(W - 60, Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 2.2);
    const h = lines.length * size * 1.28 + size * 0.9, x = cx - w / 2, r = h / 2 > 80 ? 80 : h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 14;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, theme.accent); g.addColorStop(1, theme.colors[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.lineJoin = 'round';
    lines.forEach((l, k) => {
      const ly = y + size * 0.45 + k * size * 1.28;
      ctx.strokeStyle = 'rgba(8,10,26,.85)'; ctx.lineWidth = size * 0.13; ctx.strokeText(l, cx, ly);
      ctx.fillStyle = '#fff'; ctx.fillText(l, cx, ly);
    });
    ctx.restore();
    return h;
  }

  // พื้นหลังเป็นรูปจริง (ถ้ามี): เต็มจอแบบ cover + ซูม/แพนช้า ๆ + ฟิลเตอร์มืดให้ตัวหนังสืออ่านง่าย (รูปต่อฉาก: วนตามลำดับ)
  function drawPhoto(ctx, photo, lt, dur) {
    const im = photo.img, p = clamp01(lt / Math.max(0.1, dur));
    const k = Math.max(W / im.width, H / im.height) * (1.06 + 0.08 * p), w = im.width * k, h = im.height * k;
    ctx.drawImage(im, -(w - W) * (0.2 + 0.6 * p), -(h - H) * (0.5 - 0.2 * p), w, h);
    ctx.fillStyle = 'rgba(6,8,22,.46)'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.4)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.45, W, H * 0.55);
  }

  // ป้ายตอน/หมวด มุมขวาบน (เช่น “ตอนที่ 20”): แคปซูลไล่สีเล็ก ๆ ขอบเข้ม เห็นชัดแต่ไม่แย่งเนื้อหา
  function drawBadge(ctx, theme, text, t) {
    ctx.save();
    ctx.font = `800 40px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = Math.min(W - 300, ctx.measureText(text).width + 64), h = 72, x = W - 44 - w, y = 140;
    ctx.globalAlpha = 0.97 * ease(t / 0.6);
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, theme.accent); g.addColorStop(1, theme.colors[1]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(8,10,26,.8)'; ctx.strokeText(text, x + w / 2, y + h / 2 + 2);
    ctx.fillStyle = '#fff'; ctx.fillText(text, x + w / 2, y + h / 2 + 2);
    ctx.restore();
  }

  // logo = ภาพโลโก้ที่โหลดแล้ว (หรือ null): ซ้ายบนตลอดคลิป (เลี่ยงขอบล่าง/ขวาที่ Facebook ทับด้วยปุ่ม) และใหญ่ในฉากปิด
  function drawFrame(ctx, scenes, theme, t, starSets, logo, photos, badge) {
    let i = 0, start = 0;
    while (i < scenes.length - 1 && t >= start + scenes[i].dur) { start += scenes[i].dur; i++; }
    const sc = scenes[i], lt = t - start;
    const kind = KINDS[i % KINDS.length], last = scenes.length > 1 && i === scenes.length - 1;

    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, theme.colors[i % 2]);
    g.addColorStop(1, theme.colors[(i + 1) % 2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const photo = photos && photos.length ? photos[i % photos.length] : null;
    if (photo) drawPhoto(ctx, photo, lt, sc.dur);
    if (theme.id === 'stars' && !photo) {
      for (const st of starSets[i]) {
        const a = 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.2 + st.ph));
        ctx.globalAlpha = a;
        ctx.fillStyle = theme.accent;
        ctx.beginPath(); // ประกายสี่แฉกเล็ก ๆ
        ctx.moveTo(st.x, st.y - st.r * 2); ctx.lineTo(st.x + st.r * 0.5, st.y - st.r * 0.5);
        ctx.lineTo(st.x + st.r * 2, st.y); ctx.lineTo(st.x + st.r * 0.5, st.y + st.r * 0.5);
        ctx.lineTo(st.x, st.y + st.r * 2); ctx.lineTo(st.x - st.r * 0.5, st.y + st.r * 0.5);
        ctx.lineTo(st.x - st.r * 2, st.y); ctx.lineTo(st.x - st.r * 0.5, st.y - st.r * 0.5);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (!photo) drawWaves(ctx, theme, t);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (sc.dur - lt) / 0.3)); // ออกฉากแบบเฟด (เข้าฉากใช้ท่าเข้าของแต่ละบล็อก)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const cx = W / 2, maxW = W - 150;

    if (sc.head) {
      ctx.font = `800 100px ${FONT}`;
      const hl = wrap(ctx, sc.head, maxW);
      const hh = hl.length * 100 * 1.28;
      block(ctx, kind, lt, 0, 780 - hh / 2, () => {
        drawLines(ctx, hl, cx, 780 - hh, 100, theme.accent);
        ctx.fillStyle = theme.accent;
        ctx.fillRect(cx - 100, 810, 200, 6);
      });
      ctx.font = `700 62px ${FONT}`;
      const bl = wrap(ctx, sc.body, maxW), bh = bl.length * 62 * 1.28;
      block(ctx, kind === 'slide' ? 'pop' : 'slide', lt, 0.22, 860 + bh / 2, () => drawLines(ctx, bl, cx, 860, 62, '#fff'));
    } else {
      const hook = i === 0, size = hook ? 92 : 80;
      ctx.font = `800 ${size}px ${FONT}`;
      const lines = wrap(ctx, sc.body, maxW);
      const bh = lines.length * size * 1.28;
      if (last) { // ฉากปิด = ป้าย CTA
        block(ctx, 'pop', lt, 0.1, H / 2, () => drawPill(ctx, theme, lines, cx, (H - bh) / 2 - size * 0.45, size));
      } else {
        block(ctx, kind, lt, 0, (H - bh) / 2 + bh / 2, () => drawLines(ctx, lines, cx, (H - bh) / 2, size, hook ? theme.accent : '#fff'));
      }
    }
    ctx.restore();

    if (badge) drawBadge(ctx, theme, badge, t);
    const creditY = badge ? 228 : 160; // เครดิตภาพเลื่อนลงใต้ป้ายถ้ามีป้าย
    if (photo && photo.credit) { // เครดิตแหล่งภาพ มุมขวาบน (พ้นแถบล่าง/ปุ่มข้างที่ Facebook ทับ)
      ctx.save();
      ctx.font = `600 30px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.9 * ease(t / 0.8);
      ctx.strokeStyle = 'rgba(8,10,26,.85)'; ctx.lineWidth = 6; ctx.strokeText(`ภาพ: ${photo.credit}`, W - 44, creditY);
      ctx.fillStyle = '#fff'; ctx.fillText(`ภาพ: ${photo.credit}`, W - 44, creditY);
      ctx.restore();
    }
    drawLogo(ctx, logo, t);

    // แฟลชขาวคั่นฉาก: สว่างขึ้นก่อนตัดฉาก แล้วจางหลังเข้าฉากใหม่
    let f = 0;
    if (i > 0 && lt < 0.4) f = 1 - lt / 0.4;
    const toNext = sc.dur - lt;
    if (i < scenes.length - 1 && toNext < 0.2) f = Math.max(f, 1 - toNext / 0.2);
    if (f > 0) { ctx.fillStyle = `rgba(255,255,255,${0.88 * f})`; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- เสียง ----------
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const MAKEUP_B = 1.55; // เกนชดเชยหลังคอมเพรสเซอร์ของเทมเพลต B (ปรับตามผลวัดคลิปจริง)
  const VOICE_LEAD = 0.35, VOICE_TAIL = 0.7; // เว้นหัว/ท้ายฉากรอบเสียงพากย์ (วินาที)

  // เพลงพื้นหลังสร้างสดด้วย WebAudio (original ทั้งหมด ไม่มีปัญหาลิขสิทธิ์) — ตั้งเวลาโน้ตทั้งเพลงล่วงหน้า
  function makeMusic(ac, out, kind, total, t0) {
    const bus = ac.createGain();
    bus.connect(out);
    // เดเลย์ป้อนกลับเบา ๆ ให้เสียงมีมิติ
    const delay = ac.createDelay(1), fb = ac.createGain(), wet = ac.createGain();
    delay.delayTime.value = 0.34; fb.gain.value = 0.38; wet.gain.value = 0.32;
    bus.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(out);

    const tone = (midi, at, dur, { type = 'sine', vol = 0.1, attack = 0.04, release = 0.3, detune = 0 } = {}) => {
      if (at >= total) return;
      const o = ac.createOscillator(), g = ac.createGain(), s = t0 + at;
      o.type = type; o.frequency.value = hz(midi); o.detune.value = detune;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + attack);
      g.gain.setValueAtTime(vol, s + Math.max(attack, dur - release));
      g.gain.linearRampToValueAtTime(0, s + dur);
      o.connect(g).connect(bus);
      o.start(s); o.stop(s + dur + 0.05);
    };
    const kick = (at) => {
      if (at >= total) return;
      const o = ac.createOscillator(), g = ac.createGain(), s = t0 + at;
      o.frequency.setValueAtTime(150, s); o.frequency.exponentialRampToValueAtTime(45, s + 0.12);
      g.gain.setValueAtTime(0.5, s); g.gain.exponentialRampToValueAtTime(0.001, s + 0.22);
      o.connect(g).connect(out); o.start(s); o.stop(s + 0.25);
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

    if (kind === 'calm') { // คอร์ดพาดนุ่ม Am–F–C–G ช้า ๆ
      const beat = 60 / 66, chords = [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]];
      for (let bar = 0, at = 0; at < total; bar++, at += beat * 4) {
        const ch = chords[bar % 4];
        ch.forEach((m, k) => tone(m + 12, at, beat * 4.3, { type: 'triangle', vol: 0.055, attack: 1.1, release: 1.4, detune: (k - 1) * 6 }));
        tone(ch[0] - 12, at, beat * 4.2, { vol: 0.12, attack: 0.6, release: 1.2 });
      }
    } else if (kind === 'mystic') { // ดรอนต่ำ + ระฆังเพนทาโทนิกไมเนอร์ (เหมาะคลิปดวง/จักรวาล)
      const scale = [69, 72, 74, 76, 79, 81], beat = 60 / 72;
      tone(45, 0, total, { vol: 0.08, attack: 2, release: 2 });
      tone(52, 0, total, { vol: 0.05, attack: 3, release: 2, detune: 5 });
      for (let at = 1; at < total; at += beat / 2) {
        if (rnd() < 0.62) tone(scale[Math.floor(rnd() * scale.length)], at, 1.8, { vol: 0.07, attack: 0.01, release: 1.7 });
      }
    } else if (kind === 'upbeat') { // 108 bpm: กลอง + เบส + พลักอาร์เปจโจ C–G–Am–F
      const beat = 60 / 108, roots = [48, 43, 45, 41], tri = [[0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7]];
      for (let n = 0, at = 0; at < total; n++, at += beat) {
        const bar = Math.floor(n / 4) % 4, root = roots[bar];
        kick(at);
        tone(root, at, beat * 0.9, { type: 'triangle', vol: 0.16, attack: 0.01, release: 0.2 });
        for (let h = 0; h < 2; h++) {
          const note = root + 24 + tri[bar][(n * 2 + h) % 3];
          tone(note, at + h * beat / 2, beat * 0.45, { type: 'triangle', vol: 0.06, attack: 0.005, release: 0.25 });
        }
      }
    }
  }

  // เสียงเอฟเฟกต์สังเคราะห์สด: whoosh (ตอนตัดฉาก) / pop (ป้ายเด้ง) / ding (ปิดคลิป)
  function sfx(ac, out, kind, at, vol = 1) {
    const g = ac.createGain();
    g.connect(out);
    if (kind === 'whoosh') {
      const len = Math.floor(ac.sampleRate * 0.6), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(), bp = ac.createBiquadFilter();
      src.buffer = buf; bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(350, at); bp.frequency.exponentialRampToValueAtTime(5000, at + 0.5);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.9 * vol, at + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.58);
      src.connect(bp).connect(g); src.start(at); src.stop(at + 0.6);
    } else if (kind === 'hit') { // กระแทก: ซับเบสตกความถี่ + ลมหายใจสั้น ๆ (ตอนคำเสียงตัวใหญ่เด้ง)
      const o = ac.createOscillator(), len = Math.floor(ac.sampleRate * 0.12), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
      o.type = 'sine'; o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.28);
      g.gain.setValueAtTime(0.55 * vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
      const n = ac.createBufferSource(), ng = ac.createGain();
      n.buffer = buf; ng.gain.value = 0.35 * vol; n.connect(ng).connect(g);
      o.connect(g); o.start(at); o.stop(at + 0.4); n.start(at); n.stop(at + 0.15);
    } else if (kind === 'pop') {
      const o = ac.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(380, at); o.frequency.exponentialRampToValueAtTime(1400, at + 0.14);
      g.gain.setValueAtTime(0.55 * vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
      o.connect(g); o.start(at); o.stop(at + 0.2);
    } else if (kind === 'ding') {
      [[1318, 0.32, 5], [1976, 0.2, 7], [2637, 0.1, 9]].forEach(([fq, v, dk]) => {
        const o = ac.createOscillator(), gg = ac.createGain();
        o.type = 'sine'; o.frequency.value = fq;
        gg.gain.setValueAtTime(v * vol, at); gg.gain.exponentialRampToValueAtTime(0.0001, at + dk * 0.12 + 0.3);
        o.connect(gg).connect(out); o.start(at); o.stop(at + 1.1);
      });
    }
  }

  // ปรับเวลาต่อฉากให้รวมใกล้ target: สั้นไป → ยืดตามสัดส่วน (ไม่เกิน 12 วิ/ฉาก), ยาวไป → หดส่วนที่เกินขั้นต่ำ (mins) ของแต่ละฉาก
  function fitDurations(scenes, mins, target) {
    const sum = () => scenes.reduce((a, s) => a + s.dur, 0);
    if (sum() < target) {
      for (let k = 0; k < 5 && sum() < target - 0.05; k++) {
        const f = target / sum();
        scenes.forEach((s) => { s.dur = Math.min(12, s.dur * f); });
      }
    } else if (sum() > target) {
      const slack = scenes.map((s, i) => Math.max(0, s.dur - mins[i]));
      const free = slack.reduce((a, b) => a + b, 0);
      if (free > 0) {
        const r = Math.min(1, (sum() - target) / free);
        scenes.forEach((s, i) => { s.dur -= slack[i] * r; });
      }
    }
  }

  async function decode(ac, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`โหลดเสียงไม่สำเร็จ (${res.status})`);
    return ac.decodeAudioData(await res.arrayBuffer());
  }

  // ---------- แกนร่วม: ใช้ทั้ง render() (คลิปเร็ว) และ assemble() (รวมช็อตของเรื่อง) ----------
  // โหลดรูป — โหลดไม่ได้/ขนาดศูนย์ได้ null (ผู้เรียกข้ามไปเอง ไม่ล้มทั้งงาน)
  const loadImage = (url) => new Promise((resolve) => {
    if (!url) return resolve(null);
    const im = new Image();
    im.onload = () => resolve(im.width > 0 ? im : null);
    im.onerror = () => resolve(null);
    im.src = url;
  });

  // เสียงพากย์ต่อบรรทัด (ขอ WAV จากเซิร์ฟเวอร์ครั้งเดียวทั้งชุด) → AudioBuffer ตรงตำแหน่ง, บรรทัดว่างได้ null
  // ผู้ใช้กดหยุด (opts.signal) → โยน error ข้อความเดียวกับฝั่ง api() ให้หน้าเว็บแสดงแบบไม่ใช่ข้อผิดพลาด
  const STOPPED = 'หยุดแล้ว';
  const checkStop = (signal) => { if (signal?.aborted) throw new Error(STOPPED); };

  async function ttsBuffers(ac, lines, onStatus, label, signal, tone = '') { // tone: สไตล์คำบรรยายของโปรเจกต์เรื่อง → น้ำเสียง (Gemini)
    const out = lines.map(() => null);
    const idx = lines.map((s, i) => (s && s.trim() ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return out;
    onStatus?.(label);
    let r;
    try {
      r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: idx.map((i) => lines[i]), ...(tone ? { tone } : {}) }), signal });
    } catch (e) { if (e.name === 'AbortError') throw new Error(STOPPED); throw e; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `สร้างเสียงพากย์ไม่สำเร็จ (${r.status})`);
    const bufs = await Promise.all(data.files.map((u) => decode(ac, u)));
    idx.forEach((i, k) => { out[i] = bufs[k]; });
    return out;
  }

  // เพลงจากไฟล์ของผู้ใช้ ('file:ชื่อ') ต้องโหลดก่อน; เพลงสังเคราะห์ไม่ต้อง (ได้ null)
  async function loadMusic(ac, music, onStatus) {
    if (!music || !music.startsWith('file:')) return null;
    onStatus?.('กำลังโหลดเพลง…');
    return decode(ac, `/music/${encodeURIComponent(music.slice(5))}`);
  }
  // เพลงพื้นหลัง: ค่อยดังขึ้น 1 วิแรก คงระดับ แล้วค่อยเบาลงช่วง 1.5 วิท้าย
  function scheduleMusic(ac, dest, { music, buf, total, ta, level }) {
    if (!music || music === 'none') return;
    const mg = ac.createGain();
    mg.gain.setValueAtTime(0, ta);
    mg.gain.linearRampToValueAtTime(level, ta + 1);
    mg.gain.setValueAtTime(level, ta + Math.max(1, total - 1.5));
    mg.gain.linearRampToValueAtTime(0, ta + total);
    mg.connect(dest);
    if (buf) {
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.connect(mg); src.start(ta); src.stop(ta + total + 0.1);
    } else {
      makeMusic(ac, mg, music, total, ta);
    }
  }
  // เสียงพากย์แต่ละฉากเริ่มหลังต้นฉาก VOICE_LEAD วิ (starts[i] = เวลาเริ่มฉาก i)
  function scheduleVoices(ac, dest, voices, starts, ta) {
    voices.forEach((b, i) => {
      if (!b) return;
      const src = ac.createBufferSource();
      src.buffer = b; src.connect(dest); src.start(ta + starts[i] + VOICE_LEAD);
    });
  }

  // ลายน้ำโลโก้เล็ก ๆ มุมซ้ายบน โปร่งแสง ทุกฉาก (ไม่เด่นกว่าเนื้อหา)
  // ข้อความแนะนำสินค้า (คลิปสินค้า Meta AI): ชิดซ้ายช่วงบน ตัวหนานุ่ม ขาว + ชมพูพาสเทล เงาบาง ๆ ไม่มีขอบหนา ค่อย ๆ ขึ้นทีละบรรทัด
  // ใช้ฟอนต์ LINE Seed Sans TH ถ้าติดตั้งในเครื่อง (ตามสเปก) ไม่มีก็ใช้ฟอนต์ไทยของ Windows
  const INTRO_FONT = `"LINE Seed Sans TH", "LINESeedSansTH", ${FONT}`;
  function drawIntro(ctx, intro, t, CW) {
    const x = Math.round(CW * 0.067), maxW = CW - x * 2;
    let y = Math.round(CW * 0.2);
    const rows = [
      { text: intro.kicker || 'Introducing ♡', size: Math.round(CW * 0.06), color: intro.accent || '#F3B6D5', weight: 800 },
      { text: intro.lead || 'ขอแนะนำ', size: Math.round(CW * 0.085), color: '#FFFFFF', weight: 900 },
      { text: intro.name || '', size: Math.round(CW * 0.095), color: '#FFFFFF', weight: 900 },
    ];
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    rows.forEach((r, k) => {
      if (!r.text) return;
      const a = Math.max(0, Math.min(1, (t - (intro.start ?? 0.4) - k * 0.35) / 0.5)); // fade-in ทีละบรรทัด
      ctx.font = `${r.weight} ${r.size}px ${INTRO_FONT}`;
      const lines = k === 2 ? wrap(ctx, r.text, maxW).slice(0, 3) : [r.text];
      for (const l of lines) {
        if (a > 0) {
          ctx.globalAlpha = a;
          ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = r.size * 0.25; ctx.shadowOffsetY = r.size * 0.06;
          ctx.fillStyle = r.color;
          ctx.fillText(l, x, y + (1 - a) * r.size * 0.25); // ลอยขึ้นนิด ๆ ตอนปรากฏ
        }
        y += r.size * 1.22;
      }
      y += r.size * 0.12;
    });
    ctx.restore();
  }

  function drawLogo(ctx, logo, t) {
    if (!logo) return;
    const lw = 130, lh = lw * logo.height / logo.width;
    ctx.save();
    ctx.globalAlpha = 0.68 * ease(t / 0.8);
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.drawImage(logo, 40, 150, lw, lh);
    ctx.restore();
  }

  // ตัวอัด: แทร็กเสียงเงียบ (Reels ต้องมีเสียง) + captureStream + MediaRecorder + ลูปวาดตามเวลาจริง → { blob, mime }
  // เรียกหลังตั้งเวลาเสียงทั้งหมดไว้ที่ ta = ac.currentTime + lead แล้ว; draw(t) วาดเฟรม ณ วินาทีที่ t; ปิด AudioContext ให้เมื่อจบ
  async function record({ ac, dest, canvas, mime, total, lead, draw, onProgress, onStop, signal }) {
    if (signal?.aborted) { closeAc(ac); throw new Error(STOPPED); }
    const osc = ac.createOscillator(), silent = ac.createGain();
    silent.gain.value = 0;
    osc.connect(silent).connect(dest);
    osc.start();
    const stream = canvas.captureStream(FPS);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve, reject) => { rec.onstop = resolve; rec.onerror = (e) => reject(e.error || new Error('อัดวิดีโอล้มเหลว')); });

    draw(0);
    rec.start(1000);
    const t0 = performance.now() + lead * 1000;
    let aborted = false;
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (signal?.aborted) { aborted = true; clearInterval(timer); resolve(); return; } // กดหยุดกลางคัน: ปิดตัวอัดแล้วทิ้งผล
        const t = Math.max(0, (performance.now() - t0) / 1000);
        if (t >= total) { clearInterval(timer); resolve(); return; }
        draw(t);
        onProgress?.(t / total);
      }, 1000 / FPS);
    });
    if (!aborted) {
      draw(total - 0.001);
      await new Promise((r) => setTimeout(r, 250));
    }
    onStop?.();
    rec.stop();
    await stopped;
    osc.stop();
    ac.close();
    if (aborted) throw new Error(STOPPED);
    const type = mime.split(';')[0];
    return { blob: new Blob(chunks, { type }), mime: type };
  }

  // ภาพหน้าปกเล็ก (กว้าง 270 JPEG) จากสิ่งที่วาดอยู่บน canvas ตอนนี้ — คลังใช้โชว์แทนการโหลดวิดีโอ
  function thumbOf(canvas) {
    const tc = document.createElement('canvas');
    tc.width = 270; tc.height = Math.round(270 * canvas.height / canvas.width);
    tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
    return new Promise((resolve) => tc.toBlob(resolve, 'image/jpeg', 0.8));
  }

  // ปิด AudioContext ถ้ายังเปิด (ใช้ตอนล้มกลางทาง ก่อนถึงตัวอัด)
  const closeAc = (ac) => { if (ac.state !== 'closed') ac.close().catch(() => {}); };

  // opts: { canvas?, onProgress?(0..1), onStatus?(text), voice?, music?, target? (วินาที) } → { blob, mime, duration, thumb, note }
  async function render(clip, theme, opts = {}) {
    const mime = pickMime();
    if (!mime) throw new Error('เบราว์เซอร์นี้อัดวิดีโอไม่ได้ — ใช้ Chrome หรือ Edge');
    const scenes = parseScenes(clip.script || '');
    const badge = (clip.badge || '').trim();
    if (!scenes.length) throw new Error('ยังไม่มีสคริปต์');

    const ac = new AudioContext({ sampleRate: 48000 });
    await ac.resume();
    const dest = ac.createMediaStreamDestination();

    // เสียงพากย์: ขอ WAV ต่อฉากจากเซิร์ฟเวอร์ แล้วขยายความยาวฉากให้พอดีกับเสียง
    let voices = [];
    if (opts.voice) {
      try { voices = await ttsBuffers(ac, scenes.map((s) => s.say), opts.onStatus, 'กำลังสร้างเสียงพากย์…', opts.signal, opts.tone || ''); } catch (e) { closeAc(ac); throw e; }
      voices.forEach((v, i) => { if (v) scenes[i].dur = Math.max(scenes[i].dur, v.duration + VOICE_LEAD + VOICE_TAIL); });
    }
    // ความยาวเป้าหมาย: ยืด/หดเวลาต่อฉากให้ใกล้เป้า (ฉากที่มีเสียงพากย์หดต่ำกว่าความยาวเสียงไม่ได้)
    let note = '';
    if (opts.target) {
      const mins = scenes.map((_, i) => (voices[i] ? voices[i].duration + VOICE_LEAD + VOICE_TAIL : 2));
      fitDurations(scenes, mins, opts.target);
      const got = scenes.reduce((a, s) => a + s.dur, 0);
      if (got > opts.target + 1) note = `ยาว ${Math.round(got)} วิ เกินเป้า ${opts.target} วิ — เสียงพากย์/จำนวนฉากทำให้สั้นกว่านี้ไม่ได้ ลองลดข้อความหรือเพิ่มความเร็วเสียง`;
      else if (got < opts.target - 1) note = `ได้ ${Math.round(got)} วิ สั้นกว่าเป้า ${opts.target} วิ — เพิ่มฉากหรือข้อความเพื่อให้ยาวขึ้น`;
    }
    const total = scenes.reduce((a, s) => a + s.dur, 0);
    if (total > 90) { ac.close(); throw new Error(`ยาว ${Math.round(total)} วิ เกิน 90 วิ — ลดจำนวนฉาก`); }

    let musicBuf = null;
    try { musicBuf = await loadMusic(ac, opts.music, opts.onStatus); } catch (e) { closeAc(ac); throw e; }

    const canvas = opts.canvas || document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const starSets = scenes.map((_, i) => stars(i + 1));
    // รูปประกอบ (opts.images = [{url, credit}]) — โหลดไม่ได้ก็ข้ามรูปนั้น
    const photos = [];
    for (const it of opts.images || []) {
      const im = await loadImage(it.url);
      if (im) photos.push({ img: im, credit: it.credit || '' });
    }
    const logoImg = opts.logo ? await loadImage(opts.logo) : null; // โลโก้เพจ — โหลดไม่ได้ก็เรนเดอร์ต่อโดยไม่มีโลโก้

    // ตั้งเวลาเสียงทั้งหมดล่วงหน้า (เริ่มหลัง 0.2 วิ ให้ตัวอัดพร้อม) แล้วเลื่อนเส้นเวลาภาพให้ตรงกัน
    const ta = ac.currentTime + 0.2;
    const duck = voices.length ? 0.4 : 1; // มีเสียงพากย์ → ลดเพลงลง
    scheduleMusic(ac, dest, { music: opts.music, buf: musicBuf, total, ta, level: (musicBuf ? 0.35 : 0.9) * duck });
    const starts = [];
    scenes.reduce((at, s) => { starts.push(at); return at + s.dur; }, 0);
    scheduleVoices(ac, dest, voices, starts, ta);

    // เอฟเฟกต์เสียงประกอบ: whoosh ตอนเข้าฉาก, pop ตอนป้ายเด้ง, ding ตอนปิดคลิป (ปิดได้ด้วย opts.sfx === false)
    if (opts.sfx !== false) {
      const sg = ac.createGain();
      sg.gain.value = voices.length ? 0.8 : 1.3;
      sg.connect(dest);
      let at = 0;
      scenes.forEach((s, i) => {
        const lastScene = scenes.length > 1 && i === scenes.length - 1;
        sfx(ac, sg, 'whoosh', ta + Math.max(0, at - (i ? 0.1 : 0)), 0.9);
        if (s.head) sfx(ac, sg, 'pop', ta + at + 0.28, 0.7);
        if (lastScene && !s.head) sfx(ac, sg, 'ding', ta + at + 0.2, 0.9);
        at += s.dur;
      });
    }

    const out = await record({
      ac, dest, canvas, mime, total, lead: 0.2, onProgress: opts.onProgress, signal: opts.signal,
      draw: (t) => drawFrame(ctx, scenes, theme, t, starSets, logoImg, photos, badge),
    });

    // ภาพหน้าปกจากฉากแรกตอนข้อความขึ้นเต็มแล้ว
    drawFrame(ctx, scenes, theme, Math.min(scenes[0].dur * 0.7, total - 0.05), starSets, logoImg, photos, badge);
    const thumb = await thumbOf(canvas);

    return { ...out, duration: total, thumb, note };
  }

  // ---------- รวมคลิปต่อช็อต (โปรเจกต์เรื่อง) ----------
  // shots = [{ url, narration }] เรียงตามลำดับ → คลิปเดียว: เล่นต่อกันตามเวลาจริงลง canvas (ไม่ต้องใช้ ffmpeg)
  // opts: { aspect, voice, subs, keepAudio, music, logo, badge, theme, onProgress, onStatus } → { blob, mime, duration, thumb, size }
  const SIZES = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1080, 608] };
  async function assemble(shots, opts = {}) {
    const mime = pickMime();
    if (!mime) throw new Error('เบราว์เซอร์นี้อัดวิดีโอไม่ได้ — ใช้ Chrome หรือ Edge');
    if (!shots.length) throw new Error('ยังไม่มีคลิปให้รวม');
    // เทมเพลต B (public/tplb.js): วางชั้นข้อความทับช็อตตามตำแหน่งตายตัวของ 9:16 + การ์ดปก/จบ (shots[i].card = 'cover' | 'end', ไม่มี url)
    const tb = opts.template === 'b' ? window.ReelTplB : null;
    if (opts.template === 'b' && !tb) throw new Error('โหลดเทมเพลต B ไม่สำเร็จ (tplb.js)');
    if (tb && (opts.aspect || '9:16') !== '9:16') throw new Error('เทมเพลต B ใช้ได้กับสัดส่วน 9:16 เท่านั้น');
    const [CW, CH] = SIZES[opts.aspect] || SIZES['9:16'];
    const theme = opts.theme || { colors: ['#0b1020', '#1b2550'], accent: '#ffd36b', id: 'dark' };

    opts.onStatus?.('กำลังโหลดคลิปแต่ละช็อต…');
    const isStill = shots.map((s) => /\.(png|jpe?g|webp)(\?|$)/i.test(s.url));
    const STILL_SEC = 6; // ภาพนิ่งที่ไม่มีเสียงบรรยาย: ค้างไว้ช็อตละกี่วินาที
    const vids = await Promise.all(shots.map((s, i) => new Promise((resolve, reject) => {
      if (s.card) { // การ์ดปก/จบ: ไม่มีไฟล์ — ตัวแทนให้โค้ดส่วนที่เหลือใช้ร่วม (วาดด้วย ReelTplB.drawCard)
        resolve({ still: true, card: s.card, videoWidth: 1, videoHeight: 1, duration: s.duration, readyState: 4, pause() {}, play() { return Promise.resolve(); } });
        return;
      }
      if (isStill[i]) { // ภาพนิ่ง: ทำตัวให้เหมือน video (videoWidth/duration) เพื่อใช้โค้ดส่วนที่เหลือร่วมกัน
        const im = new Image();
        im.onload = () => resolve({ still: true, im, videoWidth: im.naturalWidth, videoHeight: im.naturalHeight, duration: Math.max(2, s.duration || STILL_SEC), readyState: 4, pause() {}, play() { return Promise.resolve(); } });
        im.onerror = () => reject(new Error(`เปิดรูปของช็อตที่ ${i + 1} ไม่ได้`));
        im.src = s.url;
        return;
      }
      const v = document.createElement('video');
      v.preload = 'auto'; v.playsInline = true; v.muted = true;
      v.onloadedmetadata = () => resolve(v);
      v.onerror = () => reject(new Error(`เปิดคลิปของช็อตที่ ${i + 1} ไม่ได้`));
      v.src = s.url;
    })));
    // เลย์เอาต์ "แบ่งสองช่อง" (เทมเพลต B): รูปที่ 2 ของช็อต (s.url2) — โหลดไม่ได้ให้ล้มพร้อมบอกช็อต ไม่วาดครึ่งเดียวเงียบ ๆ
    if (tb) await Promise.all(shots.map(async (s, i) => { if (s.layout === 'split') { const im = await loadImage(s.url2); if (!im) throw new Error(`ช็อตที่ ${i + 1} ตั้งเป็นแบ่งสองช่อง แต่ไม่มีรูปที่ 2`); vids[i].pair = { still: true, im, videoWidth: im.naturalWidth, videoHeight: im.naturalHeight }; } }));
    for (const [i, v] of vids.entries()) if (!(v.duration > 0.2 && Number.isFinite(v.duration))) throw new Error(`คลิปของช็อตที่ ${i + 1} ไม่มีความยาว (ไฟล์เสีย?)`);
    checkStop(opts.signal); // โหลดหลายคลิปใช้เวลา — กดหยุดระหว่างนี้ไม่ต้องไปต่อ

    const ac = new AudioContext({ sampleRate: 48000 });
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    // เทมเพลต B: มิกซ์ปลายสาย คอมเพรสเซอร์ → เกนชดเชย → ลิมิตเตอร์ ให้เสียงแน่นสม่ำเสมอ ไม่มีช่วงเบาหวิว (เป้า ≈ −17 dBFS เฉลี่ย พีค ≤ −1.5 — วัดจากคลิปตัวอย่าง)
    let bus = dest;
    if (tb) {
      const comp = ac.createDynamicsCompressor(), mk = ac.createGain(), lim = ac.createDynamicsCompressor();
      comp.threshold.value = -32; comp.knee.value = 18; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.2;
      mk.gain.value = MAKEUP_B;
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
      // กันพีคเกินเต็มสเกลด้วยซอฟต์คลิป tanh (คอมเพรสเซอร์ของเบราว์เซอร์ไม่ใช่ลิมิตเตอร์เด็ดขาด — ทดสอบแล้วพีคเกิน 0 dBFS)
      const clip = ac.createWaveShaper(), curve = new Float32Array(4097);
      for (let k = 0; k < curve.length; k++) curve[k] = Math.tanh((k / 2048 - 1) * 1.0);
      clip.curve = curve;
      comp.connect(mk).connect(lim).connect(clip).connect(dest);
      bus = comp;
    }

    // เสียงบรรยาย: ขอ WAV ต่อช็อตที่มีข้อความ แล้วยืดช่วงของช็อตให้พอดีกับเสียง (ไม่ตัดเสียง)
    let voices = shots.map(() => null);
    if (opts.voice) {
      try { voices = await ttsBuffers(ac, shots.map((s) => s.narration || ''), opts.onStatus, 'กำลังสร้างเสียงบรรยาย…', opts.signal, opts.tone); } catch (e) { closeAc(ac); throw e; }
    }
    // ภาพนิ่งที่มีเสียง: ยาวเท่าเสียง (ไม่ใช่ค่าสำรองของช็อต) ; คลิป: ยาวอย่างน้อยเท่าคลิป
    const segs = shots.map((s, i) => ({ dur: isStill[i] && voices[i] ? voices[i].duration + VOICE_LEAD + VOICE_TAIL : Math.max(vids[i].duration, voices[i] ? voices[i].duration + VOICE_LEAD + VOICE_TAIL : 0) }));
    let acc = 0;
    segs.forEach((g) => { g.start = acc; acc += g.dur; });
    const total = acc;
    if (total > 900) { ac.close(); throw new Error(`ยาว ${Math.round(total)} วิ เกิน 15 นาที — ลดจำนวนช็อต`); }

    // เพลงจากไฟล์ของผู้ใช้ใช้ได้ด้วย (เดิมรวมเรื่องเล่นได้แต่เพลงสังเคราะห์ เลือกไฟล์แล้วเงียบ)
    let musicBuf = null;
    try { musicBuf = await loadMusic(ac, opts.music, opts.onStatus); } catch (e) { closeAc(ac); throw e; }
    const logoImg = opts.logo ? await loadImage(opts.logo) : null;

    const canvas = opts.canvas || document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');

    const ta = ac.currentTime + 0.3;
    const voiced = voices.some(Boolean);
    scheduleMusic(ac, bus, { music: opts.music, buf: musicBuf, total, ta, level: (voiced ? 0.4 : 0.9) * 0.6 * (musicBuf ? 0.39 : 1) });
    scheduleVoices(ac, bus, voices, segs.map((g) => g.start), ta);
    if (opts.keepAudio) {
      vids.forEach((v) => { if (v.still) return; v.muted = false; ac.createMediaElementSource(v).connect(bus); });
    }
    if (tb) { // เสียงเอฟเฟกต์ของเทมเพลต: กระแทกตอนคำเสียงเด้ง, ปกเข้า/จบมีเสียงเบา ๆ
      segs.forEach((g, i) => {
        if (shots[i].sfx) sfx(ac, bus, 'hit', ta + g.start + 0.12);
        if (shots[i].card === 'cover') sfx(ac, bus, 'whoosh', ta + g.start + 0.02, 0.7);
        if (shots[i].card === 'end') sfx(ac, bus, 'ding', ta + g.start + 0.25, 0.6);
      });
    }

    // r = กรอบที่จะวาดลงไป (ค่าเริ่มต้น = เต็มจอ; เลย์เอาต์ "แผ่นภาพ" ของเทมเพลต B ใช้กรอบเล็ก)
    const FULL = { x: 0, y: 0, w: CW, h: CH };
    const cover = (v, p = 0, idx = 0, r = FULL) => {
      const k = Math.max(r.w / v.videoWidth, r.h / v.videoHeight), w = v.videoWidth * k, h = v.videoHeight * k;
      if (!v.still) return ctx.drawImage(v, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
      // ภาพนิ่ง: ซูมช้าๆ (เข้า/ออกสลับช็อต) + แพนเล็กน้อยไปมุมต่างกัน ให้ภาพมีชีวิต
      const zoom = idx % 2 === 0 ? 1 + 0.12 * p : 1.12 - 0.12 * p;
      const dx = [-1, 1, 0, 0][idx % 4] * 0.03 * r.w * (p - 0.5), dy = [0, 0, -1, 1][idx % 4] * 0.03 * r.h * (p - 0.5);
      ctx.drawImage(v.im, r.x + (r.w - w * zoom) / 2 + dx, r.y + (r.h - h * zoom) / 2 + dy, w * zoom, h * zoom);
    };
    const tplOpts = tb && { ...(opts.tpl || {}), theme };
    // เทมเพลต B: ภาพช็อต (เต็มจอ หรือในกรอบ "แผ่นภาพ") + ชั้นข้อความ/มิเตอร์ของ ReelTplB; การ์ดปก/จบวาดล้วน
    const drawTpl = (i, lt) => {
      const sh = shots[i], dur = segs[i].dur, p = Math.min(1, lt / dur);
      if (sh.card) return tb.drawCard(ctx, sh.card, lt, dur, tplOpts);
      if (sh.layout === 'split' && vids[i].pair) {
        const pal = tb.palette(theme), a = tb.plateRect(CW, CH), gap = 28, ph = Math.floor((a.h - gap) / 2);
        const rs = [{ x: a.x, y: a.y, w: a.w, h: ph }, { x: a.x, y: a.y + ph + gap, w: a.w, h: ph }];
        tb.drawPlateBackdrop(ctx, pal);
        rs.forEach((r, k) => {
          tb.plateShadow(ctx, r, pal);
          ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
          ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h);
          if (k === 0) { if (vids[i].readyState >= 2) cover(vids[i], p, i, r); } else cover(vids[i].pair, p, i + 1, r);
          ctx.restore(); tb.drawPlateFrame(ctx, r, pal);
        });
      } else if (sh.layout === 'plate') {
        const pal = tb.palette(theme), r = tb.plateRect(CW, CH);
        tb.drawPlateBackdrop(ctx, pal); tb.plateShadow(ctx, r, pal);
        ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h);
        if (vids[i].readyState >= 2) cover(vids[i], p, i, r);
        ctx.restore(); tb.drawPlateFrame(ctx, r, pal);
      } else {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
        if (vids[i].readyState >= 2) cover(vids[i], p, i);
      }
      tb.drawShotOverlay(ctx, { narration: opts.subs ? sh.narration : '', caption: sh.caption, sfx: sh.sfx, meter: sh.meter, meterPrev: sh.meterPrev, index: i }, lt, dur, tplOpts);
    };
    let cur = -1;
    const draw = (t) => {
      let i = segs.findIndex((g) => t < g.start + g.dur);
      if (i < 0) i = segs.length - 1;
      if (i !== cur) { // เข้าช็อตใหม่: หยุดช็อตก่อน เริ่มเล่นช็อตนี้จากต้น
        if (cur >= 0) vids[cur].pause();
        cur = i;
        vids[i].currentTime = 0;
        vids[i].play().catch(() => {});
      }
      const lt = t - segs[i].start;
      if (tb) return drawTpl(i, lt); // เทมเพลต B วาดทั้งภาพ/ข้อความ/ป้ายเอง (ไม่ใช้ซับไตเติล ป้ายมุม และโลโก้แบบเดิม)
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
      if (vids[i].readyState >= 2) cover(vids[i], Math.min(1, lt / segs[i].dur), i);
      // ซับไตเติล: ข้อความบรรยายของช็อต ขึ้นตลอดช่วงเสียง (ไม่มีเสียงก็ขึ้นตลอดช็อต) อยู่ช่วงล่างค่อนบน เลี่ยงแถบ/ปุ่มของ Facebook
      if (opts.subs && shots[i].narration) {
        const from = voices[i] ? VOICE_LEAD - 0.1 : 0.2, to = voices[i] ? VOICE_LEAD + voices[i].duration + 0.3 : segs[i].dur - 0.2;
        const a = Math.min(1, (lt - from) / 0.25, (to - lt) / 0.25);
        if (a > 0) {
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, a));
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          const size = Math.round(CW * 0.055);
          ctx.font = `800 ${size}px ${FONT}`;
          const lines = wrap(ctx, shots[i].narration, CW - 140);
          drawLines(ctx, lines, CW / 2, CH * 0.66 - (lines.length * size * 1.28) / 2, size, '#fff');
          ctx.restore();
        }
      }
      if (opts.intro) drawIntro(ctx, opts.intro, t, CW);
      if (opts.badge) drawBadge(ctx, theme, opts.badge, t);
      drawLogo(ctx, logoImg, t);
    };

    opts.onStatus?.('กำลังรวมคลิป…');
    const out = await record({
      ac, dest, canvas, mime, total, lead: 0.3, draw, onProgress: opts.onProgress, signal: opts.signal,
      onStop: () => vids.forEach((v) => v.pause()),
    });

    // หน้าปก: เฟรมต้นของช็อตแรก (ภาพนิ่งไม่ต้องรอ seek)
    if (!vids[0].still) {
      vids[0].muted = true;
      await new Promise((resolve) => { vids[0].onseeked = resolve; vids[0].currentTime = Math.min(0.5, vids[0].duration / 2); setTimeout(resolve, 1500); });
    }
    if (tb) { // หน้าปก: ช็อตแรกที่ไม่ใช่การ์ด ณ วินาทีที่ข้อความขึ้นครบแล้ว
      const k = Math.max(0, shots.findIndex((s) => !s.card));
      drawTpl(k, Math.min(1.2, segs[k].dur - 0.05));
    } else {
      // คลิปสินค้า: หน้าปก = เฟรมที่วินาที coverAt ของวิดีโอ (ตั้งได้ ค่าเริ่มต้น 0.4) + ข้อความแนะนำเต็ม (ถ้า coverText ไม่ปิด)
      if (opts.coverAt != null && !vids[0].still) {
        const at = Math.max(0, Math.min(Number(opts.coverAt) || 0, (vids[0].duration || 1) - 0.05));
        await new Promise((resolve) => { vids[0].onseeked = resolve; vids[0].currentTime = at; setTimeout(resolve, 2000); });
      }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH); cover(vids[0]);
      if (opts.intro && opts.coverText !== false) drawIntro(ctx, opts.intro, 9, CW);
    }
    const thumb = await thumbOf(canvas);
    // หน้าปกเต็มขนาด (ไว้อัปโหลดเป็นภาพขนาดย่อของ Reels) — เฉพาะเมื่อขอ
    const coverJpg = opts.coverAt != null ? await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9)) : null;
    return { ...out, duration: total, thumb, cover: coverJpg };
  }

  return { render, pickMime, assemble };
})();
