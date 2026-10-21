// บริบทของคำขอ HTTP ปัจจุบัน: signal ที่ถูกยกเลิกเมื่อหน้าเว็บตัดการเชื่อมต่อ (กดปุ่ม “หยุด”)
// ใช้ AsyncLocalStorage เพื่อให้ claude-cli รู้ว่างานนี้ถูกยกเลิก โดยไม่ต้องส่ง signal ผ่านทุกฟังก์ชันของ ai.js
const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();
store.CANCELLED = 'ยกเลิกแล้ว'; // ข้อความ error เมื่อผู้ใช้กดหยุด — เซิร์ฟเวอร์ไม่ log และไม่ตอบ (การเชื่อมต่อปิดไปแล้ว)
store.isCancel = (e) => e && e.message === store.CANCELLED;

module.exports = store;
