// แคตตาล็อกเว็บสร้างรูป/คลิปด้วย AI — ใช้ร่วมกันทั้งหน้า "คลิปเร็ว" (app.js) และ "โปรเจกต์เรื่อง" (story.js)
// prompt เหมือนกันทุกเว็บ ต่างแค่คำแนะนำและลิงก์
// media = สร้างอะไรได้ ('image' รูป / 'video' คลิป) — ตัวเลือกในหน้าจอกรองตามรูปแบบช็อตของโปรเจกต์ (เช่น ChatGPT ไม่มีในโหมดวิดีโอ)
// tip(aspect, media) = คำแนะนำของเว็บนั้น (aspect เช่น '9:16')
window.ARN_GEN = {
  flow: { name: 'Google Flow', short: 'Google Flow', url: 'https://flow.google.com', media: ['image', 'video'],
    tip: (a, m) => (m === 'video'
      ? `ใน Flow: เลือกสร้างวิดีโอ ตั้งสัดส่วน ${a} แล้ววาง prompt ของช็อต — ได้คลิปแล้วดาวน์โหลดมาแนบเข้าช็อต`
      : `ใน Flow: เลือกโมเดล Nano Banana 2.1 และสัดส่วน ${a} ที่มุมขวาล่างของช่องพิมพ์ ตั้งจำนวนเป็น x1 ถ้าอยากได้รูปเดียวต่อ prompt แล้ววาง prompt`) },
  chatgpt: { name: 'ChatGPT', short: 'ChatGPT', url: 'https://chatgpt.com', media: ['image'],
    tip: (a) => `ใน ChatGPT: วาง prompt แล้วระบุสัดส่วน ${a} ในข้อความถ้ารูปออกมาผิดสัดส่วน` },
  gemini: { name: 'Gemini', short: 'Gemini', url: 'https://gemini.google.com/app', media: ['image'],
    tip: (a) => `ใน Gemini: เปิดแชตใหม่ทุกช็อต วาง prompt พร้อมระบุสัดส่วน ${a} และใส่คำอธิบายตัวละครเต็มทุกครั้ง (แชตเดิมค้างสถานะสร้างรูป ส่งต่อไม่ได้) รูปที่ได้อาจเล็กกว่าคลิป — ตรวจเวลาในฉาก (กลางวัน/กลางคืน) ในพรอมต์ด้วย` },
  meta: { name: 'Meta AI', short: 'Meta AI', url: 'https://meta.ai', media: ['image', 'video'],
    tip: (a, m) => (m === 'video' ? 'ใน Meta AI: เลือกโหมดสร้างวิดีโอก่อนวาง prompt (ได้คลิปราว 5–10 วินาที)' : 'ใน Meta AI: เลือกโหมดสร้างรูปภาพก่อนวาง prompt') },
  seedance: { name: 'Seedance', short: 'Seedance', url: '', media: ['video'],
    tip: () => 'สำหรับ Seedance: ใช้ปุ่ม “🎬 prompt รวมฉาก” วางทีละกลุ่ม (ปรับวินาทีต่อครั้งให้ตรงกับที่โมเดลสร้างได้) แล้วนำคลิปที่ได้มาแนบเข้าช็อตแรกของกลุ่ม' },
};
// เว็บที่ใช้ได้กับรูปแบบนั้น ๆ (เรียงตามแคตตาล็อก)
window.ARN_GEN_FOR = (media) => Object.keys(window.ARN_GEN).filter((k) => window.ARN_GEN[k].media.includes(media));
// เว็บสร้าง "รูป" สำหรับหน้าคลิปเร็วที่ทำพื้นหลังเป็นรูป
window.ARN_GEN_IMAGE = window.ARN_GEN_FOR('image');
