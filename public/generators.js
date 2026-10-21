// แคตตาล็อกเว็บสร้างรูป/คลิปด้วย AI — ใช้ร่วมกันทั้งหน้า "คลิปเร็ว" (app.js) และ "โปรเจกต์เรื่อง" (story.js)
// prompt เหมือนกันทุกเว็บ ต่างแค่คำแนะนำและลิงก์ · tip(aspect) = คำแนะนำของเว็บนั้น (aspect เช่น '9:16')
window.ARN_GEN = {
  flow: { name: 'Google Flow (Nano Banana 2.1)', short: 'Google Flow', url: 'https://flow.google.com',
    tip: (a) => `ใน Flow: เลือกโมเดล Nano Banana 2.1 และสัดส่วน ${a} ที่มุมขวาล่างของช่องพิมพ์ ตั้งจำนวนเป็น x1 ถ้าอยากได้รูปเดียวต่อ prompt แล้ววาง prompt` },
  chatgpt: { name: 'ChatGPT', short: 'ChatGPT', url: 'https://chatgpt.com',
    tip: (a) => `ใน ChatGPT: วาง prompt แล้วระบุสัดส่วน ${a} ในข้อความถ้ารูปออกมาผิดสัดส่วน` },
  meta: { name: 'Meta AI', short: 'Meta AI', url: 'https://meta.ai',
    tip: () => 'ใน Meta AI: เลือกโหมดสร้างรูปภาพก่อนวาง prompt' },
  seedance: { name: 'Seedance (วิดีโอ)', short: 'Seedance', url: '',
    tip: () => 'สำหรับ Seedance: ใช้ปุ่ม “🎬 prompt รวมฉาก” วางทีละกลุ่ม (ปรับวินาทีต่อครั้งให้ตรงกับที่โมเดลสร้างได้) แล้วนำคลิปที่ได้มาแนบเข้าช็อตแรกของกลุ่ม' },
};
// เว็บสร้าง "รูป" (ไม่รวม seedance ที่เป็นวิดีโอล้วน) — ใช้ในหน้าคลิปเร็วที่ทำพื้นหลังเป็นรูป
window.ARN_GEN_IMAGE = ['flow', 'chatgpt', 'meta'];
