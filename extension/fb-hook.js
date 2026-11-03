// รันใน "โลกของหน้าเว็บ" (world: MAIN) บน business.facebook.com / www.facebook.com ตั้งแต่เริ่มโหลด
// ช่องอัปโหลดวิดีโอของหน้าสร้าง Reels ถูกสร้างตอนกด "เพิ่มวิดีโอ" แล้วเปิดหน้าต่างเลือกไฟล์ทันที (ไม่มีอยู่ในหน้าให้แผงหา)
// → เมื่อแผง Arn Reels ตั้งธง data-arn-capture-file="1" ที่ <html> ไว้: ไม่เปิดหน้าต่างเลือกไฟล์ แต่เอาช่องนั้นใส่ไว้ในหน้า (ซ่อน) ให้แผงใส่ไฟล์เอง
// ไม่มีธง = ทำงานปกติทุกอย่าง · ไม่อ่าน/ส่งข้อมูลใด ๆ
(() => {
  if (window.__arnFbHook) return;
  window.__arnFbHook = true;
  const P = HTMLInputElement.prototype;
  const capture = (inp) => {
    if (inp.type !== 'file' || document.documentElement.dataset.arnCaptureFile !== '1') return false;
    if (!inp.isConnected) { inp.style.display = 'none'; document.body.append(inp); }
    inp.dataset.arnCaptured = '1';
    document.documentElement.dataset.arnCaptureFile = 'got';
    return true;
  };
  const oc = P.click;
  P.click = function () { if (capture(this)) return undefined; return oc.call(this); };
  if (P.showPicker) { const os = P.showPicker; P.showPicker = function () { if (capture(this)) return undefined; return os.call(this); }; }
})();
