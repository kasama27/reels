const $ = (id) => document.getElementById(id);
const msg = (t, cls = '') => { $('msg').textContent = t; $('msg').className = `msg ${cls}`; };

chrome.storage.local.get(['serverUrl', 'token']).then((v) => {
  $('url').value = v.serverUrl || 'http://127.0.0.1:8791';
  $('token').value = v.token || '';
});

$('save').addEventListener('click', async () => {
  const url = $('url').value.trim().replace(/\/+$/, '') || 'http://127.0.0.1:8791';
  const token = $('token').value.trim();
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) return msg('ที่อยู่ต้องเป็นเครื่องนี้เท่านั้น เช่น http://127.0.0.1:8791', 'bad');
  if (!token) return msg('วางรหัสจับคู่ก่อน', 'bad');
  await chrome.storage.local.set({ serverUrl: url, token });
  msg('กำลังทดสอบ…');
  const r = await chrome.runtime.sendMessage({ type: 'ping' });
  if (r?.ok) msg('✓ เชื่อมต่อ Arn Reels สำเร็จ — เปิด meta.ai ได้เลย', 'ok');
  else msg(`ต่อไม่สำเร็จ: ${r?.error || 'ไม่ทราบสาเหตุ'}`, 'bad');
});
