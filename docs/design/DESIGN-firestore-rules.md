# Design Doc — Hoàn thiện & chuẩn hoá Firestore Rules

> Liên quan: TD-03 (P0), TD-04 (P1). Trạng thái: **TD-03 đã sửa code (firestore.rules) 2026-06-30** — chờ emulator test + deploy thủ công. TD-04 vẫn Proposed (P1).
> Runbook: `docs/runbooks/TD-03-registrations-rule-runbook.md`. Logic test: 9/9 PASS (sandbox).
>
> ### Điều chỉnh khi triển khai TD-03 (quan trọng)
> Đăng ký giải là **công khai, KHÔNG đăng nhập** → **không** dùng `create: if request.auth != null` (sẽ hỏng form). Thay bằng **validate shape** (`isValidPublicRegistration()`): chỉ cho tạo đúng field + luôn `pending` + `source='public'` + không set id/seed. Admin bypass qua `isAdmin()`.
> ADR: `docs/adr/ADR-0002-firestore-single-source-of-truth.md` (liên quan nguồn dữ liệu).
> **Gate:** chỉ triển khai sau khi 4 mục dưới được duyệt + test trên emulator.

---

## 1. Tài liệu thiết kế

### Vấn đề
- `registrations` cho `create: if true` → ghi rác không cần đăng nhập (P0, SECURITY #3).
- `firestore.rules` **thiếu** rule cho `users`, `courts`, `bookings`, `payments`, `members`, `elo_history` → mặc định DENY → app-nextjs (đặt sân/hội viên) bị chặn (P1).
- Lệch: schema doc để `registrations` là sub-collection, code dùng top-level; `config`/`videos`/`groups` có rule nhưng không có trong schema doc.

### Nguyên tắc thiết kế rules
- **Least privilege:** mặc định từ chối; chỉ mở đúng nhu cầu.
- **Public read** cho dữ liệu hiển thị: `players`, `tournaments`, `events`, `matches`, `groups`, `courts`.
- **Owner-or-admin** cho dữ liệu cá nhân: `users`, `members`, `bookings`, `payments`.
- **Append-only** cho audit: `elo_history`, `payments` (cấm `update`/`delete`).
- **Validate field** cho `create` công khai (`registrations`): yêu cầu auth + giới hạn key/kích thước.
- Vai trò admin qua **custom claim** (lộ trình) thay cho hardcode email.

### Phác thảo rule (mô tả, không phải bản cuối)
```
function isAdmin()  { return request.auth.token.admin == true
                       || request.auth.token.email == ADMIN_EMAIL; }
function isSignedIn(){ return request.auth != null; }
function isOwner(uid){ return isSignedIn() && request.auth.uid == uid; }

courts:       read: true;            write: isAdmin();
bookings:     read: isOwner(resource.data.userId) || isAdmin();
              create: isSignedIn() && validBooking();
              update,delete: isAdmin();
payments:     read: isOwner(...) || isAdmin();  create: isAdmin();  update,delete: false;
members:      read: isOwner(uid) || isAdmin();  write: isAdmin();
users:        read: isOwner(uid) || isAdmin();  write: isOwner(uid) || isAdmin();
elo_history:  read: true;  create: isAdmin();  update,delete: false;
registrations:read: true;  create: isSignedIn() && validReg();  update,delete: isAdmin();
```

### Thống nhất cấu trúc
- Chốt `registrations` là **top-level** (theo code) → cập nhật `firestore-schema.md` (DATABASE.md Nấc 1).

---

## 2. Kế hoạch migration

| Bước | Hành động |
|---|---|
| M1 | Lưu bản `firestore.rules` hiện tại (đã có trong git) làm mốc rollback |
| M2 | Viết rules mới + cài Firebase Emulator Suite |
| M3 | Viết test rules (cho phép/từ chối từng vai trò) chạy trên emulator |
| M4 | Deploy lên **Firebase project staging** (nếu có) hoặc test kỹ emulator |
| M5 | `firebase deploy --only firestore:rules` (lý tưởng qua CI — TD-07) |
| M6 | Smoke test: app-nextjs đặt sân được; registration cần đăng nhập; audit append-only |

> Dữ liệu KHÔNG đổi — chỉ đổi rules. Không cần migrate document (trừ khi đồng thời chuẩn hoá shape `players` ở TD-06, làm tách riêng).

---

## 3. Kế hoạch rollback

| Tình huống | Hành động |
|---|---|
| App/đặt sân hỏng sau deploy rules | `firebase deploy --only firestore:rules` với bản cũ (từ git mốc M1) |
| Admin không ghi được | Kiểm custom claim/email trong `isAdmin()` |

**Mức rollback: ⚠️ Có điều kiện** — rules thay thế toàn bộ; phải có bản cũ để redeploy. RTO < 15 phút nếu giữ sẵn bản cũ.

---

## 4. Tiêu chí nghiệm thu

- [ ] Emulator test xanh cho mọi cặp (vai trò × collection × thao tác).
- [ ] `registrations.create` **bị từ chối** khi chưa đăng nhập; **chấp nhận** khi đăng nhập + field hợp lệ.
- [ ] `courts/bookings/members/payments/users/elo_history` có rule rõ ràng (không còn default-deny ngoài ý muốn).
- [ ] `elo_history` và `payments` **không** cho `update`/`delete` (append-only).
- [ ] app-nextjs (local) đặt sân + xem hội viên hoạt động với rules mới.
- [ ] Public vẫn đọc được `players/tournaments/events/matches/courts`.
- [ ] `firestore-schema.md` cập nhật khớp `registrations` top-level.
