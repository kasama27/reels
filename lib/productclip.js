// คลิปสินค้า (Meta AI): เทมเพลต prompt ของผู้ใช้ + การเติมข้อมูลสินค้าลงช่อง [..] + ตั้งค่าที่เกี่ยวข้อง
// ตั้งค่าเก็บเป็นไฟล์ JSON ใน data/ (แก้ได้จากหน้าคลังสินค้า) — ไม่ต้องรีสตาร์ต
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'data', 'product-clip.json');

// prompt ต้นฉบับของผู้ใช้ (V4.0) — ปรับแพลตฟอร์มเป็น Facebook Reels ตอนเติมข้อมูล (ดู fill)
const DEFAULT_TEMPLATE = `# UNIVERSAL ADAPTIVE PRODUCT REVIEW — V4.0

Create a 10-second ultra-realistic vertical 9:16 product introduction video for TikTok and Shopee using the uploaded product image as the primary visual reference.

**PRODUCT ACCURACY:** Strictly preserve the original product shape, colors, logo, packaging, materials, proportions, and visible details. Never modify, redesign, or invent product features.

**ADAPTIVE VISUAL STYLE:** Automatically analyze the product category, size, purpose, materials, and real-world usage. Choose a realistic environment, background, lighting, props, and overall aesthetic that naturally suit the product.

Examples:
- Beauty & Fashion: Cozy feminine lifestyle.
- Automotive Tires & Parts: Professional garage, workshop, or automotive showroom.
- Electronics: Modern minimalist tech environment.
- Home Products: Natural home lifestyle.
- Tools & Equipment: Realistic working environment.

Do not force feminine, pastel, luxurious, or studio settings onto products where they look inappropriate. Maintain photorealistic, premium-quality visuals and authentic product scale.

**CAMERA & ACTION:** Begin with an attractive product hero shot, followed by natural product interaction or realistic usage, and finish with a beautiful close-up. Automatically select appropriate camera angles, movements, and hand interactions. Show hands only when suitable for the product. Use realistic movements and physics.

**TYPOGRAPHY:** Match the uploaded pink iPhone reference typography style. Use modern, softly bold Thai sans-serif similar to LINE Seed Sans TH Heavy. Large, clean, left-aligned lettering with subtle shadow and gentle fade-in animation. Default to white #FFFFFF and pastel pink #F3B6D5, but intelligently adapt highlight colors to match the product, brand, and background while maintaining readability.

**ON-SCREEN TEXT (ONLY):**

Introducing ♡

ขอแนะนำ

[ชื่อสินค้า]

Do not display product benefits, specifications, promotional claims, or additional captions. Keep the product and logo visible, with safe space for TikTok and Shopee interface elements.

If accurate Thai typography cannot be generated, leave clean negative space for adding the text in CapCut. Never generate incorrect Thai characters.

**VOICEOVER:** Natural, warm, friendly female Thai voice saying ONLY "[ชื่อสินค้า]" once, pronounced clearly and correctly. No additional speech.

**AUDIO:** Automatically choose background music and subtle sound effects appropriate to the product category. Keep the music soft and lower than the voiceover.

**AVOID:** Product distortion, incorrect logos, modified packaging, extra fingers, unnatural physics, mismatched environments, inaccurate Thai text, additional speech, extra captions, thick black text outlines, excessive effects, and aggressive advertising styles.

**PRODUCT INPUT:**
- Brand: [ชื่อแบรนด์]
- Product Name: [ชื่อสินค้า]
- Pronunciation: [คำอ่าน หากจำเป็น]
- Product Image: [แนบภาพสินค้าจริง]
- Typography Reference: [แนบภาพโทรศัพท์สีชมพู]
- Duration: 10 seconds

**FINAL RULE:** Automatically adapt the entire visual presentation to the actual product while preserving its identity. Maintain consistent premium typography, natural creator-style realism, and a clean product introduction. Display only the specified introduction text and speak only the product name once.`;

// ข้อความต่อท้ายเมื่อให้ Arn Reels ใส่ตัวอักษรไทยทับเอง (Meta AI มักเขียนตัวไทยผิด)
const NO_TEXT_OVERRIDE = `

**OVERRIDE — TEXT WILL BE ADDED IN EDITING:** Do NOT render any on-screen text, letters, numbers, captions, or watermarks in the video (ignore the TYPOGRAPHY and ON-SCREEN TEXT sections above). Keep the upper-left area of the frame (roughly the top 35%, left two-thirds) clean and uncluttered as negative space during the first 4 seconds, so the Thai introduction text can be overlaid later. The product logo printed on the product itself must still remain visible and accurate.`;

// บรรทัดปิดท้าย (เรียนจาก Pondy): ไม่มีบรรทัด "ทำเลยไม่ต้องถามกลับ" Meta AI มักตอบเป็นแผน/คำถามแล้วรอ
// และถ้าให้คนในคลิป "ถือ/หยิบ" สินค้า Meta มักวาดสินค้าใหม่จนไม่ตรงของจริง → ให้ชี้/แตะเบา ๆ แทน
const FINISH = `

**PRODUCT FIDELITY:** Keep the real product from the first image exactly as it is (shape, color, label, logo). If hands appear, they only point at or lightly touch the product resting on a surface — do not pick it up, unwrap it, or redraw it.

ทำเลยไม่ต้องถามกลับ สร้างเป็นวิดีโอแนวตั้ง 9:16 ความยาวประมาณ 10 วินาที แล้วส่งคลิปกลับมาอย่างเดียว ไม่ต้องอธิบายหรือถามยืนยัน`;

// prompt หลักของเจ้าของ (1 พ.ย. — 4 ช็อต 10 วิ สไตล์ไวรัล) + บรรทัดชื่อสินค้า + บรรทัดปิดท้ายแบบ Pondy · prompt ยาว ~4,300 ตัว (V4.0 + ข้อความต่อท้าย) Meta AI ตอบ "เกิดข้อผิดพลาด" (เจอจริง 1 พ.ย.)
// ส่วนแบบสั้นที่ทดสอบแล้วได้วิดีโอ 10 วิ 720x1280 · [..] เติมใน fillCompact
const COMPACT = `Create a 9:16 vertical product review video, fast-paced viral Reels style, exactly 10 seconds, 4 quick shots.
Use the product in the attached image EXACTLY as it looks (same shape, colors, logo, details). Do not redesign it.
[สินค้า]
First identify what the product is and where it is normally used, then build the scenes around that.

Shot 1 – HOOK (0–2.5s): Dramatic cinematic close-up of the product in its natural setting, fast push-in, warm golden light flare sweeping across it. Leave empty space in the upper third for a title.
Shot 2 – IN ACTION (2.5–6s): A person's hands using the product the way it is meant to be used, clear and satisfying motion, bright natural light.
Shot 3 – DETAIL (6–8.5s): Quick macro shot of the product's best feature, smooth orbit camera, crisp lighting.
Shot 4 – RESULT (8.5–10s): The happy result, product placed proudly in frame, quick zoom out.

Style: realistic, high contrast, vivid natural colors, cinematic lighting, snappy cuts with light-flash transitions, energetic viral TikTok/Reels feel.
[ข้อความ]

ทำเลยไม่ต้องถามกลับ สร้างเป็นวิดีโอแนวตั้ง 9:16 ความยาว 10 วินาที แล้วส่งคลิปกลับมาอย่างเดียว ไม่ต้องอธิบายหรือถามยืนยัน`;
const TEXT_LATER = 'No on-screen text, no subtitles, no watermarks, no extra logos.';
const TEXT_ON = 'Show the product name as large, clean Thai title text in the empty upper third during Shot 1 only. No subtitles, no watermarks, no extra logos.';

// style: 'compact' (ค่าเริ่มต้น) = prompt สั้นด้านบน · 'full' = เทมเพลตเต็มของผู้ใช้ (template)
const DEFAULTS = { template: DEFAULT_TEMPLATE, overlay: true, typoRef: '', finish: true, style: 'compact', coverAt: 0.4, coverText: true }; // coverAt = วินาทีของเฟรมหน้าปก Reels

function load() {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...v, template: typeof v.template === 'string' && v.template.trim() ? v.template : DEFAULT_TEMPLATE };
  } catch { return { ...DEFAULTS }; }
}
function save(patch) {
  const next = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

// ชื่อที่ใช้ในคลิป: ชื่อสั้นที่ผู้ใช้ตั้ง หรือชื่อสินค้าจาก Shopee ตัดคำโปรโมต/ยาวเกินออก
function clipName(p) {
  if (p.clip_name && p.clip_name.trim()) return p.clip_name.trim();
  const words = String(p.name || '').replace(/[\[【(（].*?[\]】)）]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  let out = '';
  for (const w of words) { // ตัดที่ช่องว่าง ไม่ตัดกลางคำ (ยาวไม่เกิน ~36 ตัวอักษร)
    if (out && (out + ' ' + w).length > 36) break;
    out = out ? `${out} ${w}` : w;
  }
  return out.slice(0, 40);
}

// เติมข้อมูลสินค้าลงเทมเพลต → prompt สำหรับ Meta AI
function fill(p, s = load()) {
  const name = clipName(p);
  if (s.style !== 'full') {
    const brand = p.brand && p.brand.trim() ? `, brand ${p.brand.trim()}` : '';
    return COMPACT.replace('[สินค้า]', `Product: "${name}"${brand}.`)
      .replace('[ข้อความ]', s.overlay ? TEXT_LATER : TEXT_ON);
  }
  let t = s.template
    .replace(/TikTok\s*(?:and|&|\/)\s*Shopee/gi, 'Facebook Reels')
    .replace(/\[ชื่อแบรนด์\]/g, p.brand && p.brand.trim() ? p.brand.trim() : '(no brand — do not invent a logo)')
    .replace(/\[ชื่อสินค้า\]/g, name)
    .replace(/\[คำอ่าน[^\]]*\]/g, p.say && p.say.trim() ? p.say.trim() : '(read naturally as written)')
    .replace(/\[แนบภาพสินค้าจริง\]/g, 'attached — first image')
    .replace(/\[แนบภาพโทรศัพท์สีชมพู\]/g, s.typoRef ? 'attached — second image' : '(not attached — use the style described)');
  if (s.overlay) t += NO_TEXT_OVERRIDE;
  if (s.finish !== false && !/ทำเลยไม่ต้องถามกลับ/.test(t)) t += FINISH;
  return t;
}

module.exports = { DEFAULT_TEMPLATE, FINISH, load, save, fill, clipName };
