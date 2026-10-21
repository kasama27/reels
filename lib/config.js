// ค่าตั้งจาก config.json (ถ้ามี) โดย env ทับ — แก้ผ่านหน้า "ตั้งค่า" ได้ด้วย (cfg.save)
// คีย์เก็บฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยถูกส่งกลับไปหน้าเว็บ (หน้าเว็บเห็นแค่ ••••ท้าย 4 ตัว)
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const FILE = path.join(DATA_DIR, 'config.json');

let file = {};
try {
  file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch { /* ไม่มีไฟล์ = ใช้ค่า default */ }

const cfg = {
  port: Number(process.env.PORT || file.port || 8791),
  anthropicKey: process.env.ANTHROPIC_API_KEY || file.anthropicKey || '',
  // AI: 'cli' = เรียกโปรแกรม claude (Claude Code) ที่ล็อกอินไว้แล้ว ไม่ต้องมีคีย์ | 'api' = ใช้คีย์ API
  aiProvider: file.aiProvider === 'api' || file.aiProvider === 'cli' ? file.aiProvider
    : (process.env.ANTHROPIC_API_KEY || file.anthropicKey ? 'api' : 'cli'),
  claudePath: process.env.CLAUDE_PATH || file.claudePath || '', // ว่าง = หาให้เอง
  adbPath: process.env.ADB_PATH || file.adbPath || '', // ว่าง = หาให้เอง (ใช้ดึงสินค้าจากแอป Pondy บนมือถือ)
  model: process.env.REELS_MODEL || file.model || 'claude-sonnet-5-5',
  ffmpeg: process.env.FFMPEG_PATH || file.ffmpeg || 'ffmpeg',
  fontFile: process.env.REELS_FONT || file.fontFile || '',
  // เสียงพากย์: 'windows' (ฟรี ในเครื่อง) | 'google' (Cloud Text-to-Speech ต้องมีคีย์)
  ttsProvider: ['google', 'gemini'].includes(file.ttsProvider) ? file.ttsProvider : 'windows',
  // Gemini TTS: ใช้คีย์ Gemini API (ขอที่ aistudio.google.com — ขึ้นต้น AIza… หรือ AQ.…) ไม่ใช่คีย์ของ Cloud Text-to-Speech
  geminiKey: process.env.GEMINI_API_KEY || file.geminiKey || '',
  geminiVoice: file.geminiVoice || 'Kore',
  geminiModel: file.geminiModel || 'gemini-2.5-flash-preview-tts',
  googleKey: process.env.GOOGLE_TTS_KEY || file.googleKey || '',
  googleVoice: file.googleVoice || 'th-TH-Neural2-C',
  ttsRate: Number(file.ttsRate) || 1.0, // ความเร็วเสียงพากย์ (0.5–2)
  brand: file.brand && typeof file.brand === 'object' ? file.brand : {}, // สไตล์ประจำเพจ (lib/brand.js)
  extToken: file.extToken || '', // รหัสจับคู่กับส่วนเสริม Chrome (extension/) — สร้างเองครั้งแรกที่เปิดแอป
};

const PERSIST = ['anthropicKey', 'aiProvider', 'model', 'ttsProvider', 'googleKey', 'googleVoice', 'geminiKey', 'geminiVoice', 'geminiModel', 'ttsRate', 'brand', 'extToken'];

// patch: ค่าว่าง/null = ลบออกจากไฟล์ (กลับไปใช้ค่า default)
Object.defineProperty(cfg, 'save', {
  enumerable: false,
  value(patch) {
    Object.assign(cfg, patch);
    const next = { ...file };
    for (const k of PERSIST) {
      if (!(k in patch)) continue;
      if (patch[k] === '' || patch[k] == null) delete next[k]; else next[k] = patch[k];
    }
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
    file = next;
  },
});

module.exports = cfg;
