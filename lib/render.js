// ประกอบคลิป 9:16 ด้วย ffmpeg: 1 บรรทัดสคริปต์ = 1 ฉาก (ข้อความกลางจอบนพื้นสี) + แทร็กเสียงเงียบ
// ออกแบบเป็น "provider" — ภายหลังเสียบตัวสร้างวิดีโอ AI แทนได้โดยคืนไฟล์ mp4 เช่นเดียวกัน
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');

const W = 1080, H = 1920, FPS = 30;
const MAX_TOTAL_SEC = 90; // เพดาน Reels

// สไตล์ที่ให้เลือกเป็นการ์ดในหน้าเว็บ: พื้นสลับ 2 สี, สีเน้นหัวข้อ, stars = โรยดาวทอง
const THEMES = {
  stars: { label: 'ดวงดาว/ทอง', colors: ['#0b1230', '#111a3d'], accent: '#e8b84a', stars: true },
  dark:  { label: 'มืดเรียบ',   colors: ['#14142b', '#1f1d3a'], accent: '#a5b4fc' },
  sun:   { label: 'ส้มสดใส',    colors: ['#e8590c', '#f08c00'], accent: '#fff3bf' },
  ocean: { label: 'ทะเลลึก',    colors: ['#0b3d91', '#0e7490'], accent: '#a5f3fc' },
  rose:  { label: 'ชมพูกุหลาบ', colors: ['#be185d', '#9d174d'], accent: '#fecdd3' },
  mint:  { label: 'เขียวมิ้นต์', colors: ['#047857', '#0f766e'], accent: '#d1fae5' },
};
const THEME_INFO = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label, colors: t.colors, accent: t.accent }));

const hex = (c) => c.replace('#', '0x');

// ดาวทอง: ตำแหน่งสุ่มแบบกำหนด seed (ฉากเดิมได้ผลเดิม ไม่กระพริบเวลาเรนเดอร์ซ้ำ)
function starBoxes(seed, color) {
  let s = seed * 2654435761 % 4294967296 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const out = [];
  for (let k = 0; k < 28; k++) {
    const size = 3 + Math.floor(rnd() * 4);
    out.push(`drawbox=x=${Math.floor(rnd() * W)}:y=${Math.floor(rnd() * H)}:w=${size}:h=${size}:color=${hex(color)}@${(0.35 + rnd() * 0.5).toFixed(2)}:t=fill`);
  }
  return out.join(',');
}

const FONT_CANDIDATES = [
  'C:/Windows/Fonts/tahomabd.ttf', // Tahoma Bold รองรับไทย
  'C:/Windows/Fonts/tahoma.ttf',
  'C:/Windows/Fonts/LeelawUI.ttf',
  'C:/Windows/Fonts/leelawad.ttf',
];

function findFont() {
  return [cfg.fontFile, ...FONT_CANDIDATES].find((f) => f && fs.existsSync(f)) || '';
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? `ไม่พบ ${cmd} ใน PATH` : e.message)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.trim().split('\n').slice(-4).join(' | ')}`))));
  });
}

async function ffmpegOk() {
  try { await run(cfg.ffmpeg, ['-version']); return true; } catch { return false; }
}

// ตัดบรรทัดตามคำไทย (Intl.Segmenter) ไม่ให้ฉีกกลางคำ
function wrap(text, maxCols = 18) {
  const seg = new Intl.Segmenter('th', { granularity: 'word' });
  const lines = [];
  let cur = '';
  for (const { segment } of seg.segment(text)) {
    if ((cur + segment).length > maxCols && cur.trim()) {
      lines.push(cur.trim());
      cur = segment.trimStart();
    } else {
      cur += segment;
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.join('\n');
}

// เวลาต่อฉาก ~ ความเร็วอ่าน: 0.11 วิ/ตัวอักษร + 1.2 วิ ขอบ 3–8 วิ (Reels ขั้นต่ำ 3 วิ)
function sceneSeconds(text) {
  return Math.min(8, Math.max(3, text.length * 0.11 + 1.2));
}

async function renderClip(clip, outFile) {
  const font = findFont();
  if (!font) throw new Error('ไม่พบฟอนต์ไทย — ตั้ง fontFile ใน config.json');
  const scenes = clip.script.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!scenes.length) throw new Error('ยังไม่มีสคริปต์ (ใส่เองหรือกด "ให้ AI เขียนสคริปต์")');

  const theme = THEMES[clip.theme] || THEMES.dark;
  const secs = scenes.map(sceneSeconds);
  const total = secs.reduce((a, b) => a + b, 0);
  if (total > MAX_TOTAL_SEC) throw new Error(`ยาว ${Math.round(total)} วิ เกิน ${MAX_TOTAL_SEC} วิ — ลดจำนวนฉาก`);

  // ทำงานในโฟลเดอร์ชั่วคราว ใช้ชื่อไฟล์สัมพัทธ์ใน filter เลี่ยงปัญหา escape "C:" บน Windows
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));
  try {
    fs.copyFileSync(font, path.join(work, 'font.ttf'));
    const shadow = 'shadowcolor=black@0.55:shadowx=3:shadowy=3';
    const chains = scenes.map((text, i) => {
      // "หัวข้อ | รายละเอียด" = การ์ดสองชั้น (หัวข้อสีเน้น + เส้นคั่น + ข้อความ); ไม่มี | = ข้อความกลางจอ
      const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
      const head = parts.length > 1 ? parts[0] : null;
      const body = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
      const d = secs[i].toFixed(2);
      const fx = [`color=c=${hex(theme.colors[i % theme.colors.length])}:s=${W}x${H}:r=${FPS}:d=${d}`];
      if (theme.stars) fx.push(starBoxes(i + 1, theme.accent));
      if (head) {
        fs.writeFileSync(path.join(work, `h${i}.txt`), wrap(head, 12), 'utf8');
        fs.writeFileSync(path.join(work, `s${i}.txt`), wrap(body, 22), 'utf8');
        fx.push(
          `drawtext=fontfile=font.ttf:textfile=h${i}.txt:fontcolor=${hex(theme.accent)}:fontsize=100:line_spacing=18:${shadow}:x=(w-text_w)/2:y=780-text_h`,
          `drawbox=x=440:y=810:w=200:h=6:color=${hex(theme.accent)}:t=fill`,
          `drawtext=fontfile=font.ttf:textfile=s${i}.txt:fontcolor=white:fontsize=62:line_spacing=20:${shadow}:x=(w-text_w)/2:y=860`
        );
      } else {
        fs.writeFileSync(path.join(work, `s${i}.txt`), wrap(body), 'utf8');
        const hook = i === 0; // ฉากแรก = hook ใหญ่สีเน้น
        fx.push(`drawtext=fontfile=font.ttf:textfile=s${i}.txt:fontcolor=${hook ? hex(theme.accent) : 'white'}:fontsize=${hook ? 90 : 78}:line_spacing=22:${shadow}:x=(w-text_w)/2:y=(h-text_h)/2`);
      }
      fx.push(`fade=t=in:d=0.25`, `fade=t=out:st=${(secs[i] - 0.25).toFixed(2)}:d=0.25`, 'setsar=1');
      return `${fx.join(',')}[v${i}]`;
    });
    const concat = scenes.map((_, i) => `[v${i}]`).join('') + `concat=n=${scenes.length}:v=1:a=0[v]`;
    fs.writeFileSync(path.join(work, 'graph.txt'), [...chains, concat].join(';\n'), 'utf8');

    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo',
      '-filter_complex_script', 'graph.txt',
      '-map', '[v]', '-map', '0:a',
      // สเปก Reels API: H.264 4:2:0, closed GOP 2–5 วิ (GOP 60 เฟรม = 2 วิ), เสียง AAC 48kHz stereo
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-g', String(FPS * 2), '-x264-params', 'open-gop=0',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
      path.resolve(outFile),
    ];
    await run(cfg.ffmpeg, args, { cwd: work });
    return { duration: total };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { renderClip, ffmpegOk, THEMES: Object.keys(THEMES), THEME_INFO };
