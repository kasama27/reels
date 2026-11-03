# Pondy (AffiliateMobile) — ขั้นตอนเก็บสินค้า Shopee Affiliate

> **ที่มา:** อ่านจากซอร์ส `C:\Users\AVESTA4\Desktop\app\app` (สำเนาที่แตกจาก app.rar) (แตกจาก app.rar ฉบับ **5 ต.ค. 2026**)
> **ข้อควรระวัง:** `ShopeeWebDriver.kt` ในเครื่องเจ้าของเป็นฉบับ **29 ต.ค. 2026** ซึ่งใหม่กว่าที่อ่านในเอกสารนี้ พฤติกรรมบางจุดอาจเปลี่ยนไปแล้ว เลขบรรทัดทั้งหมดอ้างอิงฉบับ 5 ต.ค.
>
> ตัวย่อ path: `D` = `app/src/main/kotlin/com/affiliatemobile/spike/shopee/ShopeeWebDriver.kt`,
> `A` = `.../shopee/ShopeeWebActivity.kt`, `pick` = `app/src/main/assets/shopee_pick.js`,
> `first` = `assets/shopee_first.js`, `links` = `assets/shopee_offer_links.js`, `copy` = `assets/shopee_copy_link.js`,
> `O` = `feature/pipeline/.../PipelineOrchestrator.kt`, `S` = `feature/pipeline/.../settings/SettingsStore.kt`

---

## 0. ภาพรวมสั้น ๆ

- Pondy เปิดเว็บ `affiliate.shopee.co.th` ใน WebView ของแอปเอง (`ShopeeWebActivity`) โดยใช้ cookie ล็อกอินของผู้ใช้ แล้วฉีดสคริปต์ JS ลงหน้าเว็บ
- ใช้ WebView 2 ตัว คือ `web` สำหรับหน้าผลค้นหา ซึ่งไม่เคยออกจากหน้านั้นเลย และ `detailWeb` เป็น overlay สำหรับเปิดหน้ารายละเอียดสินค้าหรือร้าน (A:72-75, A:453-469)
- **ทางหลักตอนนี้ (fast path):** ดักคำตอบ API `/offer/product/list` ที่หน้าเว็บโหลดเอง เพื่ออ่าน `item_id`, `shopid`, `image` และ `name` (D:249-277) จากนั้นสร้างลิงก์เองเป็น `https://shopee.co.th/universal-link/product/{shopId}/{itemId}` (D:185-203) แล้วโหลดรูปจาก CDN ฝั่ง native ทางนี้**ไม่ต้องเปิดหน้ารายละเอียดและไม่ต้องกดคัดลอกลิงก์**
- **ทางสำรอง:** เปิดหน้า `/offer/product_offer/{id}` ใน overlay แล้วรัน `shopee_first.js` เพื่อขูดชื่อและรูปจาก DOM ถ้ายังไม่มีลิงก์ก็กด "เอา ลิงก์" ตามด้วย "คัดลอกลิงก์" (D:437-524)
- **ข้อมูลที่ไม่ได้เก็บ:** ราคา ค่าคอม และยอดขายไม่ถูกบันทึกเป็นฟิลด์ใด ๆ มีแค่การอ่านราคาจากข้อความบนการ์ดเพื่อกรองราคาขั้นต่ำ (ดูข้อ 5)

---

## 1. ลำดับขั้น: ตั้งแต่เปิดเว็บจนได้สินค้า 1 ชิ้น (โหมด PRODUCT)

จุดเริ่มคือ `stageProduct(keyword, excludeProductIds, searchMode)` (D:369) ซึ่งถูกเรียกจาก `O.stage()` (O:1512-1533)

| # | ขั้น | URL / สิ่งที่ทำ | รออะไร / timeout | อ้างอิง |
|---|---|---|---|---|
| 1 | หน่วงกันบอต | สุ่มรอ **6–18 วิ** ถ้าเป็นการค้นจริง หรือ **5–10 วิ** ถ้าหยิบจากแคชของหน้าเดิม | — | D:353-365, D:390-394, D:738-754 |
| 2 | หยิบจากแคชก่อน | ถ้าหน้าเดิมยังเหลือ id ที่ยังไม่ใช้ (`candidatePage`) ให้ pop จากหน่วยความจำ โดยไม่ต้องไปที่เว็บ แต่ไม่ใช้กับโหมด "สลับ" | — | D:125-135, D:656-663, D:1130-1149 |
| 3 | เปิดหน้าแรก | `loadUrl("https://affiliate.shopee.co.th/")` (DEFAULT_URL) **ห้าม deep-link ตรงไปหน้า offer** เพราะ Shopee จะเด้งกลับ `/` | `PageLoaded` หรือ `NavBlocked` ภายใน 20 วิ แล้วตรวจล็อกอิน | D:1245-1298, A:870 |
| 4 | route เข้าหน้า offer แบบ in-SPA | รอ 1.5 วิให้ SPA บูต แล้วยิง `location.assign("https://affiliate.shopee.co.th/offer/product_offer")` ซ้ำทุก 2.5 วิ | รอ `PageLoaded` ที่ URL มี `offer/product_offer` ภายใน 20 วิ ถ้าพลาดให้ hard-reload หน้าแรกแล้วลองใหม่ 2 ครั้ง | D:1300-1387 |
| 5 | settle | รอ 1.5 วิ (`OFFER_PAGE_SETTLE_MS`) | — | D:293, D:713-715 |
| 6 | ฉีด `shopee_pick.js` | ตั้ง `window.__pickArgs = {keyword, flow:'product_offer', priceMin, startPage, sort, excludeIds}` แล้วฉีดสคริปต์ | รอ event `picked`/`pickNone` ภายใน 90 วิ (สคริปต์เองมีงบ 75 วิ) | D:794-824, D:917-987, D:302 |
| 6a | TAB | คลิกปุ่มที่มีคำว่า **"ค่าคอมพิเศษ"** (ข้อความยาวไม่เกิน 40 ตัวอักษร) ปุ่มนี้จะพาเข้า listing ที่มีช่องค้นหาและตัวเรียง หน้าเว็บจะยิง `/api/v3/offer/product/list?list_type=7` | หาปุ่มนาน ≤9 วิ หลังคลิกรอ 2.2 วิ +jitter | pick:212-218, 492-510; first:7 |
| 6b | TAB_SETTLE | รอจนมีการ์ด หรือครบ 10 วิ | — | pick:512-525 |
| 6c | SEARCH | หาช่อง input ที่ placeholder มี "ค้นหา/search/สินค้า" และกว้างเกิน 200px ใส่ค่าผ่าน native setter แล้ว dispatch `input`, `change` และ Enter ×3 พร้อม `form.requestSubmit()` และคลิกปุ่มค้นหาที่อยู่แถวเดียวกัน | ถือว่าผลมาแล้วเมื่อลายเซ็นรายการ (id 5 ตัวแรก) เปลี่ยนจาก baseline หรือมีการ์ดและผ่านไป 5 วิ ถ้ายังไม่มาให้กดค้นซ้ำได้สูงสุด 5 ครั้ง | pick:158-209, 549-595 |
| 6d | SORT | คลิก chip ที่ข้อความ**ตรงเป๊ะ**กับ `sort` เช่น "ขายดี" ถ้าเป็น "ความเกี่ยวข้อง" หรือค่าว่างให้ข้ามขั้นนี้ | หา chip ≤9 วิ หลังคลิกรอ 1.5 วิ | pick:220-230, 527-547 |
| 6e | SEEK | ถ้า `startPage>1` ให้กดเลขหน้าที่สูงสุดซึ่งยังไม่เกิน startPage (กระโดดทีละหลายหน้า) | รอให้ลายเซ็นรายการเปลี่ยน ≤7 วิต่อหน้า | pick:416-452 |
| 6f | PICK | อ่านการ์ดจาก `a[href*="/offer/product_offer/"]` แล้วกรองราคา จากนั้นส่ง `pickList` (id ทั้งหน้า) และ `picked {id,text,page}` เป็นการ์ดใบแรกที่ไม่อยู่ใน excludeIds **ขั้นนี้ไม่คลิกการ์ด** | ถ้าทั้งหน้าใช้หมดแล้วให้ไปหน้าถัดไป (ข้อ 3) | pick:454-486, 103-125 |
| 7 | บันทึกการเลือก | เก็บ `lastPickedProductId`, `lastPickedPage` แล้วเก็บ id ที่เหลือของหน้านั้นลง `candidatePage` และ bookmark หน้าไว้ต่อคีย์เวิร์ด | ระหว่างรอ `productMeta` ครบได้ถึง 1.5 วิ | D:1002-1071, D:724 |
| 8 | stage แบบตรง | อ่าน `productMeta[id]` ได้ {shopId, image(hash), name} แล้วสร้างลิงก์เป็น universal link รูปมาจาก `https://down-zl-th.img.susercontent.com/{hash}` จากนั้นเรียก bridge `saveProductName` และ `saveProductImageFromUrl` | รอ `ProductStaged` ที่ productId ตรงกันภายใน 35 วิ | D:1158-1187 |
| 9 | (สำรอง) หน้ารายละเอียด | ใช้เมื่อ stage ตรงไม่สำเร็จ เปิด `https://affiliate.shopee.co.th/offer/product_offer/{id}` ใน overlay | รอ `PageLoaded` ที่ path ตรง regex ภายใน 15 วิ หลังโหลดรอ 1.2 วิแล้วฉีด `shopee_first.js` ซ้ำทุก 2.5 วิจนได้ `ProductStaged` ภายใน 35 วิ | D:437-493, D:1080-1106 |
| 10 | ลิงก์ (สำรอง) | ใช้ universal link ถ้ารู้ shopId ถ้าไม่รู้ให้ใช้ `captureAffiliateLink()` (ข้อ 2) แล้วตรวจว่ามี `s.shopee` หรือ `shopee.co.th` | — | D:503-519 |
| 11 | ปิด overlay | `closeDetailWebView()` ทำทุกครั้งใน `finally` ด้วยการโหลดหน้าแรกทับเพื่อล้าง captcha แล้วซ่อน overlay | — | D:525-527, A:486-499 |

### ดักคำตอบ API (หัวใจของ fast path)
- `NET_HOOK_JS` ครอบ `window.fetch` และ `XMLHttpRequest` ถ้า URL ตรง `/offer\/product\/list/` จะส่ง body ทั้งก้อนไปที่ `Android.productListMeta(text)` (A:981-1016) และฉีดซ้ำทุก `onPageFinished` (A:361-368)
- ฝั่ง Kotlin อ่าน `data.list[i].item_id` และ `data.list[i].batch_item_for_item_card_full.{shopid,image,name}` (D:249-277) ถ้าเก็บได้ไม่ครบให้ log ว่าขาดเพราะอะไร ไม่ปล่อยเงียบ
- คอมเมนต์ระบุว่าคำตอบนี้ "carries every card's affiliate **long_link** + image hash + name" (A:986-988) แต่ Pondy **ไม่ได้ใช้ long_link** โดยให้เหตุผลว่ามัน "isn't the same s.shopee.co.th short link" (D:147-148)

### รูปสินค้า: โหลดอย่างไร เก็บที่ไหน
- **ทาง fast path:** ใช้ URL `https://down-zl-th.img.susercontent.com/{image hash}` (D:1173)
- **ทางสำรอง:** `shopee_first.js` ใช้ `<img>` ตัวแรกที่ขนาดอย่างน้อย 80×80 และ src เป็น `susercontent.com|shopee` ถ้าไม่เจอก็ใช้รูปที่ใหญ่สุดในหน้า แล้วตัด `_tn` ออกเพื่อได้ภาพเต็ม (first:39-51, 81-85)
- **การดาวน์โหลด:** ทำแบบ native ผ่าน `HttpURLConnection` โดยตั้ง header UA มือถือและ `Referer: https://affiliate.shopee.co.th/` เพราะถ้าใช้ fetch ในหน้า **CDN จะบล็อกด้วย CORS** (`TypeError: Failed to fetch`) (A:787-825, first:73-76) จากนั้น decode เป็น Bitmap แล้ว re-encode เป็น **JPEG คุณภาพ 92** เพื่อแปลง webp เป็น jpg
- **ไฟล์ปลายทาง:** `getExternalFilesDir(null)/product_<epochms>.jpg` (A:696-704) โดยห้ามลบไฟล์ตามเวลา จะลบได้ก็ต่อเมื่อ job เป็น DONE แล้วเท่านั้น (O `finish()` เรียก `deleteProductImage`)
- **การจับคู่ชื่อกับรูป:** ชื่อและรูปมาถึงแยกกัน `stagePiece()` จะรอจนครบทั้งคู่แล้วจึง emit `ProductStaged(name, imagePath, category, productId)` และ `expectStage(id)` จะล้างครึ่งที่ค้างจากสินค้าก่อนหน้า (A:668-694)

### ชื่อ ราคา ค่าคอม ยอดขาย
- **ชื่อ:** ใช้ `productMeta.name` ก่อน ถ้าไม่มีให้ใช้ `cleanPickedName(text ของการ์ด)` ซึ่งตัดป้าย "xx% ลด" และทุกอย่างตั้งแต่ "฿" ออก (D:1462-1471) ส่วนทางสำรองใช้ข้อความ parent ของรูปแล้วตัดตั้งแต่ "ดูสินค้า" ออก (first:58-69)
- **ราคา ค่าคอม ยอดขาย:** ไม่ได้เก็บ ข้อความการ์ดมีหน้าตาประมาณ `"15% ลด <ชื่อ> ฿169.00 ขายได้ 10พัน+ ชิ้น อัตราค่าคอมมิชชัน 13% เอา ลิงก์"` (D:1463) ราคาอ่านด้วย regex `/฿\s?([\d,]+(?:\.\d+)?)/` เฉพาะ ฿ ตัวแรก และใช้แค่กรองขั้นต่ำ (pick:37-39)
- **โมดูลเก่า:** `ShopeeWebExtractor.kt` และ `shopee_extract.js` / `ShopeeExtractScript.kt` เป็นโค้ด spike ที่มีฟิลด์ `sold` และ `commission` แต่ selector ทั้งหมดยังเป็น "TODO VERIFY" และ URL ชี้ไป `shopee.co.th/search` จึง**ไม่ได้ใช้ใน pipeline จริง** (Extractor:113-121, docs/SHOPEE_INTEGRATION.md §5)

---

## 2. การขอลิงก์แอฟฟิลิเอต: 3 ทาง (เรียงตามที่ใช้ในฉบับนี้)

| ทาง | วิธี | สถานะในฉบับ 5 ต.ค. |
|---|---|---|
| **A. Universal link** | `https://shopee.co.th/universal-link/product/{shopId}/{itemId}` สร้างเองจาก id โดยไม่ยิง API (D:185-189) | **ใช้อยู่** (`USE_UNIVERSAL_LINK = true`, D:203) |
| B. GQL `batchGetProductOfferLink` | `POST /api/v3/gql?q=productOfferLinks`, `credentials:'include'` โดย body ประกอบด้วย `operationName:'batchGetProductOfferLink'` และ variables `productOfferLinkParams:[{itemId:"<str>", shopId:<num>, trace:''}]`, `sourceCaller:'WEB_SITE_CALLER'`, `advancedLinkParams:{subId1..5:''}` คำตอบอยู่ที่ `data.productOfferLinks[{itemId,shopId,productOfferLink}]` เดิมยิงครั้งเดียวต่อทั้งหน้า (~20 ชิ้น) | ปิดเมื่อเปิดทาง A อยู่ (D:1040-1048) และมีระบบ mute |
| C. ปุ่มบนหน้ารายละเอียด | `shopee_copy_link.js` คลิก **"เอา ลิงก์"** แล้วรอ dialog ≤5 วิ จากนั้นคลิก **"คัดลอกลิงก์"** ลิงก์จะถูกจับจาก clipboard listener หรือจาก `window.prompt("Copy to clipboard…", link)` ซึ่ง WebView ดักไว้ (A:146-156, A:209-220) | ใช้เป็นทางสำรองเมื่อไม่รู้ shopId |

**รายละเอียดทาง C (D:1416-1460):**
- ลอง JS click ก่อนและรอ 2.5 วิ ถ้าไม่ได้ให้ใช้ rect ที่สคริปต์รายงานกลับมา (`linkRect`) เพื่อ **real-tap** ปุ่ม แล้วฉีดสคริปต์ซ้ำและรออีก 15 วิ
- การหาปุ่มให้จัดอันดับ `BUTTON/A/role=button` ก่อน `div` ที่ครอบอยู่ เพราะ div ครอบมี textContent เหมือนปุ่มแต่คลิกไม่ทำงาน (copy:231-252)
- ลิงก์ที่ยอมรับต้องเป็น http(s) มี `s.shopee` หรือ `shopee.co.th` และไม่มีช่องว่าง เพราะเคยจับ prompt ของ Flow มาเป็นลิงก์ผิด (A:519-540)

**เมื่อไม่ได้ลิงก์:**
- **GQL ปฏิเสธ (วัดเมื่อ 2026-08-25):**
  - ยิงทีละ 20 ได้ `{"error":90309999,"6":{"1":"<base64>"}}` ซึ่ง decode แล้วเป็น `{"business":"OPAAFFI","mfr":"0",...}` คือ **anti-bot / captcha** ไม่ใช่ GraphQL error
  - ยิงทีละชิ้นได้ `{"error":"error_not_found"}`
  - (D:153-165)
- **ระบบ mute:**
  - ปฏิเสธ 3 ครั้งติด (timeout, transport, ไม่มี `data.productOfferLinks` หรือได้ list ว่าง) จะหยุดเรียก **30 นาที** แล้วปล่อย probe 1 ครั้ง
  - ถ้าสำเร็จครั้งเดียวจะรีเซ็ตทั้งหมด
  - (D:216-234, D:1195-1242)
- **เหตุผลที่เลิกขอลิงก์จาก Shopee:**
  - ปุ่ม "คัดลอกลิงก์" กับ GQL **เป็น endpoint เดียวกัน**
  - 50% ของ captcha ทั้งวันเกิดภายใน 60 วิหลังกดปุ่ม เทียบกับ baseline 16%
  - (D:170-180)
- **ทำไม universal link ใช้ได้กับ Pondy:** Pondy โพสต์คลิป**ในแอป Shopee จากบัญชีแอฟฟิลิเอตเอง** ค่าคอมจึงผูกกับบัญชีที่โพสต์ ไม่ได้ผูกกับ URL (เจ้าของยืนยัน 2026-08-25, D:176-179) ฝั่งโพสต์จะวางลิงก์ในช่อง "วางลิงก์" แล้วกด "นำเข้า" เพื่อแท็กสินค้า (ShopeePostDriver.kt:314-336)
  - ⚠️ **เงื่อนไขนี้ใช้ไม่ได้กับ Facebook Reels** ดูข้อแนะนำท้ายเอกสาร
- **ถ้าทุกทางล้ม:** โยน `StepFailedException("timeout waiting for affiliate link")` แล้ว orchestrator จะ exclude id นั้นแล้วไปตัวถัดไป (O:1330-1343)

---

## 3. โหมดคีย์เวิร์ด vs ร้านค้า, การเรียง, เปลี่ยนหน้า, resume, exclude, ราคา

### 3.1 โหมด PRODUCT (คีย์เวิร์ด)
- ใช้ flow `product_offer` ตามข้อ 1
- ถ้าคีย์เวิร์ดว่าง จะข้าม SEARCH แล้วหยิบจาก feed ของแท็บค่าคอมพิเศษเลย (pick:517) ใช้ตอนคีย์หมด (ข้อ 3.6)

### 3.2 โหมด SHOP (`searchMode="SHOP"`)
1. **flow `shop`:** อยู่บน `https://affiliate.shopee.co.th/offer/brand_offer` ค้นชื่อร้านด้วยคีย์เวิร์ด แล้วหยิบร้านแรก โดย `excludeIds` ส่งเป็นว่างเพราะไม่ได้ติดตามว่าร้านไหนใช้แล้ว (D:600-612, pick:617-659)
   - การ์ดร้านอ่านจาก `a[href*="/offer/brand_offer/"]` ถ้า layout แบบตารางใหม่ไม่มี `<a>` ให้สแกนทุก attribute (`href`, `data-href`, `data-url`, `data-link`, `onclick`) หา id แทน (pick:91-125)
2. เปิด `.../offer/brand_offer/{shopId}` ใน overlay (D:1071, D:1080-1106)
3. **flow `shop_product`:** ไม่มี TAB/SEARCH เลื่อนจอทีละ 0.6 viewport เพื่อให้ lazy-load จนเจอการ์ด `/offer/product_offer/` (รอได้ ≤35 วิ) แล้วกรองราคาและ excludeIds ถ้าหมดหน้าให้เปลี่ยนหน้า (pick:664-695)
- **sticky:** สินค้าตัวต่อไปของคีย์เดิมจะหยิบจากแคช `shop:<shopId>` ก่อน ถ้าแคชหมดให้เปิดร้านเดิมตรง ๆ โดยข้ามการค้นหาร้าน ถ้าร้านใช้ต่อไม่ได้จึงกลับไปเดินเส้นทางเต็ม (D:554-594)
- ร้านที่รายการว่างจะ retry 1 ครั้งจาก brand_offer (D:622-635, `SHOP_PRODUCT_RETRIES=1`)
- SHOP ไม่มีเลขหน้า `lastPickedPage` จึงเป็น 1 ตลอด และไม่ได้ bookmark หน้า (D:1011-1016) ฝั่ง orchestrator ใช้เพดาน `maxPages×25` ชิ้นแทน (O:1038-1041, 1818)

### 3.3 การเรียง (`S.collectSort`, S:423-430, 1348-1359)

| ค่า | ความหมาย |
|---|---|
| `"ความเกี่ยวข้อง"` (ค่าเริ่ม) | ค่าเริ่มของหน้า จึงไม่คลิก chip |
| `"ขายดี"` | คลิก chip "ขายดี" |
| `"สลับ"` | โหมดของ driver เอง ไม่ใช่ chip (ดูด้านล่าง) |

- ค่าที่ตั้งคือ**ข้อความ chip ตรงตัว** คอมเมนต์บอกว่า chip ที่มีคือ `ความเกี่ยวข้อง | คอมมิชชัน% | ขายดี | ราคา` (pick:220) จึงตั้งเป็น "คอมมิชชัน%" ได้โดยไม่ต้องแก้ JS (S:426-427) แต่ในโค้ดไม่มีค่าคงที่สำหรับคอมมิชชัน
- **โหมด "สลับ"** (D:836-902):
  - เก็บ state `(page, sortIdx)` แยกต่อคีย์เวิร์ด ลำดับคือ ขายดี p1 → ความเกี่ยวข้อง p1 → ขายดี p2 → …
  - ส่ง `pinPage:true` ให้สคริปต์ตอบ `pickNone 'page exhausted'` แทนการเปลี่ยนหน้าเอง
  - ทุกครั้งที่สลับต้อง**เปิดหน้า offer ใหม่** ให้ chip รีเซ็ต ไม่อย่างนั้นรอบ "ความเกี่ยวข้อง" จะยังติด "ขายดี" อยู่ (D:849-856)
  - เลิกเมื่อหน้าว่างติดกัน 24 ครั้ง (`ALT_MAX_EMPTY_STEPS`)
  - ไม่ใช้แคชหน้า

### 3.4 การเปลี่ยนหน้า (pager) (pick:301-414)
- pager ไม่มี class ที่คงที่ จึง**หาจากรูปทรง**: element ใบ (leaf) ที่ข้อความเป็นเลข 1–199 อยู่แถวแนวนอนเดียวกัน (ต่างกันไม่เกิน 24px) มีเลขเรียงต่อกันอย่างน้อย 3 ตัว และเลือกแถวที่ต่ำที่สุด
- ถ้าเลขที่ต้องการยังไม่แสดง (pager แบบ window) ให้คลิกเลขที่มากที่สุดที่เห็น
- หลังคลิกต้อง latch ลายเซ็นรายการไว้ และ**ห้ามคลิกซ้ำจนกว่าลายเซ็นจะเปลี่ยน** ไม่อย่างนั้นจะข้ามหน้า ถ้าไม่เปลี่ยนภายใน 7 วิถือว่าหมด
- ถ้าไม่พบ pager ให้ fallback เป็นเลื่อนจอ (infinite scroll) ทั้ง window และ container ที่สูงที่สุด
- เปลี่ยนหน้าได้สูงสุด 10 ครั้งต่อการฉีดหนึ่งครั้ง (`MAX_SCROLL`) และต้องเหลืองบเวลาอย่างน้อย 6 วิ

### 3.5 Resume หน้า (ต่อคีย์เวิร์ด)
- ทุกครั้งที่ pick สำเร็จจะเรียก `settings.setLastCollectPage(keyword, lastPickedPage)` บันทึกตอน pick ไม่ใช่ตอน stage สำเร็จ (D:721-725, 659) ค่า prefs key คือ `collect_page_<norm(keyword)>` (S:912-937)
  - `normalizeKeyword` = trim + lowercase + ตัดสระหรือวรรณยุกต์ไทยที่นำหน้าออก เช่น "ฺbyd" กับ "byd" ต้องเป็น key เดียวกัน (S:966-973)
- การค้นครั้งถัดไปส่ง `startPage` แล้วขั้น SEEK จะกระโดดไปหน้านั้น ล้างได้ด้วย `resetCollectPage` ซึ่งล้าง state ของโหมดสลับด้วย
- **แคชหน้า (`candidatePage`):** id ที่เหลือของหน้าที่ค้นแล้ว (~19 ตัว) ถูกเก็บใน driver ซึ่งเป็น @Singleton จึงอยู่รอดแม้ Activity ถูก OS ฆ่า ตัวที่ 2–20 ของหน้าจึง**ไม่ต้องยิง Shopee เลย** (D:111-135)
- **resume ด้วย `history.back()` ถูกปิด** (`RESUME_FAST_PATH_ENABLED=false`) เพราะกลับไปแล้วได้ feed ปกติแทนผลค้นหา (0/20 id ตรง ช่องค้นหาว่าง) และในคีย์ว่างเคยเด้งไปหน้า captcha (D:312-321, 665-683)
- **เติมคลัง (warehouse):** `O.fillWarehouse()` วน stage จนครอบคลุม `collectMaxPages` หน้า (1–10, S:440-454) หรือจนคีย์หมด ทั้งหมดนี้ถือเป็นการเข้า Shopee รอบเดียวสำหรับหลายสิบชิ้น (O:1018-1105)

### 3.6 excludeIds / สินค้าที่ใช้แล้ว
- **ชุด exclude** = `used_products` (ทุก id ที่ทำคลิปถึง DONE แล้ว) ∪ `pendingProductIds` (job STAGED/QUEUED ที่ยังรอเจน) ∪ `failedProductIdsThisRun` (O:280-283, O:1042-1045, O:108-114)
- `used_products` เขียนตอน **DONE เท่านั้น** (`finish()` → `markUsed`, O:1645-1650) job ที่ล้มก่อนหน้านั้นจึงเอาสินค้ากลับมาใช้ได้ ตารางนี้มีแต่เพิ่ม ไม่มีลบ และอ่านแบบ keyset paging เพื่อกัน CursorWindow 2MB ล้น (UsedProductDao.kt:42-58)
- **ใช้ exclude ที่ 3 จุด:**
  1. ส่งเป็น `excludeIds` เข้า JS
  2. ข้ามตอน pop แคช
  3. หลัง stage สำเร็จเพิ่ม id เข้าชุดทันที (O:1307)
- **คีย์หมด:**
  - ข้อความ `"all cards used after N pages"`, `"all shop products excluded"` หรือ `"all shops excluded"` ถือเป็น stop ไม่ใช่ fail (O:1338-1343)
  - เติมคลังได้ ≤2 ชิ้นแล้วถึงท้ายแคตตาล็อก ถือว่าคีย์หมดเช่นกัน (O:1093)
  - เมื่อคีย์หมดให้ `KeywordExhaustedBus.report()` เพื่อขอคีย์ถัดไปจาก fleet server และระหว่างนั้น browse แบบคีย์ว่าง (O:632-640)

### 3.7 กรองราคาขั้นต่ำ
- ค่า `S.priceMin` เป็นบาท 0 = ไม่กรอง (S:862-866) ส่งเข้า `__pickArgs.priceMin`
- กรองที่ขั้น**สร้างรายการการ์ด ก่อนส่ง `pickList`** แคชหน้าจึงถูกกรองไปด้วย (pick:40-48)
- ถ้าอ่านราคาไม่ได้ให้**ปล่อยผ่าน** เพราะเป็นตัวกรองขั้นต่ำและควรเอียงไปทางรับเข้า (pick:38-39)

---

## 4. มาตรการกันโดนมองว่าเป็นบอต + การรับมือ CAPTCHA / หลุดล็อกอิน

### กันบอต

| มาตรการ | รายละเอียด | อ้างอิง |
|---|---|---|
| สุ่มพักก่อนเก็บทุกชิ้น | 6–18 วิ (ค้นจริง) และ 5–10 วิ (pop แคช) สาเหตุคือ Shopee ติดป้าย session ว่า `crawler_item` ("captcha ไม่หาย") เมื่อจังหวะการเก็บสม่ำเสมอแบบเครื่องจักร **ห้ามใช้ค่าคงที่** | D:344-365 |
| gate + jitter ทุก phase | `gate(ms)` = ms + สุ่ม 0–50% ค่าที่ใช้: เริ่ม 900, หลัง TAB 2200, หลังค้น 1200, หลัง sort 1500, หลัง seek 1200, หลังเปลี่ยนหน้า 1500 ms ("สเตปช้อปปี้ไวเกิ้น นึกว่าบอท") | pick:248-271 |
| ลำดับกดแบบคน | กดแท็บค่าคอมพิเศษ → ค้น → เรียง → (ไปหน้า) → เลือก | pick:251-255 |
| ไม่คลิกการ์ด | การ์ดใช้ React Router pushState การคลิกจะพาหน้าผลค้นหาหลุด จึงเปิดหน้ารายละเอียดด้วย URL ใน overlay แทน | D:904-916, pick:476-485 |
| ไม่ขอลิงก์จาก Shopee | ใช้ universal link และไม่ prefetch GQL ถ้าเรียกแล้วถูกปฏิเสธ 3 ครั้งให้ mute 30 นาที | D:153-234, 1034-1048 |
| ลดจำนวน request | ค้นหนึ่งครั้งต่อหน้า (~20 ชิ้น) แล้วตัวที่ 2–20 ใช้แคชในหน่วยความจำ | D:111-124, 383-389 |
| UA | Chrome มือถือ **ไม่มี token "wv"** `Mozilla/5.0 (Linux; Android 14; 2410FPCC5G) ... Chrome/127.0.0.0 Mobile Safari/537.36` | A:99-102 |
| จังหวะรวมของ loop | ช่วงเจนคลิป ~4 นาทีทำหน้าที่เว้นระยะอยู่แล้ว แต่ถ้าเจนพลาดหรือ retry ช่วงนี้จะหายไป จึงต้องมีการสุ่มพักข้างต้น เมื่อชนลิมิต Flow ให้ back-off เพื่อไม่ให้เก็บถี่ (O:116-118) | D:345-351 |

### CAPTCHA
- **ตรวจจับเฉพาะตอนค้าง:** `logStallDiagnostics()` ฉีด `CAPTCHA_PROBE_JS` เพื่อหา marker ใน URL และข้อความหน้า ได้แก่ `captcha, verify, ยืนยันว่าคุณ, ไม่ใช่โปรแกรม, ไม่ใช่บอท, เลื่อนเพื่อ, unusual traffic, suspicious, ปริศนา, puzzle, slider, are you a robot, risk` และ element `iframe[src*=captcha]`, `[class*=captcha]`, `[id*=captcha]`, `[class*=verify-slider]` แล้ว log `CAPTCHA STALL` หรือ `STALL no-captcha` (D:1545-1585) ทั้งนี้**ไม่ได้แก้ captcha อัตโนมัติ**
- URL หน้า captcha ที่เคยเจอคือ `shopee.co.th/verify/captcha?...anti_bot_tracking_id=...` (D:155-158, 680-681)
- **วิธีที่ได้ผล:** **hard-reload** (`loadUrl` หน้าแรก) ไม่ใช่ `location.assign` เพราะ soft route จะทิ้ง overlay captcha ค้างไว้ใน DOM ("โหลดใหม่แล้วหาย") (D:1321-1354, A:651-661) overlay รายละเอียดก็โหลดหน้าแรกทับทุกครั้งที่ปิดเช่นกัน (A:480-493)
- ถ้าเก็บพลาด 3 ครั้งติดจะหยุดรอบนั้นแล้วแจ้ง `CollectFailBus` ว่า "web อาจหลุด login/โดน captcha" (O:512-517, 654-661, `MAX_CONSECUTIVE_STAGE_FAILURES=3`)

### 403
- ซอร์สนี้**ไม่มีการจัดการ HTTP 403 โดยเฉพาะ** `NET_HOOK_JS` ส่ง status ของทุก request เป็น `WebEvent.NetCall` แต่ `ShopeeWebDriver` ไม่ได้ใช้ค่านี้ตัดสินใจ อาการถูกปฏิเสธที่เจอจริงอยู่ใน body (error 90309999) ไม่ใช่ใน status code

### หลุดล็อกอิน
- `isLoggedOutUrl()` ดู URL ที่มี `/login`, `accounts`, `/buyer/login`, `signin`, `universal-link` หรือ `play.google.com` คนที่ไม่ได้ล็อกอินจะถูก Shopee ส่งเข้า funnel ติดตั้งแอป (D:1389-1409)
- ถ้าเกิด `NavBlocked` (Shopee พยายามเด้งไป `shopeeth://`, Play Store หรือ `app.shopee`) ระหว่างเปิดหน้า offer ก็ถือว่าหลุดล็อกอินเช่นกัน (D:1265-1270, A:310-355)
- จากนั้นโยน `NeedsLoginException(SHOPEE)` job จะเข้าสถานะ `NEEDS_LOGIN` และ**รอคนล็อกอิน 15 นาที** ถ้าไม่มีคนมาจะนับเป็นการล้มธรรมดา (O:1309-1321, 1762)

---

## 5. ข้อมูลที่เก็บต่อสินค้า และสิ่งที่ส่งต่อไปสร้างคลิป

**`StagedProduct`** (core/model/StagedProduct.kt):

| ฟิลด์ | ค่า |
|---|---|
| `productId` | itemId ของ Shopee (จาก URL `/offer/product_offer/<id>`) |
| `name` | ชื่อสินค้า (≤200 ตัวอักษร) |
| `imagePath` | path ไฟล์ JPEG บนเครื่อง `.../product_<ts>.jpg` |
| `affiliateLink` | ปัจจุบันเป็น universal link หรือ `s.shopee.co.th/...` ถ้าได้จากทางสำรอง |
| `category` | best-effort แต่**ในทางปฏิบัติว่างเสมอ** เพราะหน้า affiliate ไม่มี category จริง (first:96-100) |

**ตาราง job (`PipelineJob` / JobEntity)** เพิ่มฟิลด์ `keyword`, `state` (QUEUED/STAGED → … → DONE), `clipPath`, `caption`, `errorStep/Msg`, `createdAt`, `postedAt`, `postedTarget` (O:1523-1531)

**`used_products`**: `productId` (PK), `keyword`, `link`, `usedAt` (UsedProductEntity.kt)

**state ที่ไม่อยู่ใน DB:**
- SharedPreferences: `collect_page_<kw>`, `collect_alt_page_<kw>`, `collect_alt_sortidx_<kw>`, `collect_sort`, `priceMin`, `collectMaxPages`
- แคชในหน่วยความจำ: `productMeta` (itemId → shopId, image, name) และ `candidatePage`

**ส่งต่อไปขั้นสร้างคลิป:**
- `imagePath` ใช้เป็นรูป reference ที่อัปโหลดเข้า Flow ก่อนเจน ถ้าไฟล์หายจะ skip พร้อม error "reference image missing — re-collect" (O:1351-1366)
- `name` ใช้สร้าง prompt รูปและพากย์ไทยด้วย LLM ซึ่งยิงคู่ขนานกับการเรนเดอร์รูป (O:1564-1572)
- caption = `"{{name}}\n✨ ราคาดีย์ คลิกเลย 👉 {{link}}"` (CaptionBuilder.kt:8-15)
- ตอนโพสต์ Shopee Video ใช้ลิงก์วางในช่อง "วางลิงก์" แล้วกด "นำเข้า" เพื่อแท็กสินค้า
- หลัง DONE จะ markUsed และลบไฟล์รูป

---

## 6. กับดักที่เคยเจอ (จากคอมเมนต์โค้ด)

| # | อาการ | สาเหตุ / วิธีแก้ | อ้างอิง |
|---|---|---|---|
| 1 | deep-link ไป `/offer/product_offer` แล้วได้หน้าแรกเปล่า | เปิดหน้าแรกก่อน รอ SPA บูต แล้วค่อย `location.assign` ในหน้า และยิงซ้ำทุก 2.5 วิเพราะบางที Shopee เด้งกลับ `/` | D:1251-1255, 1356-1373 |
| 2 | ค้นจากหน้า landing แล้วไม่มีตัวเรียงและผลไม่ไป | ต้องกด **ค่าคอมพิเศษ ก่อน** จึงจะเข้า listing ที่มีช่องค้นและ chip เรียง | pick:251-255 |
| 3 | ใส่ value อย่างเดียวแล้วช่องค้นยังว่างหรือไม่ยิงค้น | ใช้ native value setter ร่วมกับ InputEvent, change, Enter, requestSubmit และคลิกปุ่มค้น บางครั้งต้องกดซ้ำหลายครั้ง (≤5) | pick:175-192, 578-590 |
| 4 | กรองการ์ดด้วยคีย์เวิร์ดแล้วทิ้งของดี | ชื่อสินค้ามักเป็นแบรนด์หรือภาษาอังกฤษ ให้เชื่อการจัดอันดับของ Shopee และตรวจความสดของผลด้วยการเปลี่ยนของรายการ id | pick:86-90, D:497-500 |
| 5 | chip "ขายดี" ไปจับคำ "ขายดี" ในการ์ด | จับ chip ด้วยข้อความ**ตรงเป๊ะ**และยาวไม่เกิน 24 ตัวอักษร | pick:221-230 |
| 6 | เปลี่ยนหน้าแล้วข้ามหน้า | latch ลายเซ็นรายการไว้และรอจนเปลี่ยนก่อนคลิกครั้งต่อไป ใน seek ให้กระโดดไปเลขสูงสุดที่เห็น | pick:393-452 |
| 7 | คลิกการ์ดแล้วหน้าผลค้นหาหลุด | pushState ไม่ใช่การโหลดหน้าจริง จึงดักไม่ได้ ให้เลิกคลิกแล้วเปิด URL ใน overlay แทน | D:904-916 |
| 8 | overlay ใหม่ทุกครั้งค้างที่ "NO product img" | modal ยินยอมค่าคอมหรือ T&C แสดงครั้งเดียวต่อ WebView ให้ใช้ overlay ตัวเดิมซ้ำ | A:445-452 |
| 9 | overlay ถูกเด้งไป `/` แล้วไม่เจอรูปจน timeout 35 วิ | บล็อกการนำทางของ overlay ที่ไม่ใช่ `/offer/` และกลืน universal-link ที่ redir ไปหน้าแรก | A:296-309, 326-348 |
| 10 | 8 สินค้าติดต่อกันได้รูปเดียวกัน (โหมด SHOP) | ตัวขูดอ่าน DOM ของหน้ารายการร้านแล้วได้รูปการ์ดแรก แก้ด้วย `__expectId` (ไม่ยอม stage ถ้า path ไม่มี id) บังคับเปิดหน้ารายละเอียดเสมอ และ log เตือนเมื่อ URL รูปซ้ำ | first:21-33, D:441-449, A:795-800 |
| 11 | ชื่อของสินค้า A ไปจับคู่กับรูปของสินค้า B | `expectStage(id)` ล้างครึ่งที่ค้าง และ `ProductStaged` ต้องมี productId ตรงกัน | A:682-694 |
| 12 | หน้ารายละเอียดไม่มีชื่อ | ส่งชื่อจากการ์ดเข้า `window.__pickedName` | D:51-57, first:63-69 |
| 13 | fetch รูปในหน้าแล้ว `Failed to fetch` | CDN บล็อก CORS จาก origin affiliate ให้ดาวน์โหลดฝั่ง native พร้อม Referer | A:787-811 |
| 14 | "คัดลอกลิงก์" ค้างจน WebView แข็ง | ใน WebView ไม่มี clipboard Shopee จึง fallback เป็น `window.prompt` ต้องดัก `onJsPrompt` โดยค่า default ของ prompt คือลิงก์ และปิด alert/confirm อัตโนมัติ | A:200-233 |
| 15 | JS click ปุ่มลิงก์ไม่ทำงาน หรือคลิกโดน div ครอบ | จัดอันดับ element ที่เป็นปุ่มจริงก่อน ถ้ายังไม่ได้ให้ real-tap ด้วย rect ส่วน timeout รอบแรกลดเหลือ 2.5 วิ (เดิมเสียเวลาเปล่า ~13 วิ) | copy:234-250, D:333-340 |
| 16 | GQL / copy-link ถูกปฏิเสธ error 90309999 แล้วตามมาด้วย captcha | เลิกขอลิงก์และใช้ universal link มีระบบ mute | D:153-234, 1034-1039 |
| 17 | productMeta พลาด 100% อยู่ 2 วันโดยไม่มีใครรู้ | ให้ log ว่าเก็บได้กี่ชิ้นและเหตุผลที่ขาด (ไม่มี node หรือฟิลด์ว่าง) | D:267-276 |
| 18 | cold open ได้ SPA shell ว่าง | retry การ route 1 ครั้งเมื่อเจอ `no cards at pick` / `search results never refreshed` / `commission tab never loaded` | D:788-834 |
| 19 | resume ด้วย history.back ใช้ไม่ได้ | ได้ feed ปกติและช่องค้นว่าง (uncontrolled input) ส่วน back เป็นการโหลดหน้าจริงที่ล้างสคริปต์ที่ฉีดไว้ จึง**ปิดทางนี้** และใช้แคช id แทน | D:99-109, 312-321, 671-683 |
| 20 | สินค้าที่ล้มถูกหยิบซ้ำวนไม่จบ ("ค้นแล้วค้างวนที่เดิม") | ตั้ง `lastPickedProductId` ทันทีที่ pick แล้ว orchestrator นำไปเข้า exclude ของรอบนี้ | D:59-66, O:108-114, 1330-1337 |
| 21 | แคช SHOP ไม่เคยถูกใช้ (key เป็น "") | ใช้ `cacheKey="shop:<id>"` และ `expectSort=""` | D:1056-1059, 1133-1135 |
| 22 | bookmark แยกเป็นสองชุดเพราะพิมพ์คีย์ผิด | normalize คีย์ด้วยการตัดสระหรือวรรณยุกต์นำหน้า | S:966-973 |
| 23 | แรมไม่พอ ทำให้ renderer ถูกฆ่าหรือ Flow ขาว | renderer ของ Shopee กิน ~400 MB ให้ `onPause` WebView ตอนอยู่เบื้องหลัง ถ้าแรมวิกฤตให้ finish Activity และถ้า renderer ตาย 3 ครั้งติดให้ recreate ที่หน้าแรก | A:542-564, 389-435, 904-975 |
| 24 | ราคาจับเลขขยะ เช่น part-no หรือ "50ชิ้น" | ใช้ ฿ ตัวแรกเป็นจุดยึด | pick:35-37 |
| 25 | category ได้ "หน้าหลัก / ข้อเสนอ / …" | breadcrumb ในหน้าเป็นเมนูของเว็บ affiliate ไม่ใช่หมวดสินค้า ให้ตัดทิ้ง | first:91-100 |

---

## ภาคผนวก: ข้อเสนอสำหรับส่วนเสริม Chrome ของ Arn Reels

ตอนนี้ส่วนเสริมกรอกช่องค้นหา กดเรียง และกดเลขหน้าเอง แล้วอ่านคำตอบ API ที่หน้าโหลดมา โดยใช้ `long_link` ที่มี `utm_source=an_` เป็นลิงก์แอฟฟิลิเอต

1. **ห้ามลอกเรื่อง universal link** ทางนี้ใช้ได้กับ Pondy เพราะโพสต์ในแอป Shopee จากบัญชีแอฟฟิลิเอตเอง สำหรับ FB Reels ลิงก์ต้องมีรหัสแอฟฟิลิเอตอยู่ในตัว จึงควรใช้ `long_link` (`an_<id>`) ต่อไป อย่าพึ่ง GQL หรือปุ่มคัดลอก เพราะเป็น endpoint เดียวกับที่ทำให้เจอ captcha โค้ดนี้ไม่ได้ยืนยันว่า long_link ให้ค่าคอมเท่ากับ s.shopee ควรทดสอบกับรายงานค่าคอมจริง
2. ควรดักคำตอบ `/offer/product/list` (ค่าคอมพิเศษคือ `list_type=7`) แบบ Pondy ครั้งเดียวต่อหน้า แล้วเก็บทั้ง ~20 ชิ้นลงคิวในหน่วยความจำหรือ storage ไม่ต้องค้นซ้ำทุกชิ้น
3. ควรทำตามลำดับ "แท็บค่าคอมพิเศษ → ค้น → เรียง → หน้า" ถ้ายังไม่ได้ทำ ใช้ gate แบบสุ่ม +0–50% ทุกขั้น และสุ่มพักหลายวินาทีระหว่างรอบ **อย่าใช้จังหวะคงที่** (`crawler_item`)
4. pager ให้ latch ลายเซ็นรายการไว้ก่อนกดเลขถัดไป เก็บหน้าล่าสุดแยกต่อคีย์ (normalize คีย์) และใช้ชุด exclude ที่รวมสินค้าที่ใช้แล้ว ที่รอคิว และที่ล้มในรอบนี้ ควร mark ว่าใช้แล้วก็ต่อเมื่อคลิปเสร็จจริง
5. รูปให้โหลดจาก `down-zl-th.img.susercontent.com/{image}` ผ่าน background/service worker (ใช้ host_permissions แทน fetch ในหน้า ซึ่งจะติด CORS) และใส่ Referer affiliate เมื่อมี captcha ให้ hard-reload ไม่ใช่ soft route และตรวจหน้า `/verify/captcha` กับ error `90309999` ใน body แทนการดู status 403
