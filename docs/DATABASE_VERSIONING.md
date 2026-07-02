# Database Versioning — AMZ Pickleball

> Chiến lược quản lý phiên bản schema Firestore + rules + snapshot JSON. Cập nhật: 2026-06-30.
> Firestore schemaless → versioning là **kỷ luật ở tầng app/tài liệu**, không phải migration SQL.

---

## 1. Hiện trạng (chưa có versioning)
- `firestore.rules` chỉ có `rules_version = '2'` (phiên bản cú pháp Firestore, KHÔNG phải version schema của ta).
- `firestore-schema.md` ghi "Phiên bản: 1.0" nhưng không gắn với cơ chế migration nào.
- Không có trường `schemaVersion` trên document; không có bảng lịch sử migration; rules deploy thủ công.

→ Rủi ro: schema doc, rules, và dữ liệu thật trôi khác nhau (xem `DATABASE.md`).

---

## 2. Chiến lược đề xuất

### 2.1 Đánh version schema
- Thêm `settings/appConfig.schemaVersion` (số nguyên tăng dần) làm **version schema toàn cục**.
- (Tuỳ chọn) thêm `schemaVersion` vào document của collection thay đổi nhiều (`players`, `bookings`) để migrate dần (lazy).

### 2.2 Migration có kiểm soát
- Mỗi thay đổi schema = một **migration script** đánh số: `migrations/0001-...`, `0002-...` (idempotent, chạy lại an toàn).
- Quy ước: script đọc `schemaVersion`, chỉ áp dụng nếu thấp hơn target, rồi tăng version.
- Lazy migration: code đọc tài liệu, nếu thiếu field mới thì điền default/migrate khi ghi.

### 2.3 Versioning rules
- `firestore.rules` quản lý bằng git (đã có). Bổ sung: deploy qua CI (TD-07) với tag/commit gắn version.
- Luôn giữ bản rules trước khi deploy để rollback (DESIGN-firestore-rules).

### 2.4 Versioning snapshot JSON
- `data/*.json` đã có `lastUpdated`. Bổ sung `schemaVersion` trong mỗi file để site tĩnh biết shape.
- Snapshot phải khớp version Firestore tại thời điểm sinh.

---

## 3. Quy trình thay đổi schema (checklist)
1. Cập nhật `firestore-schema.md` (mô tả field mới).
2. Tăng `schemaVersion` mục tiêu.
3. Viết migration script idempotent + test trên emulator/staging.
4. Cập nhật `firestore.rules` nếu cần (qua DESIGN-firestore-rules + emulator test).
5. **Backup** (mục 4) trước khi chạy production.
6. Chạy migration → verify → cập nhật snapshot JSON.
7. Ghi vào CHANGELOG migration.

---

## 4. Backup & khôi phục
- Bật **Firestore scheduled export** (GCS) hằng ngày trước khi áp dụng versioning quan trọng.
- Trước mỗi migration phá vỡ: export thủ công + lưu snapshot `data/*.json` hiện tại.
- Khôi phục: import từ GCS export; rules rollback từ git.

---

## 5. Khoản nợ liên quan
- TD-04 (rules), TD-06 (chuẩn hoá shape players → cần migration), TD-09 (migrate `settings/adminData` blob).
- Migration đầu tiên nên là: **chuẩn hoá `players`** (gộp level/points ↔ duprLevel/elo) — gắn ADR-0002.

## 6. Tham chiếu
- `DATABASE.md`, `ERD.md`, `firestore-schema.md`, `docs/design/DESIGN-firestore-rules.md`
