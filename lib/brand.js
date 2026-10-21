// สไตล์ประจำเพจ: ให้ทุกโพสต์ได้โทนเดียวกัน — โทนภาพ (ใส่ใน prompt วิดีโอ/รูป) + น้ำเสียงข้อความ (สคริปต์/แคปชัน) + แฮชแท็กประจำเพจ
// ผู้ใช้เลือกโทนสำเร็จรูปแล้วแก้ข้อความเองได้ — เก็บใน config.json (cfg.brand)
const cfg = require('./config');

const SENSITIVE = 'ถ้าเรื่องที่เล่าเป็นข่าวอ่อนไหว (มีผู้เสียชีวิต/บาดเจ็บ อุบัติเหตุ อาชญากรรม ภัยพิบัติ สงคราม) ให้ลดความเล่นลงและใช้โทนสุภาพ';

const PRESETS = [
  {
    id: 'mystic', name: '🔮 ลึกลับ / ดูดวง', theme: 'stars',
    desc: 'น่าค้นหา นิ่ง มีเสน่ห์ เหมาะดูดวง ราศี พลังงานชีวิต',
    visual: 'cinematic illustration, deep navy and gold color palette, soft golden glow, shallow haze, mystical calm mood',
    voice: 'น้ำเสียงนิ่ง อบอุ่น มีเสน่ห์ ชวนให้อยากรู้ต่อ ใช้คำสุภาพ ไม่ฟันธงเกินจริง ไม่ขู่ ไม่ให้คำมั่นเรื่องโชคลาภ/ความรัก',
    tags: '#ดูดวง #ราศี',
  },
  {
    id: 'news', name: '📰 ข่าว / ความรู้ น่าเชื่อถือ', theme: 'ocean',
    desc: 'สุภาพ ตรงไปตรงมา ข้อมูลชัด ไม่พาดหัวเกินจริง',
    visual: 'clean editorial illustration, muted teal and amber color palette, soft natural light, calm balanced composition',
    voice: 'น้ำเสียงสุภาพ กระชับ เป็นกลาง ข้อมูลตรง ไม่เร้าอารมณ์ ไม่พาดหัวเกินจริง ไม่ฟันธงเกินที่แหล่งข้อมูลระบุ',
    tags: '',
  },
  {
    id: 'funny', name: '🤪 ตลก กวน ๆ ปากเก่ง', theme: 'sun',
    desc: 'พูดไปเรื่อยแบบเพื่อนเล่าเรื่อง จังหวะเร็ว มีมุกหักมุมท้าย เหมาะช่องคอนเทนต์ตลก',
    visual: 'bold playful cartoon illustration, saturated warm colors, thick outlines, exaggerated funny expressions, dynamic comic framing, high energy',
    voice: `กวน ๆ ปากเก่ง พูดไปเรื่อยแบบเพื่อนเล่าเรื่องให้ฟัง ใช้ภาษาพูดไทยธรรมชาติ ประโยคสั้น จังหวะเร็ว ขึ้นต้นด้วยประโยคที่ทำให้สงสัยหรือแซวตัวเอง แล้วหักมุมหรือปิดท้ายด้วยมุก (วางมุกก่อนแล้วค่อยเฉลย) แซวเบา ๆ ได้ แต่ไม่หยาบคาย ไม่ด่า ไม่ล้อบุคคลหรือกลุ่มคน ไม่ล้อเรื่องเพศ ศาสนา ความพิการ หรือผู้ที่ประสบเหตุร้าย ${SENSITIVE}`,
    tags: '#ตลก #ขำขัน',
  },
  {
    id: 'deadpan', name: '😐 ตลก ประชดเบา ๆ (เสียดสีหน้านิ่ง)', theme: 'dark',
    desc: 'เล่าเรียบ ๆ หน้านิ่ง แต่ประโยคแสบ เหมาะมุกแซวชีวิตประจำวัน',
    visual: 'minimalist flat illustration, muted charcoal and soft cream palette with one bright accent color, deadpan characters, simple funny composition',
    voice: `เล่าเสียงเรียบ หน้านิ่ง แต่เนื้อหาแสบ ๆ ประชดชีวิตประจำวันแบบไม่ทำร้ายใคร ประโยคสั้น ตรงไปตรงมา ใช้การพูดน้อยกว่าที่คิดให้ตลก ปิดด้วยประโยคสรุปที่เจ็บ ๆ แต่ขำ ไม่หยาบคาย ไม่ล้อบุคคลหรือกลุ่มคน ${SENSITIVE}`,
    tags: '#ตลก #มุกแซวชีวิต',
  },
  {
    id: 'cheerful', name: '🌈 สดใส / ไลฟ์สไตล์', theme: 'mint',
    desc: 'ร่าเริง เป็นกันเอง เหมาะไลฟ์สไตล์ รีวิว ของน่าสนใจ',
    visual: 'bright pastel flat illustration, warm sunlight, cheerful clean composition, soft mint and peach color palette',
    voice: 'น้ำเสียงร่าเริง เป็นกันเอง เหมือนเพื่อนแนะนำของดี ๆ ประโยคสั้น พลังบวก ไม่โอเวอร์ ไม่อ้างสรรพคุณเกินจริง',
    tags: '',
  },
  {
    id: 'warm', name: '🧡 อบอุ่น / ให้กำลังใจ', theme: 'rose',
    desc: 'นุ่มนวล เข้าใจ ให้กำลังใจ เหมาะคำคม ข้อคิด เรื่องความรู้สึก',
    visual: 'soft warm watercolor illustration, peach and rose color palette, gentle golden sunlight, tender calm mood',
    voice: 'น้ำเสียงนุ่มนวล อบอุ่น เข้าใจ พูดเหมือนคนใกล้ชิดที่หวังดี ไม่สั่งสอน ไม่ตัดสิน ปิดท้ายด้วยกำลังใจสั้น ๆ',
    tags: '',
  },
  {
    id: 'minimal', name: '🖤 เรียบหรู มินิมอล', theme: 'dark',
    desc: 'สั้น เรียบ มีรสนิยม เหมาะคอนเทนต์พรีเมียม',
    visual: 'minimalist elegant illustration, charcoal and soft white palette with a single accent color, generous negative space, refined soft lighting',
    voice: 'น้ำเสียงเรียบหรู สั้น กระชับ มีรสนิยม ไม่ใช้คำฟุ่มเฟือยหรืออีโมจิ ทุกประโยคต้องมีน้ำหนัก',
    tags: '',
  },
];

const EMPTY = { preset: '', visual: '', voice: '', tags: '', logoOn: true };
const get = () => ({ ...EMPTY, ...(cfg.brand || {}) });

// ข้อความที่ต่อท้ายคำสั่ง (system prompt) ของ AI — ไม่ตั้งสไตล์ไว้ = ว่าง (พฤติกรรมเดิม)
function note(kind) {
  const b = get();
  if (kind === 'visual' && b.visual) {
    return `\n\nสไตล์ภาพประจำเพจ: ให้ใช้สไตล์นี้เป็น "สไตล์ภาพบรรทัดเดียวกัน" ที่ใส่ท้ายทุก prompt แทนการคิดสไตล์เอง (ยังต้องทำตามกติกาข้างบนทุกข้อ เช่น ไม่มีตัวอักษรในภาพ): ${b.visual}`;
  }
  if (kind === 'voice' && b.voice) {
    return `\n\nน้ำเสียงประจำเพจ (ใช้กับข้อความทั้งหมดที่คุณเขียน แต่ห้ามแต่งตัวเลข/ข้อเท็จจริงเพิ่ม และต้องทำตามกติกาข้างบนทุกข้อ): ${b.voice}`;
  }
  if (kind === 'tags' && b.tags) {
    return `\n\nแฮชแท็กประจำเพจ: ใส่แฮชแท็กต่อไปนี้ทุกครั้ง (นับรวมในจำนวนแฮชแท็กทั้งหมด) แล้วเลือกแฮชแท็กตามเรื่องเพิ่มให้ครบ: ${b.tags}`;
  }
  return '';
}

function summary() {
  const b = get();
  const p = PRESETS.find((x) => x.id === b.preset);
  return { name: p ? p.name : (b.visual || b.voice || b.tags ? 'กำหนดเอง' : ''), theme: p?.theme || '', logoOn: b.logoOn !== false };
}

module.exports = { PRESETS, get, note, summary, EMPTY };
