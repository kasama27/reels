# คลิปแนะนำสินค้า (Shopee Affiliate → Meta AI → เพจ Facebook)

สเปกฉบับปัจจุบัน (30 ต.ค. 2026) ของงานหลักของ Arn Reels — ถ้าขัดกับ docs/01–13 ให้เชื่อไฟล์นี้

> 1 พ.ย.: ขั้นเก็บสินค้าและขั้นสั่งสร้างคลิปปรับตามแอป Pondy แล้ว — ดู [15-pondy-collect.md](15-pondy-collect.md), [16-pondy-clip.md](16-pondy-clip.md) และตารางสรุป [17-pondy-to-reels.md](17-pondy-to-reels.md) (แผงหยุดเมื่อเจอ CAPTCHA, เปลี่ยนหน้าแบบรอรายการเปลี่ยน, แชทใหม่ทุกชิ้นบน Meta AI, อ่าน prompt กลับ, prompt ปิดท้าย "ทำเลยไม่ต้องถามกลับ")

## 1. ภาพรวม

```
affiliate.shopee.co.th (Chrome, บัญชีเจ้าของ)
  แผง "หาสินค้า" ── ค้นคีย์เวิร์ด → ติ๊ก → ขอลิงก์แอฟฟิลิเอต ──► POST /ext/products/import
                                                                   │ ดาวน์โหลดรูป · กันซ้ำ (item id/ลิงก์)
                                                                   ▼
Arn Reels  คลังสินค้า (products) ──► คลิปสินค้า kind=product (ร่าง, เข้าคิว)
                                                                   │
meta.ai (Chrome)  แผง "คลิปสินค้า" ◄── GET /ext/products/next (prompt V4.0 เติมแล้ว + รูปที่ต้องแนบ)
  วาง prompt + แนบรูป → เจ้าของกดสร้าง → ✅ ส่ง ──► PUT /ext/clips/:id/raw (วิดีโอดิบ)
                                                                   │
Arn Reels  🎞 ใส่ข้อความ + ทำคลิปเสร็จ (เบราว์เซอร์) ──► PUT /api/clips/:id/video → ready
           ✍ แคปชันสินค้า (AI) ──► caption + hashtags + fb_comment (ลิงก์)
                                                                   │
เพจ Facebook "Liem"  เจ้าของอัปโหลด + วางแคปชัน + คอมเมนต์แรก ──► ✅ โพสต์แล้ว
```

ทางเลือกที่ตัดสินใจแล้ว (30 ต.ค. 2026):
- หาสินค้า **ผ่านส่วนเสริม Chrome บนเว็บแอฟฟิลิเอต (แบบแอป Pondy)** ไม่ใช้ Shopee Affiliate Open API
- เลือกสินค้าจาก **คลังสินค้าของ Reels** (ไม่ใช่วางลิงก์ทีละอัน)
- วิดีโอสร้างด้วย **Meta AI** ด้วย prompt "UNIVERSAL ADAPTIVE PRODUCT REVIEW — V4.0" ของเจ้าของ (ปรับ "TikTok and Shopee" เป็น Facebook Reels อัตโนมัติ)
- ข้อความไทย **Reels ใส่เองเป็นค่าเริ่มต้น** (Meta AI เขียนตัวไทยผิดบ่อย) — สั่ง Meta AI เว้นพื้นที่ซ้ายบนแทน ปิดได้ในตั้งค่า
- ลิงก์อยู่ **คอมเมนต์แรก** ไม่อยู่ในแคปชัน
- โพสต์ **ทำมือ**

## 2. หาสินค้า (extension/shopee.js + shopee-hook.js)

- `shopee-hook.js` รันใน world MAIN ตั้งแต่ `document_start` บน `affiliate.shopee.co.th/*`: ห่อ `fetch`/`XMLHttpRequest` เก็บสำเนาคำตอบ JSON ของ `/api/*` (same-origin) ส่งให้แผงทาง `window.postMessage` (tag `arn-shp`) และรับคำสั่งให้ยิงคำขอแทนแผงด้วย fetch เดิมของหน้า (คุกกี้ของเจ้าของ)
- **เรียนรู้วิธีค้น**: คำตอบใดที่อ่านเป็นรายการสินค้าได้ และคำขอนั้นมีพารามิเตอร์คีย์เวิร์ด (`keyword|query|q|search…`) → เก็บเป็นแม่แบบ (url, method, headers, body, ตำแหน่งคีย์เวิร์ด, ตำแหน่งหน้า/offset) ใน `chrome.storage.local.shpTpl` · เจ้าของกดแท็บ/การเรียงใหม่ในเว็บเมื่อไหร่ แม่แบบอัปเดตตาม
- **ค้นจากแผง**: แทนคีย์เวิร์ดและหน้า → ยิงซ้ำทีละหน้า เว้น 0.9–1.8 วิ สูงสุด 6 หน้า (10 หน้าถ้าเรียงในแผง)
- **อ่านสินค้า**: เดินหา object ที่มี `item_id|itemid|itemId` + ชื่อ → `{item_id, shop_id, name, image_url, price, commission, sales, shop}` · ราคาที่ ≥ 100000 หาร 100000 · ค่าคอม < 1 คูณ 100 · รูปที่เป็น hash → `https://down-th.img.susercontent.com/file/<hash>`
- **ตัวกรอง/เรียงในแผง**: จำนวน 5–50 · ราคาขั้นต่ำ · ค่าคอมขั้นต่ำ % · เรียง: ตามเว็บ / ค่าคอม % สูงสุด / ขายดีสุด · ซ่อนที่มีในคลังแล้ว (`POST /ext/products/known`)
- **ลิงก์แอฟฟิลิเอต**: `POST /api/v3/gql?q=productOfferLinks` operation `batchGetProductOfferLink` (คำขอเดียวกับปุ่ม "เอา ลิงก์" — แอป Pondy ใช้ตั้งแต่ 24 ส.ค. 2026 ดู `app/src/main/assets/shopee_offer_links.js`) ทีละ 20 ชิ้น ต้องมี `shopId`
- **ส่งเข้า Reels**: `POST /ext/products/import {items, queue}`
- **ส่งคีย์เวิร์ดจาก Reels** (31 ต.ค.): หน้าต่าง 🛍 สินค้า ขั้น ① มีช่องคีย์เวิร์ด + จำนวน → เปิด `https://affiliate.shopee.co.th/offer/product_offer#arn_kw=<คำ>&arn_n=<จำนวน>` · `shopee-hook.js` อ่าน hash ตอน `document_start` เก็บใน `sessionStorage.arnShpKw` แล้วลบออกจาก URL · `shopee.js` ใส่คำในแผงและค้นให้เองถ้าเรียนรู้วิธีค้นแล้ว (ไม่งั้นบอกให้ค้นในเว็บ 1 ครั้งก่อน) · หน้า Reels คัดลอกคีย์เวิร์ดลงคลิปบอร์ดสำรองไว้ด้วย
- ปุ่ม **ตรวจหน้า** แสดงแม่แบบที่จำไว้ คำขอ API ล่าสุด ฟิลด์ของสินค้าชิ้นแรก — ใช้ปรับตัวอ่านเมื่อเว็บเปลี่ยน
- ทดสอบแล้วกับหน้าจำลองเท่านั้น (30 ต.ค.) ยังไม่ได้ลองกับเว็บจริง

### หน้าต่าง 🛍 สินค้า ใน Reels (31 ต.ค.)
แบ่ง 3 ขั้น (แท็บบนสุด + ปุ่มถัดไป/ย้อนกลับ จำขั้นล่าสุดใน localStorage): ① หาสินค้า (คีย์เวิร์ด → Shopee · เพิ่มเอง/วางหลายรายการ/ดึงจาก Pondy พับไว้) ② เลือกสินค้าในคลัง (ติ๊ก รูป แก้ไข) ③ ทำคลิป (สร้างคิว + ขั้นตอน meta.ai · ⚙ ตั้งค่า prompt พับไว้) · กลับมาที่แท็บ Reels แล้วคลังมีสินค้าเพิ่ม → พาไปขั้น ② เอง

### ค้นจากร้านค้า (31 ต.ค. — ตรวจ API กับเว็บจริงแล้ว)
- ค้นร้าน: `GET /api/v3/offer/shop/list?sort_type=1&page_offset=0&page_limit=20&keyword=<ชื่อร้าน>` → `data.list[{shop_id, shop_name, shop_image, commission_rate, long_link}]`
- สินค้าในร้าน: `GET /api/v3/offer/product/list?list_type=5&match_type=1&match_id=<shop_id>&sort_type=2|5&page_offset=<n×20>&page_limit=20&client_type=1` (sort 2 = ขายดี, 5 = ค่าคอมสูง, 3/4 = ราคา) → `data.list[{item_id, seller_commission_rate, batch_item_for_item_card_full:{itemid, shopid, shop_name, name, image(hash), price(×100000), sold, historical_sold}}]` · `data.total_count`
- หน้าเว็บ: ข้อเสนอร้านค้า = `/offer/brand_offer` · รายละเอียดร้าน = `/offer/brand_offer/<shop_id>`
- Reels ส่ง `#arn_kw=<ชื่อร้าน>&arn_shop=1&arn_n=` → แผงเข้าโหมดร้านค้าและค้นให้
- products: คอลัมน์ `shop`, `shop_id` · `GET /api/products/shops` · `GET /api/products?shop=`

## 3. ข้อมูล

### products (คลังสินค้า) — คอลัมน์ที่เพิ่ม
| ฟิลด์ | ความหมาย |
|---|---|
| `item_id` | รหัสสินค้า Shopee (กันเก็บซ้ำ มีดัชนี) |
| `image` | ไฟล์รูปสินค้าใน `data/clip-images/` (sha1.ext) — ลบคลิปไม่ลบรูปนี้ |
| `brand` | แบรนด์ (เติม `[ชื่อแบรนด์]`) |
| `clip_name` | ชื่อในคลิป (สั้น) — ว่าง = ตัดจากชื่อสินค้าที่ช่องว่าง ≤ ~36 ตัวอักษร ตัด `[...]` `(...)` |
| `say` | คำอ่าน (เติม `[คำอ่าน …]`) |
| `src` | `shopee-aff` = มาจากแผงหาสินค้า · `pondy:<serial>` = นำเข้าจากมือถือ · `''` = เพิ่มเอง |
| `note` / `tags` / `sales` | แผงใส่ "ราคา ฿x · ค่าคอม y% · ร้าน z" / คีย์เวิร์ด / ยอดขาย |

### clips — คอลัมน์ที่เพิ่ม
| ฟิลด์ | ความหมาย |
|---|---|
| `kind = 'product'` | คลิปสินค้า |
| `product_id` | สินค้าต้นทาง |
| `raw_video` | วิดีโอดิบจาก Meta AI ใน `data/product-videos/` (`praw-<id>-<ts>.mp4|webm`) |
| `fb_comment` | คอมเมนต์แรก: ข้อความนำ + ลิงก์ + "(ลิงก์แอฟฟิลิเอต)" |
| `narr_tone` | สไตล์เสียงพากย์ (ใช้ร่วมทุกโหมด) |

สถานะคลิปสินค้า: ร่าง (รอวิดีโอ Meta AI) → ร่าง + `raw_video` (รอทำคลิปเสร็จ) → `ready` (มี `video_file`) → `posted` · แนบวิดีโอดิบใหม่ = ล้างคลิปจริงเดิม กลับเป็นร่าง

### ตั้งค่า `data/product-clip.json`
`template` (prompt, ว่าง = V4.0 ตั้งต้น) · `overlay` (true = Reels ใส่ข้อความไทยเอง + ต่อท้าย prompt ให้ Meta AI ไม่ใส่ตัวอักษร) · `typoRef` (ไฟล์รูปอ้างอิงตัวอักษร โทรศัพท์ชมพู)

## 4. การเติม prompt (`lib/productclip.js → fill`)

- `TikTok and Shopee` → `Facebook Reels`
- `[ชื่อแบรนด์]` → brand หรือ "(no brand — do not invent a logo)"
- `[ชื่อสินค้า]` → ชื่อในคลิป · `[คำอ่าน …]` → say หรือ "(read naturally as written)"
- `[แนบภาพสินค้าจริง]` → "attached — first image" · `[แนบภาพโทรศัพท์สีชมพู]` → "attached — second image" ถ้ามี typoRef
- overlay เปิด → ต่อท้ายบล็อก OVERRIDE: ห้ามมีตัวอักษรในวิดีโอ เว้นพื้นที่ซ้ายบน 4 วินาทีแรก
- prompt **เติมใหม่ทุกครั้ง** ที่ส่วนเสริมดึงคิว → แก้เทมเพลต/ข้อมูลสินค้าแล้วมีผลกับคิวที่รออยู่ทันที (ค่าที่เก็บใน `video_prompts` ใช้แค่ตอนสินค้าถูกลบ)

## 5. ทำวิดีโอบน meta.ai (extension/content.js โหมด 🛍 คลิปสินค้า)

- คิว = คลิป kind=product ที่ไม่มี `raw_video` และไม่มี `video_file` เรียง `created_at` เก่าสุดก่อน
- "วาง prompt + แนบรูป": ดึงรูปผ่าน `/ext/img/<file>` (เฉพาะรูปสินค้าในคลัง + typoRef) → แนบโดยลอง `input[type=file]` → paste event → drop event → วาง prompt ลงช่องพิมพ์ (ไม่กดส่ง)
- เจอ `<video>` ใหม่ในหน้า → ✅ ส่งเข้า Arn Reels → `PUT /ext/clips/:id/raw` → ไปชิ้นถัดไป
- สำรอง: ⬇ ดาวน์โหลดรูป (ลากใส่เอง) · 📎 แนบวิดีโอ Meta AI ที่การ์ดในคลัง (`PUT /api/clips/:id/raw`)
- ทดสอบแล้วกับหน้าจำลองเท่านั้น (30 ต.ค.)

## 6. ทำคลิปเสร็จ (public/app.js → finishProduct)

`ReelRender.assemble([{url: /product-raw/<raw>}], {keepAudio: true, music, logo, intro})` — เก็บเสียงของ Meta AI, เพลงเสริมเลือกตอนสร้างคิว (ค่าเริ่มต้นไม่ใส่), โลโก้เพจ, และ `intro` = "Introducing ♡" (ชมพู #F3B6D5) / "ขอแนะนำ" / ชื่อในคลิป (ขาว) ชิดซ้ายช่วงบน ค่อย ๆ ขึ้นทีละบรรทัด เงาบาง ไม่มีขอบหนา ฟอนต์ LINE Seed Sans TH ถ้าติดตั้งไว้ → อัปโหลดเป็นคลิปจริง → ถ้ายังไม่มีแคปชันและต่อ AI ไว้ เรียก `/api/clips/:id/product-post`

## 7. API

| Method | Path | ผู้เรียก | หน้าที่ |
|---|---|---|---|
| GET/PUT | /api/product-clips/settings | หน้าเว็บ | อ่าน/บันทึก template, overlay, typoRef (+ จำนวนในคิว) |
| GET | /api/product-clips/preview/:productId | หน้าเว็บ | prompt ที่เติมแล้วของสินค้าหนึ่งชิ้น |
| POST | /api/product-clips | หน้าเว็บ | สร้างคลิปสินค้าจาก `product_ids` (≤100) + `music` |
| POST | /api/clips/:id/product-post | หน้าเว็บ | AI เขียน caption + hashtags + fb_comment |
| PUT | /api/clips/:id/raw | หน้าเว็บ | แนบวิดีโอดิบเอง |
| GET | /product-raw/:file | หน้าเว็บ | เสิร์ฟวิดีโอดิบ (Range) |
| GET | /ext/products/next | ส่วนเสริม | คิวถัดไป `{total, waiting, done, next:{clip, product, prompt, images}}` |
| GET | /ext/img/:file | ส่วนเสริม | รูปที่ต้องแนบ (เฉพาะรูปสินค้า/typoRef) |
| PUT | /ext/clips/:id/raw | ส่วนเสริม | ส่งวิดีโอดิบ → คืนคิวถัดไป |
| POST | /ext/products/known | ส่วนเสริม | item id ไหนมีในคลังแล้ว |
| POST | /ext/products/import | ส่วนเสริม | เพิ่มสินค้า (ลิงก์ต้องเป็น s.shopee.co.th / shope.ee / shp.ee) ดาวน์โหลดรูปจาก susercontent/shopee + เข้าคิว |

ทุก `/ext/*` ต้องมีหัว `x-arn-token` (รหัสจับคู่ในตั้งค่า) Host ต้องเป็นเครื่องนี้ Origin ว่างหรือ `chrome-extension://`

## 8. โพสต์ ช่องทาง ตาราง (31 ต.ค.)

- **ช่องทาง** (`lib/channels.js` ตาราง `channels`): kind `fb`|`yt`, name, url, goal (ต่อวัน), kinds (ชนิดคลิปที่ลง), times (เวลาประจำ), tone, active · เริ่มต้นมี Liem (product · 09:00,12:00,19:00 · 3)
- **โพสต์แยกช่องทาง** (`clip_posts` clip_id+channel_id, posted_at, url): `POST /api/clips/:id/posted {channel_id, fb_url}` → คลิปเป็น posted (posted_at = ครั้งแรก) · `unposted {channel_id?}` ไม่เหลือช่องทางแล้วกลับเป็น ready · list/get คลิปแนบ `posts`
- **ตาราง** (`schedule` channel_id, day, time, clip_id, state wait|set|done|skip): สร้างช่องจาก times อัตโนมัติเมื่อเปิดวันนั้น · autofill = คลิปมีวิดีโอ ตรงชนิด ยังไม่ลงช่องทางนั้น ยังไม่ถูกจอง เก่าก่อน · `due` = ช่อง wait ที่เลยเวลามาไม่เกิน 3 ชม. (หน้าเว็บเช็กทุกนาที)
- **แผงโพสต์บน Meta Business Suite** (`extension/fbpost.js`): `/ext/post/next?channel=` (คลิปที่จองในตารางวันนี้ก่อน) → แนบวิดีโอ (`/ext/clips/:id/video` Range ทีละ 6MB → File → input[type=file] / drop) → วางแคปชัน (execCommand insertText / paste) → คอมเมนต์ → `/ext/clips/:id/posted` · ไม่กดเผยแพร่ · สั่งด้วย `CustomEvent('arn-post', {detail})` สถานะที่ `#arn-post-host`
- **Claude scheduled task** "เตรียมโพสต์ Reels เพจ Liem" 08:44/11:44/18:44: Claude in Chrome → Meta Business Suite → สร้างรีล → แผงด้านบน → แจ้งเจ้าของให้กดเผยแพร่ (ช่วงทดลอง)
- YouTube: ชื่อ ≤100 ตัว + #Shorts · คำอธิบาย = แคปชัน + "ลิงก์สินค้าอยู่ที่หน้าช่อง" + แฮชแท็ก + #Shorts (Shorts กดลิงก์ในคำอธิบาย/คอมเมนต์ไม่ได้)

## 9. ยังไม่ได้ทำ / ความเสี่ยง

- ยังไม่ได้ทดสอบกับหน้า meta.ai, affiliate.shopee.co.th และ Meta Business Suite จริง — โครงหน้าเว็บ/ชื่อฟิลด์ของ Shopee อาจต่างจากที่คาด แก้ด้วยข้อมูลจาก "ตรวจหน้า"
- ปุ่ม "ทำคลิปเสร็จทั้งหมด" ทีเดียวทั้งคิว — ยังไม่มี (ทำทีละคลิป)
- เรียงคิวตามยอดขาย/ค่าคอม — ยังไม่มี (เรียงตามลำดับที่เพิ่ม)
- การใช้ซอฟต์แวร์ช่วยบนเว็บของ Shopee/Meta อาจขัดเงื่อนไขของแพลตฟอร์ม — ออกแบบให้เจ้าของกดสร้างเอง และเว้นจังหวะคำขอ
