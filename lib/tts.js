// เสียงพากย์ไทย 2 ทาง แคชเป็น WAV ใน output/tts:
//  - windows: เสียงไทยของ Windows ในเครื่อง (ฟรี ออฟไลน์ ไม่ใช้คีย์) ผ่าน lib/tts.ps1
//  - google : Google Cloud Text-to-Speech (ต้องมีคีย์ ใส่ในหน้า "ตั้งค่า")
//  - gemini : Gemini API text-to-speech (ใช้คีย์ Gemini จาก AI Studio)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');
const { OUT_DIR } = require('./db');

const DIR = path.join(OUT_DIR, 'tts');
fs.mkdirSync(DIR, { recursive: true });
const SCRIPT = path.join(__dirname, 'tts.ps1');
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT];

function runPs(args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', [...PS, ...args], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
    const timer = setTimeout(() => { p.kill(); reject(new Error('TTS หมดเวลา')); }, timeout);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`TTS ล้มเหลว (exit ${code}) ${err.trim().split('\n')[0] || ''}`));
    });
  });
}

let probe = null;
function windowsAvailable() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  probe ||= runPs(['-Probe'], 20000).then(() => true, () => false);
  return probe;
}

async function available() {
  if (cfg.ttsProvider === 'google') return !!cfg.googleKey;
  if (cfg.ttsProvider === 'gemini') return !!cfg.geminiKey;
  return windowsAvailable();
}

// ตัดอีโมจิ/ตัวคั่น | ออก ให้เสียงอ่านเฉพาะเนื้อหา
function clean(text) {
  return String(text).replace(/\p{Extended_Pictographic}/gu, ' ').replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

async function googleSynth(text) {
  const chirp = /chirp/i.test(cfg.googleVoice); // Chirp 3 HD ไม่รับ speakingRate ตรง ๆ
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.googleKey },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'th-TH', name: cfg.googleVoice },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, ...(chirp ? {} : { speakingRate: cfg.ttsRate }) },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${data.error?.message || 'request failed'}`);
  return Buffer.from(data.audioContent, 'base64'); // LINEAR16 มี WAV header ในตัว
}

// PCM 16-bit mono → WAV
function pcmToWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Gemini TTS: คืน PCM 24kHz base64 (inlineData) — โควตาฟรีมีจำกัดต่อนาที → ถ้าโดน 429/503 รอแล้วลองใหม่
async function geminiSynth(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.geminiVoice } } },
    },
  });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.geminiKey }, body, signal: AbortSignal.timeout(60000) });
    const data = await res.json().catch(() => ({}));
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const wait = Math.min(30, 4 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${data.error?.message || 'request failed'}`);
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error('Gemini TTS ไม่ได้ส่งเสียงกลับมา (ข้อความอาจถูกปฏิเสธ)');
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
    return pcmToWav(Buffer.from(part.inlineData.data, 'base64'), rate);
  }
}

let queue = Promise.resolve(); // ทีละงาน กันแย่งไฟล์แคช
function synthesize(rawLines) {
  const job = queue.then(() => doSynthesize(rawLines));
  queue = job.catch(() => {});
  return job;
}

async function doSynthesize(rawLines) {
  if (!(await available())) {
    throw new Error(cfg.ttsProvider === 'google' ? 'ยังไม่ได้ใส่คีย์ Google TTS (ตั้งค่า → เสียงพากย์)'
      : cfg.ttsProvider === 'gemini' ? 'ยังไม่ได้ใส่คีย์ Gemini (ตั้งค่า → เสียงพากย์)'
        : 'เครื่องนี้ไม่มีเสียงพากย์ไทยของ Windows (เช่น Microsoft Pattara)');
  }
  const provider = cfg.ttsProvider;
  const voiceId = provider === 'google' ? cfg.googleVoice : provider === 'gemini' ? `${cfg.geminiModel}/${cfg.geminiVoice}` : 'win';
  const lines = rawLines.map(clean);
  const names = lines.map((l) =>
    crypto.createHash('sha1').update(`${provider}|${voiceId}|${cfg.ttsRate}|${l || '-'}`).digest('hex') + '.wav');
  const todo = new Map(); // ชื่อไฟล์ → ข้อความ ที่ยังไม่มีในแคช
  names.forEach((n, i) => { if (!fs.existsSync(path.join(DIR, n))) todo.set(n, lines[i] || '-'); });
  if (!todo.size) return names;

  if (provider === 'google') {
    for (const [name, text] of todo) fs.writeFileSync(path.join(DIR, name), await googleSynth(text));
    return names;
  }
  if (provider === 'gemini') {
    for (const [name, text] of todo) fs.writeFileSync(path.join(DIR, name), await geminiSynth(text));
    return names;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
  try {
    const inFile = path.join(work, 'lines.txt');
    fs.writeFileSync(inFile, [...todo.values()].join('\n'), 'utf8');
    await runPs(['-InFile', inFile, '-OutDir', work, '-Rate', String(cfg.ttsRate)]);
    [...todo.keys()].forEach((n, k) => fs.renameSync(path.join(work, `${k}.wav`), path.join(DIR, n)));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return names;
}

module.exports = { available, synthesize, DIR };
