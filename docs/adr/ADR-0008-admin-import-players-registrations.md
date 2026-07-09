# ADR-0008 — Admin Import VĐV và Đăng ký giải

- **Trạng thái:** Proposed
- **Ngày:** 2026-07-09
- **Người quyết định:** Owner
- **Liên quan:** ADR-0007 (Tournament Auto Pairing MVP), `docs/operations/AUTO_PAIRING_TEST_CHECKLIST.md`

## 1. Trạng thái

Proposed — chưa triển khai code, chờ Owner/ChatGPT duyệt phương án trước khi build.

## 2. Bối cảnh

Hiện tại phải nhập tay từng VĐV (`savePlayer()`) và từng registration (`saveReg2()`) qua modal trong `admin.html`. Với giải nội bộ AMZ, đặc biệt luồng Auto Pairing (ADR-0007), cần tạo nhanh 32 VĐV + 32 registration cá nhân cho mỗi event (Trình Thấp, Trình Cao) — nhập tay từng người gây tốn thời gian và dễ sai sót (sai `gender`, thiếu `amz_rating`, quên đặt `player_2_id = null`...).

Cần một hệ thống import từ CSV/Excel, nhưng phải bảo đảm không ghi nhầm dữ liệu thật lên Firestore hay lộ dữ liệu test ra website công khai.

## 3. Quyết định chính

- Tạo **tab mới trong admin: "Import dữ liệu"**.
- **Không** nhét module import vào tab Đăng ký giải — luồng import khác hẳn luồng CRUD từng bản ghi, nhét chung dễ gây thao tác nhầm.
- Import gồm **3 giai đoạn tách biệt**:
  1. Parse + Validate
  2. Preview
  3. Confirm + Batch write
- **Không ghi Firestore ở bước preview.**
- **Không export dữ liệu public** từ module import.
- **Không tự động bấm "Xuất dữ liệu lên web"** ở bất kỳ bước nào của import.
- **Không sửa public web** (`index.html`) trong phạm vi ADR này.

## 4. Hai chế độ import

**Chế độ A — Import chỉ tạo VĐV**

CSV template:
```
full_name,gender,amz_rating,phone,email,note
```

**Chế độ B — Import VĐV + registration cá nhân vào 1 event**

CSV template:
```
full_name,gender,amz_rating,phone,email,note,registration_status,payment_status
```

Mặc định khi để trống:
- `registration_status` = `confirmed`
- `payment_status` = `paid`
- `player_2_id` = `null` (luôn luôn, đúng tiền đề đăng ký cá nhân của ADR-0007)
- `source` = `"admin_import"`
- `import_batch_id` = batch id chung cho cả lần import

## 5. Schema quyết định

**`players`** (field ghi khi tạo mới qua import):
- `full_name` — bắt buộc
- `phone` — optional
- `email` — optional
- `gender` — bắt buộc, chỉ nhận `male`/`female`
- `amz_rating` — bắt buộc, phải là số hợp lệ
- `note` — optional
- `source = "admin_import"` — nếu bản ghi được tạo từ import
- `import_batch_id` — nếu bản ghi được tạo từ import
- `created_at` — nếu tạo mới (theo đúng convention hiện có của `savePlayer()`)

**`registrations`** (field ghi khi tạo mới qua import, chế độ B):
- `event_id`
- `player_1_id`
- `player_2_id = null`
- `status`
- `payment_status`
- `source = "admin_import"`
- `import_batch_id`
- `created_at` — nếu tạo mới

**Không thêm `tournament_id` vào `registrations` ở MVP** — schema hiện tại (`saveReg2()`) không dùng field này; tournament được suy ra gián tiếp qua `events.tournament_id`. Giữ nguyên cách suy ra gián tiếp, không đổi schema registration ngoài phạm vi cần thiết.

## 6. Duplicate policy (MVP)

- **Không tự động update player đã tồn tại.**
- Nếu phát hiện **trùng `full_name` đã chuẩn hóa** (trim + lowercase) hoặc **trùng `phone`** với player đang có trong hệ thống → hiển thị **warning/error trong preview**, không tự ý quyết định thay Owner.
- **Commit ghi Firestore chỉ được chạy khi preview không còn lỗi đỏ** (error), warning có thể cho phép Owner tự quyết định tiếp tục hay không.
- Việc "dùng lại player cũ" hoặc "cập nhật player cũ" (update `amz_rating`/`gender` khi phát hiện trùng) **để lại cho phase sau** — MVP không tự động làm.

## 7. Validate bắt buộc

- `full_name` không được rỗng.
- `gender` chỉ nhận `male` hoặc `female`.
- `amz_rating` phải là số hợp lệ (không NaN, không rỗng).
- Không được có dòng trùng nhau trong cùng 1 file CSV.
- Ở chế độ B: **bắt buộc phải chọn event** trước khi cho phép chạy import — không cho import nếu chưa chọn.
- Không tạo registration mới nếu player đó **đã có registration tồn tại** cho đúng event đang chọn.
- Nếu Owner nhập `expectedCount` (số dòng kỳ vọng), số dòng hợp lệ sau validate phải khớp đúng `expectedCount`, nếu không phải cảnh báo rõ trước khi cho ghi.

## 8. Privacy / Public data guardrails

- Không nhập số điện thoại/email thật cho dữ liệu test nếu không bắt buộc.
- Tên VĐV dữ liệu test phải có tiền tố rõ ràng, ví dụ `TEST_`.
- **Không bấm "Xuất dữ liệu lên web" khi còn dữ liệu test** trong Firestore (đã ghi nhận tại `AUTO_PAIRING_TEST_CHECKLIST.md`).
- Import chỉ ghi vào Firestore qua giao diện admin — **không tự động đẩy dữ liệu ra website công khai**.
- `data/players.json` chỉ thay đổi khi có thao tác export web riêng (bấm nút "Xuất dữ liệu lên web") — **không thuộc phạm vi/hành vi của module import**.

## 9. Batch write

- Dùng `_fsdb.batch()` khi triển khai bước ghi Firestore (Commit 3, xem mục 12).
- **Giới hạn cứng của Firestore: tối đa 500 writes/batch.**
- Nếu tổng số write (player + registration) vượt 500, phải **chia thành nhiều batch tuần tự**.
- Với quy mô test 32 VĐV + 32 registration = 64 writes — an toàn, không cần chia batch.

## 10. Cleanup

- `import_batch_id` giúp truy vết toàn bộ dữ liệu được tạo từ 1 lần import cụ thể.
- Có thể bổ sung chức năng **cleanup theo `import_batch_id`** ở phase sau (xem Commit 4, mục 12).
- Cleanup **không nằm trong commit preview hay commit ghi Firestore đầu tiên** nếu vượt phạm vi — chỉ đề xuất, chưa triển khai ngay.
- Bất kỳ chức năng cleanup nào trong tương lai đều phải có cảnh báo rõ ràng và **không được xóa dữ liệu thật** — chỉ xóa đúng bản ghi có `import_batch_id` khớp và đã được Owner xác nhận là dữ liệu test.

## 11. Commit plan

- **Commit 1 — Docs only:** ADR-0008 (tài liệu này). Không sửa code.
- **Commit 2 — Import UI + CSV parser + preview/validation only:** Thêm tab "Import dữ liệu", parse CSV, chạy toàn bộ validate (mục 7), hiển thị preview. **Không ghi Firestore** ở commit này.
- **Commit 3 — Firestore batch write sau confirm:** Thêm bước ghi thật qua `_fsdb.batch()` (mục 9), **chỉ chạy khi preview hợp lệ** (không còn lỗi đỏ) và Owner xác nhận rõ ràng qua hộp thoại confirm.
- **Commit 4 — Import history / cleanup theo `import_batch_id`:** Chỉ làm nếu Owner duyệt riêng sau khi Commit 1-3 đã hoạt động ổn định.

Mỗi commit chỉ làm đúng 1 việc, không gộp; mỗi bước cần Owner/ChatGPT xác nhận trước khi Claude Code triển khai bước tiếp theo, theo đúng `AMZ_DECISION_PROTOCOL.md`.

## 12. Non-goals

- Không import trực tiếp từ file Excel `.xlsx` ở MVP — chỉ nhận CSV hoặc dữ liệu dán dạng CSV.
- Không sửa public website (`index.html`).
- Không sửa `api/push-data.js`.
- Không tự động export dữ liệu lên web ở bất kỳ bước nào của import.
- Không tự động chạy Auto Pairing (ADR-0007) ngay sau khi import xong — 2 tính năng tách biệt, import chỉ chuẩn bị dữ liệu đầu vào.
- Không tự động xóa dữ liệu test — mọi thao tác xóa/dọn dữ liệu đều cần Owner xác nhận thủ công (xem mục 10).
