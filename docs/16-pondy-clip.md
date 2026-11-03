# Pondy (AffiliateMobile): สั่งสร้างคลิป AI แล้วเก็บเข้าคลัง

> อ่านจากซอร์ส `C:\Users\AVESTA4\Desktop\app\app` (สำเนาที่แตกจาก app.rar) ซึ่งแตกจาก app.rar ฉบับ 5 ต.ค. 2026
> **คำเตือน:** ไฟล์ในเครื่องเจ้าของ (`C:\Users\AVESTA4\Desktop\app\app`) บางไฟล์ใหม่กว่าฉบับนี้ โดยเฉพาะ `MetaAiVideoDriver.kt` (ยัง merge/แก้รายวันอยู่) และ `PipelineOrchestrator.kt` ก่อนลงมือทำให้เทียบกับไฟล์จริงในเครื่องอีกรอบ
> เลขบรรทัดในเอกสารนี้อ้างอิงฉบับ 5 ต.ค.
> path ย่อ: `FP` = `feature/pipeline/src/main/kotlin/com/affiliatemobile/feature/pipeline`, `APP` = `app/src/main/kotlin/com/affiliatemobile/spike`

---

## 0. ภาพรวมแบบบรรทัดเดียว

สินค้า Shopee (รูป jpg + ชื่อ + ลิงก์ affiliate) → แถว `jobs` ใน Room DB → เลือกแอปทำวิดีโอ (Flow หรือ Meta AI ล็อกค่าไว้ต่อ 1 ชิ้น) → ประกอบ prompt จาก template + ให้ AI (Gemini/OpenRouter) เขียน**เฉพาะบทพูดไทย** → แอปวิดีโอสร้างคลิป → รอจนมี mp4 ใหม่ลงเครื่อง → ย้ายไฟล์เข้าที่เก็บส่วนตัวของแอป → `finish()` เขียน `clipPath` + `caption` + `state=DONE` + ตีตราสินค้าว่าใช้แล้ว → ลูปโพสต์ดึงคลิปเก่าสุดที่ยังไม่โพสต์ไปลง Shopee Video

ตัวที่เขียนสถานะมีที่เดียวคือ `PipelineOrchestrator` ส่วนตัวขับแอป (driver) ทำงานผ่าน interface `PipelineVideoDriver` (`core/src/main/kotlin/com/affiliatemobile/core/PipelineVideoDriver.kt`)

---

## 1. State machine ต่อสินค้า 1 ชิ้น

### 1.1 สถานะ (`FP/PipelineState.kt`)
`CREATED → EXTRACTING → STAGED|QUEUED → FLOW_UPLOADING → IMAGE_GENERATING → AWAITING_PAID_CONFIRM → VIDEO_GENERATING → DOWNLOADING → DONE`
สถานะข้างทาง: `FAILED`, `NEEDS_LOGIN`
- `isTerminal` = DONE / FAILED / **QUEUED** (QUEUED ถือว่าจบรอบแล้ว คือเก็บสินค้าไว้แล้ว รอเจน) (บรรทัด 22-23)
- ชื่อสถานะไม่ตรงกับงานจริงทุกตัว เช่น `FLOW_UPLOADING` ก็ใช้ตอนเปิด Meta AI, `IMAGE_GENERATING` ก็ใช้ตอนแนบรูป+วาง prompt ใน Meta (ไม่ได้สร้างภาพ)
- **เขียนสถานะลง DB ก่อนเริ่มแต่ละขั้น** (`FP/db/JobEntity.kt` doc) ถ้าแอปตายกลางทาง แถวจะบอกได้ว่าค้างที่ขั้นไหน และตอนเปิดแอปใหม่ `JobRepository.failOrphans()` (บรรทัด 269) จะเปลี่ยนแถวที่ยังไม่จบเป็น `FAILED("interrupted")` (เรียกจาก `APP/service/PipelineForegroundService.kt:168`)

### 1.2 ลำดับฟังก์ชัน (`FP/PipelineOrchestrator.kt`)
| ขั้น | ฟังก์ชัน (บรรทัด) | ทำอะไร |
|---|---|---|
| เก็บสินค้า | `stage()` 1512 | `EXTRACTING` → `stager.stageProduct(keyword, reserved, searchMode)` → `STAGED` (หรือ `QUEUED` ถ้าเก็บอย่างเดียว) พร้อมเติม productId/name/category/imagePath/affiliateLink |
| ห่อ retry ของการเก็บ | `stageStateMachine()` 1297 | login หลุด → `NEEDS_LOGIN` แล้วรอ 15 นาที; error อื่น → `FAILED` + ใส่ productId นั้นในรายการกันซ้ำของรอบนี้; ข้อความ "all cards used / all shops excluded" = คีย์เวิร์ดหมด |
| เริ่มเจน | `generateStateMachine()` 1348 | เช็กก่อนว่ารูปสินค้ายังอยู่บนดิสก์ ถ้าไม่อยู่ → `QUEUED` + errorMsg "reference image missing" แล้วข้าม |
| เปิดแอป | `uploadToFlow()` 1541 | `FLOW_UPLOADING` → `video.ensureReady()`; ถ้า `skipsImagePhase()` (Meta AI) จะคืน true แล้วไม่อัปโหลดอะไร; ถ้าเป็น Flow จะ `uploadReference()` และ retry 1 ครั้ง |
| หมวดสำหรับ prompt | 1389-1390 | ใช้ `category` ที่ scrape มาได้ ถ้าไม่มีใช้ **keyword ที่ค้นหา** แทน |
| (Meta) แนบรูป+prompt | `prepareVideoFromProductImage()` 1588 | `IMAGE_GENERATING` → `prompts.videoPrompt(name, category, activeVideoAppId())` → `video.prepareVideoFromImage(imagePath, prompt)` |
| (Flow) ภาพนิ่ง+prompt วิดีโอ | `generateImage()` 1564 | สั่ง `videoPrompt` แบบ `async` (LLM ใช้เวลาเขียนบทพูดได้ถึง ~80 วิ) **ทำคู่ขนาน**กับการเจนภาพที่ใช้ ~46 วิ แล้วเรียก `generateStyledImage(imagePrompt)` → `prepareVideo(videoPrompt)` |
| ด่านยืนยัน | `awaitPaidConfirm()` 1596 | ถ้า `autoConfirmVideo` (ค่าเริ่ม true) ข้ามไปเลย ไม่งั้นจะ `AWAITING_PAID_CONFIRM` รอคนกดได้ถึง 30 นาที ถ้าหมดเวลา → `QUEUED` + "confirm timeout" |
| ส่งสร้างวิดีโอ | `generateVideo()` 1610 | `VIDEO_GENERATING` → `armPaid()` → `startVideoGenerationPaid()` → `awaitVideoDone(settings.videoTimeoutMinutes*60000)` (ค่าเริ่ม 10 นาที ตั้งได้ 1-60) |
| รับไฟล์ | `download()` 1626 | `DOWNLOADING` → `downloadVideo()` คืน path (ใน Meta/Flow-app ไฟล์ถูกเซฟไปตั้งแต่ใน `awaitVideoDone` แล้ว) |
| เข้าคลัง | `finish()` 1633 | `caption = CaptionBuilder.build(name, link)` → `DONE` + clipPath + caption + ล้าง error → `repo.markUsed(productId)` → `settings.recordGen()` (นับโควต้าเจนรายวัน) → ลบ `product_*.jpg` |
| แจ้งเตือน | `transition()` 1669 | ทุกครั้งที่เปลี่ยนสถานะ: เขียน DB, `noteProgress()` (ให้ watchdog ใช้), log และส่ง Telegram (ดู §5) |

**แคปชัน/แฮชแท็ก/เสียงพากย์อยู่ตรงไหน**
- เสียงพากย์ไม่ได้สร้างเป็นไฟล์ แต่เป็นข้อความไทยที่ฝังใน prompt (`"{{บทพูด}}"`) แล้วให้ Meta/Veo พากย์ออกมาในคลิปเอง
- แคปชันสร้างตอน `finish()` เท่านั้น
- **ในโค้ดไม่มีการสร้างแฮชแท็ก** มีแค่คอมเมนต์ใน `ClipRow.kt:19` ที่พูดถึง hashtags ซึ่งเป็นของเก่า
- ตอนโพสต์ Shopee ไม่ได้พิมพ์แคปชัน แต่ใช้ลิงก์ affiliate แปะเพื่อผูกสินค้า (`APP/shopee/ShopeePostDriver.postClip` S9) แคปชันใช้แค่ตอนกดแชร์หรือคัดลอกจากคลัง (`ClipLibraryViewModel.shareClip/copyCaption` 392-423 ซึ่งต่อลิงก์ซ้ำอีกรอบ)

### 1.3 การเลือกแอปวิดีโอ (`APP/flow/RoutingPipelineVideoDriver.kt`)
- `settings.videoApp` = `FLOW` (ค่าเริ่ม) หรือ `META_AI`; `settings.flowBackend` = `WEB` (ค่าเริ่ม, Flow ใน WebView) หรือ `APP` (แอป Flow/Whisk ผ่าน a11y)
- **ล็อกค่าตอน `ensureReady()`** (60-75) ถ้ามีคนเปลี่ยนค่าจากแดชบอร์ดกลางคัน ชิ้นปัจจุบันจะไม่สลับ driver ครึ่งทาง ค่าใหม่มีผลกับชิ้นถัดไป
- `activeVideoAppId()` (107) ส่งค่าที่ล็อกไว้ให้ `PromptProvider` เพื่อให้ prompt กับ driver ตรงกันเสมอ
- Meta AI: `skipsImagePhase()=true` (77) ไม่เปิด Flow เลย ใช้**รูปสินค้าจาก Shopee ตรง ๆ** เป็นเฟรมแรก
- ยังมีโค้ด "ข้ามแอป" (Flow ทำภาพ → export ลงแกลเลอรี → Meta ทำคลิป) ใน `prepareVideo()` 99-104 แต่ pipeline ไม่ได้ใช้เส้นนี้แล้ว (ดู `docs/VIDEO_MODEL_AND_CROSS_APP.md` §4b ที่ยังรันไม่ผ่าน) ส่วน doc ของ `SettingsStore.videoApp` (394-397) ที่บอกว่า "รูปยังทำใน Flow" **ล้าสมัยแล้ว**

---

## 2. ขั้นสร้างวิดีโอบน Meta AI (`APP/meta/MetaAiVideoDriver.kt`)

> Driver ตัวนี้ขับ**แอป Android** Meta AI (`com.facebook.stella`) ผ่าน accessibility ไม่ได้ขับเว็บ meta.ai ถ้าจะทำส่วนเสริม Chrome ให้ใช้ "เจตนา" ของแต่ละขั้นจากที่นี่ แล้วเขียน DOM selector ของเว็บเอง (ดูคอลัมน์ขวา)

| ขั้น | ฝั่ง Android (บรรทัด) | ถ้าทำบนเว็บ meta.ai ด้วยส่วนเสริม |
|---|---|---|
| **เตรียม** `ensureReady` 132-154 | เปิดแอป รอให้อยู่หน้าบนสุด 20 วิ → ปิด viewer ที่ค้างอยู่ → กด "แชทใหม่" (`index=1` = ปุ่มบน header เพราะ drawer มีปุ่มชื่อซ้ำอยู่ก่อนใน tree) → รอปุ่ม `เพิ่มไฟล์แนบ` 15 วิ (ใช้เป็นตัวเช็ก login ด้วย) → `clearDraftPhotos()` → ตรวจว่าแชท**ว่างจริง** (มีแถวคำแนะนำเริ่มต้น หรือ header เขียน "Meta AI" เปล่า ๆ และไม่มีไทล์สื่อ) ลองได้ 3 รอบ | เปิดแชทใหม่ทุกชิ้นเสมอ และตรวจว่าในแชทไม่มีสื่อเก่า ไม่งั้นอาจหยิบคลิปของสินค้าก่อนหน้า |
| **แนบรูป** `attachPhoto` 216-232 | ลบไฟล์ cache `meta_ref*` เก่า → copy รูปเป็นชื่อใหม่ `meta_ref_<ms>.jpg` (กัน Meta หยิบรูปที่ cache ไว้ของสินค้าก่อน) → ส่ง `Intent.ACTION_SEND image/jpeg` เข้า `SilverstoneShareIntentHandlerActivity` โดยตรง → รอเห็น desc ที่มีคำว่า `"รูปภาพ, รายการที่"` 15 วิ | สร้าง `File`/`DataTransfer` แล้วยิงเข้า `<input type=file>` หรือ drop event ตั้งชื่อไฟล์ไม่ซ้ำทุกครั้ง แล้วรอให้ thumbnail ขึ้น |
| **วาง prompt** `enterPrompt` 240-252 | รอ 3 วิ → `ACTION_SEND text/plain` **แยกเป็นอีกครั้ง** (ถ้าส่งรูปกับข้อความพร้อมกันใน SEND เดียว ข้อความจะหาย และการ paste ผ่าน a11y จะไปลง EditText ที่ซ่อนอยู่) → ตรวจว่ามี EditText ที่มี **30 ตัวอักษรแรกของ prompt** (ยาวพอจะกินถึงชื่อสินค้า) → ไม่ขึ้นลองอีก 1 รอบ (ส่งซ้ำจะ*แทนที่*ข้อความเดิม ไม่ต่อท้าย) → ตรวจซ้ำว่ารูปยังติดอยู่ | ใส่ข้อความด้วย `execCommand('insertText')` หรือ paste event แล้ว**อ่านกลับ**ว่าในช่องมีหัว prompt จริง และรูปยังอยู่ |
| **กดสร้าง** `startVideoGenerationPaid` 267-279 | ต้อง `armPaid()` ก่อน (ด่านเดียวกับ Flow แม้ Meta ยังไม่คิดเงิน) → ตรวจอีกรอบว่าไม่มีไทล์สื่อเก่าในแชท → `sendPrompt()` 282-293: กดปุ่ม desc `"ส่ง"` ถ้าไม่มีป้าย ใช้พิกัด (ขอบขวาช่องพิมพ์−36, ขอบล่าง+44) **ไม่มีโหมด "สร้างวิดีโอ" ให้เลือก** แค่แนบรูปแล้วเขียนใน prompt ว่าขอวิดีโอก็พอ | Arn Reels ตอนนี้ให้ผู้ใช้กดเอง ซึ่งเทียบได้กับ `autoConfirmVideo=false` ถ้าจะกดอัตโนมัติ ให้ตรวจ "ไม่มีสื่อเก่า" ก่อนกด |
| **รอ** `awaitVideoDone` 300-370 | snapshot id วิดีโอใน MediaStore ไว้เป็น baseline → poll ทุก **10 วิ** จนหมด timeout: ถ้าแอปหลุดจากหน้าจอให้เปิดกลับ (REORDER_TO_FRONT) → ปิดคีย์บอร์ด (ไม่งั้นการ swipe จะกลายเป็นการพิมพ์) → `locateVideoTile()` | poll ทุก ~10 วิ คลิปปกติใช้ ~2 นาที |
| **รู้ว่าเสร็จ** `findVideoTile` 446-458 | ไทล์ที่ id ขึ้นต้นด้วย `conversation_media_item_` และ (ก) มีป้ายความยาว `0:04`..`0:30` อยู่ข้างใน **หรือ** (ข) เป็นแนวตั้ง (สูง ≥ 1.4×กว้าง) เพราะรูปที่เราส่งเป็นสี่เหลี่ยมจัตุรัสเล็ก หาไม่เจอให้เลื่อนลงทีละจอได้ 6 ครั้ง แล้วเลื่อนขึ้น 4 ครั้ง (คลิปอาจอยู่บนหรือใต้ข้อความตอบ) | บนเว็บน่าจะเจอ `<video>` ในข้อความตอบ ให้ตรวจ `duration`/`readyState` และ**ห้ามถือว่าไทล์ที่เพิ่งโผล่คือคลิปเสร็จ** (doc §4: ไทล์ขึ้นก่อนเรนเดอร์เสร็จ) |
| **ยืนยันว่าเป็นวิดีโอ** 349-357 | เปิด viewer (คลิกที่ป้ายความยาวก่อน ถ้าไม่ได้ค่อยแตะพิกัดในโซนที่ไม่ทับ header/ปุ่ม STOP/ช่องพิมพ์ ดู `openTile` 415-432) → ต้องมี `fwa_scrubber_elapsed_time` ถ้าไม่มีแปลว่า Meta ตอบเป็นรูป → fail | ตรวจว่าเป็น `video` จริง ไม่ใช่ `img` |
| **ดึงไฟล์** 359-366 | กด `"บันทึก"` → Meta โหลด mp4 ~4 MB ลง `/sdcard/Download` ใช้เวลาราว 43 วิ → `awaitNewClipExcluding(baseline, 150s, minDateAdded = เวลาที่กด−5 วิ)` → ปิด viewer → `relocateToPrivateStorage()` ย้ายไป `filesDir/clips/clip_<id>.mp4` | ใช้ `fetch(video.src)` → blob → ส่งไป Node (หรือดักลิงก์ดาวน์โหลด) จับคู่ด้วย jobId ที่ส่งไปพร้อมกัน **ไม่ใช่**เอา "ไฟล์ใหม่ล่าสุด" |
| `downloadVideo` 434-436 | แค่คืน `clipPath` ที่ได้จากขั้นก่อน | |

**การรับมือ error, timeout และโควต้า (Meta)**
- Meta ตอบเป็นข้อความแทนคลิป: ถ้าเจอคำว่า `"ขออภัย"`/`"ขัดข้อง"` ใน text หรือ desc → fail ด้วยข้อความ `"Meta AI replied with text, no video — retry"` (324-328) แต่ตัวข้อความตอบของ Meta มักไม่อยู่ใน a11y tree จึงมีตัวเช็กสำรอง: ถ้าคำตอบจบแล้ว (`Show thinking` หรือปุ่ม `คัดลอก` ขึ้น) และไม่มีบรรทัด `กำลัง…` และหาไทล์ไม่เจอ ติดกัน 3 รอบ poll → `"Meta AI finished its reply with no video — retry"` (343-345)
- รูปอัปโหลดค้าง (spinner อยู่บนรูปที่ส่งเกิน 60 วิ, `photoStillUploading` 467-487) → fail ให้ retry จากแชทใหม่
- ป้องกันปัญหาเหล่านี้ไว้แล้ว: รูปค้างในช่องแนบจากรอบก่อน (Meta เก็บ draft ไว้แม้ force-stop และ retry เคยทำให้รูปซ้อน 3 รูป), แชทไม่ว่าง (fail ใน ensureReady), มีสื่อเก่าตอนส่ง (fail)
- ฝั่ง orchestrator (1476-1484): ถ้าข้อความ error มีคำว่า `"with no video"` หรือ `"replied with text"` จะถือว่า**โควต้าวิดีโอของ Meta เต็มชั่วคราว** แล้วรอ **10 นาที** (`META_QUOTA_RETRY_BACKOFF_MS`) ก่อน retry; error อื่นรอ 3 วิ; retry ทั้งชิ้นได้สูงสุด 3 ครั้ง (`GENERATE_RETRIES`) ถ้ายังไม่ได้ → `QUEUED` + errorMsg แล้วข้ามไปชิ้นถัดไป
- timeout: เกินกำหนด → `"Meta AI ไม่ส่งคลิปคืนภายใน Ns"`; กดบันทึกแล้วไม่มีไฟล์ใน 150 วิ → fail
- เงื่อนไขบัญชี: ต้องเป็นบัญชี Meta ที่**ผูก Facebook** ถ้าเป็นบัญชีอีเมลเปล่าจะขึ้น "video generation isn't available for your account" (doc §4)
- selector ทุกตัวอ่านผ่าน `selOv("meta.xxx", default)` จึงแก้จากแดชบอร์ดฟลีตได้โดยไม่ต้องออกแอปใหม่

**Flow (เทียบสั้น ๆ)**: `FlowAppPipelineDriver` ตั้งค่าโหมดภาพ, 9:16, x1, โมเดล → แนบรูปอ้างอิงเป็น "องค์ประกอบ" ผ่าน + → คลัง (ถ้าแค่อัปโหลดเฉย ๆ Flow จะไม่ใช้รูปสินค้า) → setText → กด "สร้าง" (รอให้ปุ่มกดได้ไม่เกิน 60 วิ) → โหมดวิดีโอ → ดึงภาพที่เพิ่งเจนจากคลัง (tile index 2) → setText → สร้าง → `failIfGenerationRejected` → การรอเสร็จทำโดยกดดาวน์โหลดทีละไทล์ แล้วถือว่าเสร็จ**ก็ต่อเมื่อมี mp4 ใหม่ลง MediaStore จริง** (636-826) ส่วน `FlowWebDriver` ใช้ hook ฝั่ง network (`batchGenerateImages` 200, `/v1/credits`) และ blob download

---

## 3. Prompt template และแคปชัน

### 3.1 template ไหนใช้เมื่อไร (`FP/PipelinePromptTemplates.kt`, `FP/settings/SettingsStore.kt:149-170`)
| ใช้กับ | key ใน settings | ค่าเริ่มต้นในโค้ด |
|---|---|---|
| ภาพนิ่งบน Flow | `imageTemplate` | `STYLE_IMAGE` (บรรทัด 5) เป็นภาษาไทย: ใช้ภาพที่แนบเป็นหลัก เพิ่มแค่ "มือข้างเดียวชูสินค้า + ฉาก + แสง" แนวตั้ง 9:16 เลนส์ 85mm ฉากตาม `{{หมวดหมู่}}` ห้ามมีตัวอักษร ห้ามเห็นหน้าคน |
| วิดีโอบน Flow | `videoTemplate` | `ANIMATE` (80) ภาษาอังกฤษ: "Animate the attached start-frame…" ล็อกเฟรมแรก ห้ามเปลี่ยนสินค้า ให้กล้องเคลื่อนช้า ๆ เสียงหญิงไทยพูด `"{{บทพูด}}"` ห้ามมีข้อความบนจอ |
| **วิดีโอบน Meta AI** | `videoTemplateMetaAi` | **`ANIMATE_META` (62-78)** ดูด้านล่าง |
| preset Meta สำรอง | `video_meta_prompt_presets_v1` | `ANIMATE_META_GRANDPA` (27) "คุณตาช่าง" ให้สินค้า**วางนิ่งบนโต๊ะ** แล้วคนแค่ชี้ (ทดสอบแล้วว่าถ้าให้คนถือ Meta จะวาดสินค้าใหม่ เช่น ขวดกลมกลายเป็นเหลี่ยม โลโก้ซ้ำ) |

ข้อความหลักของ `ANIMATE_META` (ย่อ):
```
สร้างวิดีโอสินค้าแนวตั้ง 9:16 ความยาว 8 วินาทีจากภาพนี้ โดยใช้ภาพนี้เป็นเฟรมแรกและภาพอ้างอิงหลัก
รีวิวสินค้า {{name}}
Mood: …โทนอบอุ่น ดูเป็นคลิปรีวิวจริง…
กติกาที่ห้ามผิด: คงสินค้า 100% / คงฉากเดิม ห้ามเพิ่มคนหรือวัตถุใหม่ / handheld push-in ช้า ๆ ไม่มีตัดฉาก /
  ห้ามมีตัวอักษร โลโก้ หรือซับ / ห้ามเห็นหน้าคน (มือที่มีอยู่แล้วให้คงไว้)
เสียงพากย์: เสียงผู้หญิงไทย โทนอบอุ่น… "{{บทพูด}}"
ทำเลยทันทีโดยไม่ต้องถามกลับ ไม่ต้องอธิบายแผน ไม่ต้องเสนอทางเลือก และไม่ต้องขอคำยืนยัน — ส่งคลิปกลับมาอย่างเดียว
```
**บรรทัดสุดท้ายสำคัญ:** ถ้าไม่มี Meta จะตอบกลับเป็นแผนพร้อมคำถาม แล้วไม่ส่งคลิป ซึ่งระบบอัตโนมัติจะอ่านเป็น "ไม่มีคลิป" (คอมเมนต์ 57-60)

### 3.2 ขั้นประกอบ prompt (`FP/settings/PromptProvider.kt`)
1. `videoPrompt()` (36) เลือก template ตามแอปที่ล็อกไว้
2. `applyPlaceholders()` (185-230):
   - `{{name}}`/`{{ชื่อสินค้า}}` = ชื่อสินค้าที่ตัดรหัสตัวเลขในวงเล็บออกแล้ว (`cleanProductName` 147)
   - `{{category}}`/`{{หมวดหมู่}}` = หมวด (ถ้าไม่มีใช้ keyword ถ้าว่างใช้ "as shown in the uploaded reference image")
   - `{{scene}}`/`{{ฉาก}}` = background override หรือค่าเริ่ม
   - `{{action}}`/`{{การกระทำ}}` = การเคลื่อนกล้องค่าเริ่ม
   - `{{productType}}` ก็มีให้แทนค่า
3. `fillVoiceOver()` (87): ถ้ามี `{{บทพูด}}` จะเรียก `aiVoiceOver()` (108):
   - ล้างชื่อสินค้าด้วย `cleanProductNameForVoice` (156) ตัดคำโลจิสติกส์และโปรโมชันออก (ส่งฟรี, COD, สต็อก, ลด 50%, ของแท้ …)
   - สุ่ม 1 มุมเปิดประโยคจาก `VOICE_OPENING_ANGLES` (6 แบบ)
   - เรียก provider ที่เลือกก่อน (Gemini เป็นค่าเริ่ม) ถ้าไม่ได้ค่อยลองอีกเจ้า ถ้าไม่ได้ทั้งคู่ใช้ `DEFAULT_VOICE_SCRIPT` = `"ใช้ดีจริง ๆ นะคะ ของใช้ได้จริง ใช้ง่ายดีด้วยค่ะ"`
4. `shouldPreserveTemplateWording()` (232): **prompt ที่มีอักษรไทยจะถูกใช้ตามตัวอักษรทุกครั้ง** ไม่ส่งไปให้ AI ปรับ (ไม่งั้น AI จะเขียนใหม่เป็นอังกฤษ) ส่วน prompt อังกฤษที่ไม่มีคำอย่าง thai/do not/exact product และเปิด refine ไว้ จะส่งไป `refinePrompt` ของ Gemini/OpenRouter
5. `normalize()` (170): **ยุบช่องว่างทุกชนิดรวมถึงขึ้นบรรทัดใหม่ให้เหลือช่องว่างเดียว** prompt ที่ส่งเข้า Meta จึงเป็นบรรทัดยาวบรรทัดเดียว

**AI ตัวไหนเขียนอะไร**
- AI เขียน**แค่บทพูด**ส่วน `{{บทพูด}}` เท่านั้น เนื้อ template คนเขียนเองและแก้ได้จากหน้าตั้งค่าหรือฟลีต
- Gemini (`GeminiClient.kt`) เรียก REST `v1beta/models/<m>:generateContent?key=` วนรุ่นตามลำดับ `gemini-3.5-flash → gemini-3.1-flash-lite → gemini-2.5-flash → gemini-2.5-flash-lite` เมื่อเจอ 429/404 และตั้ง `thinkingBudget=0`
- OpenRouter (`OpenRouterClient.kt`) เรียก `/api/v1/chat/completions` ใส่ model ได้หลายตัวคั่นด้วย `,`/`;`/ขึ้นบรรทัด ค่าเริ่ม `google/gemini-2.0-flash-001`
- คำสั่งที่ใช้ให้เขียนบทพูด (`FP/settings/VoiceOver.kt:33-179` `voiceOverInstruction`):
  - เสียงผู้หญิงไทย 1-2 ประโยค ประมาณ 18-24 คำ (พูดจบใน 8 วิ) ลงท้าย "ค่ะ"
  - ใช้ภาษาพูด ห้ามโอ้อวดเกินจริง ห้ามเอ่ยชื่อแบรนด์หรือรุ่น ห้ามใช้ "นี้" ชี้สินค้า
  - ให้เอาประเภทสินค้าจากชื่อ ไม่ใช่จาก keyword
  - มีรายการคำต้องห้ามที่ Veo ปฏิเสธ (ยา, กันยุง, ปลอดภัย, อาหารเสริม, เหล้า, พนัน, ปืน …)
  - ให้เปลี่ยนโครงประโยค ไม่ติดสูตร "…ช่วยให้" / "เหมาะกับคนรักรถ"
- หลังได้ผลลัพธ์ `cleanVoiceOver` (287) จะตัดเครื่องหมายคำพูด แทนคำตามรายการ `คำเดิม=คำใหม่` (ไล่จากบนลงล่าง วลียาวต้องมาก่อน) แล้วลบคำต้องห้ามของผู้ใช้
- ถ้าโควต้าหมดจะแจ้ง Telegram ไม่เกิน 1 ครั้งต่อ 10 นาที

### 3.3 CaptionBuilder (`FP/CaptionBuilder.kt`)
```kotlin
CAPTION_TEMPLATE = "{{name}}\n✨ ราคาดีย์ คลิกเลย 👉 {{link}}"
```
- ใช้ชื่อสินค้าดิบ (ไม่ผ่านการล้าง) + ลิงก์ affiliate ไม่ใช้ AI และไม่มีแฮชแท็ก ("ราคาดีย์" สะกดแบบนี้ในโค้ดจริง)
- สร้างครั้งเดียวใน `finish()` แล้วเก็บไว้ใน `jobs.caption`

---

## 4. โครงข้อมูลคลังคลิป

### 4.1 ตาราง `jobs` (`FP/db/JobEntity.kt`, DB `pipeline.db` v4 ใน `PipelineDatabase.kt`)
| ฟิลด์ | เติมเมื่อ | หมายเหตุ |
|---|---|---|
| `id` (auto) | CREATED | |
| `keyword` | CREATED | คำค้นที่ใช้หาสินค้านี้ |
| `productId`, `productName`, `category`, `imagePath`, `affiliateLink` | STAGED/QUEUED | `imagePath` = `product_<ms>.jpg` (`APP/shopee/ShopeeWebActivity.kt:703`) ลบทิ้งเมื่อ DONE |
| `state` | ทุกขั้น | เก็บเป็นชื่อ enum |
| `errorStep`, `errorMsg` | ตอนพลาด | **`errorMsg != null` คือเครื่องหมายว่า "เคยเจนพลาดแล้ว"** ลูปจะไม่หยิบซ้ำ |
| `clipPath`, `caption` | DONE | `clipPath` = `filesDir/clips/clip_<mediastoreId>.mp4` (`MediaStorePoller.relocate` 284) |
| `createdAt`, `updatedAt` | | |
| `postedAt`, `postedTarget` | หลังโพสต์ | `postedAt IS NULL` = ยังไม่โพสต์ |
| `hidden` | กดซ่อน | ซ่อนจากทุก list แต่เก็บแถวไว้กันซ้ำ |

- migration: 1→2 เพิ่ม `postedAt`/`postedTarget`, 2→3 เพิ่ม `hidden`, 3→4 เพิ่ม `category`
- `ClipRow` (`FP/db/ClipRow.kt`) คือทุกคอลัมน์**ยกเว้น `caption`** เพราะ caption ยาวราว 3KB เคยทำให้ query คลังเกิน CursorWindow 2MB แล้ว crash วน 87 ครั้ง (บันทึกเหตุการณ์ 2026-09-16) **ทุก query ที่คืนได้หลายแถวต้องมี LIMIT** หน้าคลังโชว์ 600 แถว (`CLIP_PAGE`) แต่ตัวนับยอดใช้ `COUNT(*)`

**นิยามในคลัง (`FP/db/JobDao.kt`)**
- คลิปในคลัง = `state='DONE' AND clipPath IS NOT NULL AND hidden=0` เรียงตาม `createdAt ASC`
- พร้อมโพสต์ (`postableClips`) = เงื่อนไขข้างบน + มี `affiliateLink` + `postedAt IS NULL`
- คิวรอเจน (`pendingGeneration`) = `state IN ('STAGED','QUEUED') AND errorMsg IS NULL AND hidden=0` (หน้าจอคิวแสดงรวมตัวที่พลาดด้วยผ่าน `observePendingGeneration`)
- ตัวกรองหน้าคลัง: `ClipFilter { ALL, NOT_POSTED, POSTED }`

**ซ่อมคลังเองตอนเปิดหน้า** (`APP/ui/library/ClipLibraryViewModel.kt` init 77-96) ไล่ทีละหน้าด้วย keyset:
- ถ้าโพสต์แล้วและเปิด `deleteClipAfterPost` ไว้ → ลบไฟล์
- ถ้าไฟล์หายไปแล้ว → `clearClipPath`

### 4.2 การ retry
| ชั้น | ทำอย่างไร |
|---|---|
| อัปโหลด/เปิดแอป | `UPLOAD_RETRIES=1` รอ 2 วิ |
| เจนทั้งชิ้น | `GENERATE_RETRIES=3` เริ่มใหม่ตั้งแต่ `ensureReady` (Meta = แชทใหม่, Flow = โปรเจกต์ใหม่) backoff ตาม error: Meta โควต้า 10 นาที, Flow "did not bill credits" 20 วิ, อื่น ๆ 3 วิ (`generateStateMachine` 1425-1507) |
| ไม่ retry | `"Flow rejected"` (unusual activity, reCAPTCHA, ไม่ได้ใช้รูป) → ข้ามทันที; `"daily limit"` → หยุดทั้งชุดแล้วแจ้ง Telegram (ไม่เกิน 1 ครั้งต่อ 30 นาที) |
| หลัง retry ครบ | `QUEUED` + errorMsg (รูปสินค้ายังเก็บไว้ ให้คนกด "เจนตัวนี้" ได้) แล้วไปชิ้นถัดไป |
| ผู้ใช้กดหยุด | ชิ้นที่มีรูปแล้ว → `QUEUED` และ**ไม่ใส่ errorMsg** (ไม่งั้นจะหายจากคิวอัตโนมัติไปตลอด); ชิ้นที่ยังไม่ได้สินค้า → `FAILED("cancelled")` (`run()` 184-205) |
| login หลุด | `NEEDS_LOGIN` รอ 15 นาที (`LOGIN_TIMEOUT_MS`) ถ้าไม่มีใครมา login จะ `QUEUED`/`FAILED` + "⛔ ต้องล็อกอินใหม่" แล้วไปต่อ |
| ค้างไม่คืบ | `lastProgressAtMs` + watchdog ใน FleetAgent: เงียบเกิน `videoTimeout+20` นาที จะ cancel แล้วรันใหม่ |

### 4.3 การกันสินค้าซ้ำ
- ตาราง `used_products` (`FP/db/UsedProductEntity.kt`): PK = `productId` ใช้ทั่วโลก ทุก keyword (`REPLACE` on conflict)
- **`markUsed` ทำใน `finish()` เท่านั้น** คือเมื่อคลิปเข้าคลังจริง (แต่ก่อนทำตอนส่งสร้างวิดีโอ แล้วถ้าดาวน์โหลดพลาด สินค้าจะถูกเผาโดยไม่มีคลิป) (1620-1623, 1646-1650)
- ตอนเก็บสินค้า ชุดที่กันไว้ = `usedProductIds() + pendingProductIds()` (STAGED/QUEUED) + `failedProductIdsThisRun` (สินค้าที่เก็บพลาดในรอบนี้ ล้างทุกครั้งที่เริ่มรอบใหม่) (`collectJobs` 283, `fillWarehouse` 1044-1045)
- กดซ่อน (`JobRepository.hideJob` 130) → `markUsed` + ลบไฟล์ + `hidden=1`
- ลบแถว (`deleteJob`) ไม่แตะ `used_products` สินค้านั้นจึงยังถือว่าใช้แล้ว

---

## 5. โหมดการรัน จำนวนต่อรอบ และการแจ้งเตือน

### 5.1 `FP/PipelineRunMode.kt` (dispatch ใน `run()` 169-183)
| โหมด | ทำอะไร | หยุดเมื่อ |
|---|---|---|
| `COLLECT_ONLY` | เก็บ N ชิ้นเป็น `QUEUED` | ได้ครบ N, สินค้าหมด หรือพลาดติดกัน 3 ครั้ง (เผื่อพลาดได้อีก 6 ครั้งนอกเหนือจาก N) |
| `GENERATE_PENDING` | เจน N ชิ้นจากคิว (ไม่หยิบตัวที่เคยพลาด) | ครบ, หรือเจอ STOP (daily limit / login / confirm timeout) |
| `GENERATE_ONE` | เจนตามที่ระบุ id 1 ชิ้น **ไม่สนเพดานรายวัน** | |
| `GENERATE_SELECTED` | เจนตามรายการที่ติ๊ก (รวมตัวที่เคยพลาด) | |
| `COLLECT_AND_GENERATE` | เก็บ N ชิ้นแล้วเจนต่อเลย (แบบเดิม) | |
| `COLLECT_AND_GENERATE_LOOP` | วนไม่จบ: หยิบจากคลังสินค้า (warehouse) ถ้าคลังว่างจะ `fillWarehouse` ทีเดียวสูงสุด `collectMaxPages` (ค่าเริ่ม 3 หน้า ≈ 60 ชิ้น) → เจน 1 ชิ้น → วนต่อ เจนพลาดก็ไปต่อ | สินค้าหมด 3 รอบติด หรือเก็บพลาด 3 ครั้งติด |
| `COLLECT_GENERATE_POST_LOOP` | สะสมคลิปให้เกิน `postBufferTarget` (ค่าเริ่ม 25) → โพสต์รวดสูงสุด 25 คลิป อยู่บัญชีเดิมจนเต็มเพดานวัน (ค่าเริ่ม 20 ต่อบัญชีต่อวัน / 5 ต่อชั่วโมง) แล้วค่อยสลับบัญชี ติดเพดานชั่วโมงจะกลับไปเจนรอ; keyword หมดจะหาสินค้าแบบไม่ใช้ keyword ต่อ | ทั้งเก็บ เจน และโพสต์ไม่คืบเลย 3 รอบติด |
| `POST_ONLY` | โพสต์จากคลังอย่างเดียว วนบัญชี รอเพดานชั่วโมงหรือรอข้ามเที่ยงคืน | คลังว่าง |

- จำนวนต่อรอบ (`rounds`) ตั้งได้ 1..200 (`PipelineViewModel.MAX_ROUNDS`) ใช้เฉพาะโหมดที่ไม่วน
- เพดานเจนต่อวันของเครื่อง `genDailyLimit` (0 = ไม่จำกัด) ถึงเพดานแล้วลูปรอทีละ 5 นาที ไม่จบลูป
- ดิสก์เหลือน้อยกว่า 2 GB จะหยุดเจน (การโพสต์ยังเดินต่อ)
- โหมดวน 3 โหมดจะบันทึก `setAutoLoop` ไว้ ถ้า service ตาย watchdog จะเปิดกลับมาเอง เว้นแต่ผู้ใช้กดหยุด

### 5.2 Telegram (`FP/settings/TelegramNotifier.kt`)
- เรียก Bot API `sendMessage` แบบยิงแล้วไม่รอผล (`disable_web_page_preview`) ส่งเฉพาะเมื่อเปิดใช้และมีทั้ง token และ chatId
- จุดที่ส่ง (ใน `transition()` 1686-1695):
  - `Done: <ชื่อ>`
  - `Not finished (<step>): <msg> - <ชื่อ>` (QUEUED ที่มี errorMsg)
  - `Failed (…)`
  - `Login required Google/Flow|Shopee`
- ที่อื่น:
  - โควต้า Gemini/OpenRouter หมด
  - คลิปโพสต์ไม่ได้ หรือโพสต์ล้มติดกัน (orchestrator 980/994)
  - บัญชีครบลิมิต (`PostForegroundService:176`)
  - ลูปค้าง (`FleetAgent:1286`)
- แจ้งเตือนบนเครื่อง: foreground notification แสดงข้อความไทยตามสถานะ (`PipelineForegroundService` ~245-265 เช่น "กำลังเจนวิดีโอ…", "เสร็จแล้ว ✓")

---

## 6. กับดักที่ระบุไว้ในคอมเมนต์

**ด้าน Meta AI**
1. แชทเก่าทำให้ได้คลิปผิดสินค้า → ต้องเปิดแชทใหม่และตรวจว่าว่างทุกชิ้น ตรวจ "ไม่มีสื่อเก่า" อีกรอบตอนส่ง
2. ส่งรูปกับข้อความใน SEND เดียว ข้อความหาย / paste ไปลง EditText ที่ซ่อนอยู่ช่องแรก ("ok") → ส่งแยกกันแล้วตรวจด้วย `textContains` 30 ตัวแรก **ห้ามเชื่อ "EditText ตัวแรก"**
3. URI รูปเดิมซ้ำ Meta อาจใช้รูปที่ cache ไว้ของสินค้าก่อน → ใช้ชื่อไฟล์ใหม่ทุกครั้ง
4. Meta จำรูปค้างในช่องแนบ (แม้ force-stop) และ retry เคยทำให้รูปซ้อน 3 รูป → ล้างก่อนทุกครั้ง
5. ไทล์คลิปโผล่**ก่อน**เรนเดอร์เสร็จ และรูปที่ส่งกับคลิปใช้ id เดียวกัน (`…_0_0`) → ใช้ป้ายความยาวหรือสัดส่วนแนวตั้ง แล้วยืนยันด้วย scrubber
6. Meta ตอบเป็นข้อความหรือเป็นรูปแทนวิดีโอ หรือไม่ตอบเลยถ้ารูปอัปโหลดค้าง → แยกตรวจทุกกรณี อย่ารอจนหมด 600 วิ
7. โควต้าวิดีโอเต็มชั่วคราว (เคยเกิดพร้อมกัน 3 เครื่อง) → รอ 10 นาที อย่า retry ถี่
8. ถ้าไม่มีบรรทัด "ทำเลยไม่ต้องถามกลับ" Meta จะตอบเป็นแผนแล้วรอ
9. ให้คนในคลิปถือสินค้า Meta จะวาดสินค้าใหม่ → ให้สินค้าวางนิ่งดีกว่า
10. อัปเดต Meta 292.x เปลี่ยน header (เอา id ออก) แล้วทุกงานพังที่ ensureReady → selector ต้อง override จากระยะไกลได้
11. ปุ่มส่งบางเวอร์ชันไม่มีป้าย → ใช้พิกัดสำรอง; คีย์บอร์ดที่เปิดอยู่ทำให้ swipe กลายเป็นการพิมพ์; แตะกลางไทล์เคยไปโดนปุ่ม STOP ของ pondy เองจนลูปหยุด
12. MediaStore อาจมีแถวที่ไม่มีไฟล์จริง หรือมีไฟล์ที่ดาวน์โหลดเสร็จช้าจากงานก่อน → ตรวจ `isPlayable` และ `DATE_ADDED ≥ เวลาที่กด`

**ด้าน pipeline และข้อมูล**
13. `markUsed` ต้องทำตอน DONE เท่านั้น
14. ห้ามใส่ errorMsg ตอนผู้ใช้กดหยุด (ไม่งั้นงานหายจากคิวอัตโนมัติ)
15. ค่าตั้งที่แก้ระยะไกลได้ต้องล็อกไว้ต่อชิ้น ทั้ง driver และ prompt (ค่าที่อ่านสองครั้งอาจไม่ตรงกัน)
16. ห้าม `SELECT *` คลังโดยไม่มี LIMIT และอย่าดึง caption มาแสดงใน list
17. prompt ไทยถูกใช้ตามตัวอักษร ส่วน `normalize()` ยุบขึ้นบรรทัดใหม่ทิ้ง
18. บทพูดที่มีคำแนวยา สารเคมี หรือ "ปลอดภัย" ทำให้ Veo ปฏิเสธ ("ระบบไม่ได้เรียกเก็บเงินจากคุณ")
19. เคยห้ามคำว่า "ยา" ตรง ๆ แล้วคำว่า "ยาง" กลายเป็น "ง" → ใช้รายการแทนคำที่ให้วลียาวมาก่อน
20. Gemini 3.x ยังคิด (thinking) แม้ตั้ง budget=0 → เรียกให้เขียนบทพูดคู่ขนานกับขั้นอื่น
21. รอ login แบบไม่มี timeout เคยทำให้เครื่องค้างทั้งคืน → ทุกการรอต้องมีเพดานเวลา
22. Flow: ภาพที่อัปโหลดต้องแนบเป็น "องค์ประกอบ" ไม่งั้นจะได้สินค้ามั่ว; ชื่อ "Veo 3.1 - Lite" เป็นส่วนขึ้นต้นของชื่อรุ่นฟรี ต้องเช็กชื่อที่เจาะจงกว่าก่อน (ถ้าพลาดเสียเครดิต); การกดเปิดแอปจากเบื้องหลังถูก Android 12+ บล็อกเงียบ ๆ (`docs/FLOW_LAUNCH_TROUBLESHOOTING.md` §2.1)

---

## 7. ร่างการทำซ้ำใน Node + ส่วนเสริม Chrome (ข้อเสนอ ไม่ได้มาจากโค้ด Pondy)
- ใช้ตาราง `jobs` ฟิลด์เดียวกับข้างบน + `used_products`; state ใช้ชุดเดียวกันได้ โดยตัด `FLOW_UPLOADING`/`IMAGE_GENERATING` ออก แล้วใช้ `PREPARING` / `AWAITING_USER_CLICK` / `RENDERING` / `RECEIVED` แทน
- ส่วนเสริมรับ `{jobId, imageUrl, prompt, promptHead}` จาก Node → เปิดแชทใหม่ → ตรวจว่าว่าง → แนบรูปและวาง prompt → อ่านกลับเพื่อยืนยัน → (ผู้ใช้กด) → poll หา `<video>` ที่เล่นได้ → ส่ง blob กลับพร้อม jobId → Node ตรวจไฟล์ (ffprobe: มีสตรีมวิดีโอ, ยาว 4-30 วิ, แนวตั้ง) → `DONE` + `markUsed`
- error จากส่วนเสริมควรเป็นรหัสคงที่ (`TEXT_REPLY`, `IMAGE_REPLY`, `UPLOAD_STUCK`, `TIMEOUT`, `CHAT_NOT_EMPTY`) แล้วให้ Node เลือก backoff แบบเดียวกับ §4.2
