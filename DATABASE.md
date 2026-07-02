# DATABASE.md — AMZ Pickleball

> Kiểm toán cơ sở dữ liệu Firestore (dự án `amz-pickleball`). Cập nhật: 2026-06-30.
> Nguồn: `firestore-schema.md` (thiết kế), `firestore.rules` (đang áp dụng), code `admin.html` + `app-nextjs/src/lib/firestore.ts` (thực dùng), `data/*.json` (snapshot).

---

## 1. Danh sách collection Firestore

Cột "Trong code", "Trong rules", "Trong schema doc" cho thấy độ lệch giữa thiết kế và thực tế.

| Collection | Mục đích | Code dùng | Có rule? | Trong schema doc? |
|---|---|---|---|---|
| `users/{uid}` | Tài khoản (role admin/staff/member/guest) | — (chưa thấy) | ❌ Không | ✅ |
| `players/{id}` | Hồ sơ thi đấu (ELO, DUPR, stats) | admin.html, app-nextjs | ✅ read:all / write:admin | ✅ |
| `courts/{id}` | 8 sân | app-nextjs | ❌ **Thiếu** | ✅ |
| `bookings/{id}` | Đặt sân (transaction chống double-book) | app-nextjs | ❌ **Thiếu** | ✅ |
| `payments/{id}` | Lịch sử thanh toán (append-only) | — (schema) | ❌ **Thiếu** | ✅ |
| `members/{uid}` | Gói hội viên | app-nextjs (`/hoi-vien`) | ❌ **Thiếu** | ✅ |
| `tournaments/{id}` | Giải đấu | admin.html, app-nextjs | ✅ read:all / write:admin | ✅ |
| `events/{id}` | Sự kiện (public) | admin.html, app-nextjs | ✅ read:all / write:admin | ⚠️ một phần |
| `matches/{id}` | Kết quả trận → tính ELO | admin.html, app-nextjs | ✅ read:all / write:admin | ✅ |
| `groups/{id}` | Bảng đấu vòng tròn | admin.html, app-nextjs | ✅ read:all / write:admin | ⚠️ không có trong schema doc |
| `registrations/{id}` | Đăng ký giải (top-level) | admin.html, app-nextjs `dang-ky` | ✅ **create:all** / RUD:admin | ⚠️ schema để là sub-collection |
| `elo_history/{id}` | Nhật ký ELO (append-only) | — (schema) | ❌ **Thiếu** | ✅ |
| `settings/{id}` | `adminData` (blob tạm) + `appConfig` | admin.html | ✅ read+write:admin | ✅ |
| `config/{id}` | Cấu hình | — | ✅ read+write:admin | ❌ (chỉ trong rules) |
| `videos/{id}` | Video YouTube duyệt | admin.html | ✅ read+write:admin | ❌ (chỉ trong rules) |

### Ba bộ "sự thật" không khớp nhau

- **Rules có nhưng schema doc không mô tả:** `config`, `videos`, `groups`.
- **Schema doc có nhưng rules thiếu (⇒ mặc định DENY):** `users`, `courts`, `bookings`, `payments`, `members`, `elo_history`.
- **Mâu thuẫn cấu trúc `registrations`:** schema thiết kế là sub-collection `/tournaments/{id}/registrations/{regId}`, nhưng rules + code dùng **collection top-level** `registrations`. Cần thống nhất một kiểu.

> Hệ quả vận hành: các tính năng của `app-nextjs` đụng `courts`/`bookings`/`members` sẽ **bị Firestore từ chối** vì không có rule khớp (fail-closed). Đây là lý do app chưa thể chạy thật ngoài local. Đồng thời nó là dấu hiệu schema doc đi trước rules/code khá xa.

---

## 2. Quan hệ giữa các collection

```
users (uid) ─────────────┐
   │ 1-1                  │ ref userId
   ▼                      ▼
members (uid)         players (playerId) ──────────────┐
                          │                              │
                          │ ref playerId                 │ ref player1Id/player2Id
                          ▼                              ▼
                 registrations ──ref tournamentId──▶ tournaments ──┐
                          │                                         │
                          │                              ref tournamentId
                          ▼                                         ▼
                       (đăng ký)                                matches
                                                                   │
                                                       sinh ra     ▼
                                                              elo_history (ref playerId, matchId)

courts (courtId) ──ref courtId──▶ bookings ──ref paymentId──▶ payments
                                      │                          ▲
                                      └── ref userId ────────────┘ (userId)
groups ──(chứa danh sách)──▶ players  (bảng đấu vòng tròn trong 1 tournament)
```

Tóm tắt khóa ngoại (logic, Firestore không ép ràng buộc):

| Từ | Trường | Tới |
|---|---|---|
| players | userId | users |
| members | userId | users |
| bookings | courtId / userId / paymentId | courts / users / payments |
| payments | bookingId / userId | bookings / users |
| registrations | playerId / partnerId / tournamentId | players / players / tournaments |
| matches | tournamentId / team*.player*Id / winnerId | tournaments / players |
| elo_history | playerId / matchId / tournamentId / opponent*Id | players / matches / tournaments |

> Lưu ý: nhiều trường được **denormalize** (vd `bookings.playerName`, `registrations.playerName`) — chấp nhận được với Firestore, nhưng phải đồng bộ khi `players.name` đổi.

---

## 3. Collection đang bị trùng với JSON

Site tĩnh đọc `data/*.json`; cùng nội dung lại nằm trong Firestore → **trùng nguồn**.

| File JSON (site tĩnh đọc) | Collection Firestore tương ứng | Tình trạng trùng / lệch shape |
|---|---|---|
| `data/players.json` | `players` | 🔴 **Trùng + lệch shape.** JSON: `level`, `initials`, `stats.{tournaments,wins,points}`. Firestore: `duprLevel`, `elo`, `tier`, `stats.{totalMatches,wins,losses,tournamentsPlayed,points}`. Hai mô hình điểm khác nhau (`points` vs `elo`). |
| `data/events.json` | `events` (và một phần `tournaments`) | 🔴 **Trùng.** JSON: `name/date/type/status/maxTeams/levels/prize/note/image`. Firestore `tournaments` chi tiết hơn (`format`, `entryFee`, `categories`...). Ranh giới events vs tournaments mờ. |
| `data/videos.json` | `videos` | 🟠 **Trùng có chủ đích.** admin duyệt trong Firestore → push ra JSON. Cron `sync-youtube.yml` cũng ghi thẳng `videos.json`. Hai đường ghi vào cùng file. |
| `data/blog-posts.json` | (không có collection) | 🟢 Không trùng. Chỉ tĩnh + `content/*.md` nguồn. |

**Vấn đề cốt lõi:** `players` và `events` có **hai nguồn ghi độc lập** (admin→JSON cho site tĩnh; app-nextjs→Firestore live) trên cùng dữ liệu khái niệm, với **schema đã trôi khác nhau**. Rủi ro: bảng xếp hạng hiển thị ở site tĩnh và ở app sẽ lệch số liệu.

---

## 4. Đề xuất chuẩn hóa (không refactor lớn — theo nấc)

> Mục tiêu: một nguồn sự thật cho mỗi loại dữ liệu, rules khớp code, schema doc khớp thực tế. Làm tăng dần, không đập đi xây lại.

### Nấc 1 — Khớp rules với thực tế (ưu tiên cao, ít rủi ro)
1. Bổ sung rule cho các collection app-nextjs cần: `courts` (read:all, write:admin), `bookings` (create: user đã đăng nhập, read/update: chủ booking hoặc admin), `members`/`payments`/`users` (read/write: chủ sở hữu hoặc admin), `elo_history` (read:all, write: chỉ server/admin, **cấm update/delete**).
2. Thống nhất `registrations`: chọn **top-level** (đúng như code đang dùng) → cập nhật `firestore-schema.md` cho khớp, bỏ mô tả sub-collection. Siết `create` (yêu cầu đăng nhập + giới hạn field) thay cho `create: if true`.
3. Thêm composite indexes như `firestore-schema.md` đã liệt kê (bookings, players, tournaments, elo_history, payments).

### Nấc 2 — Chốt nguồn sự thật cho players & events (ưu tiên cao)
4. Chọn **Firestore là nguồn chính** cho `players` và `events`/`tournaments`.
5. Thống nhất **một** shape `players` (gộp `level`↔`duprLevel`, `points`↔`elo`). Giữ cơ chế push hiện có để sinh `data/players.json` từ Firestore (snapshot công khai) — site tĩnh vẫn nhanh, nhưng chỉ còn một chiều ghi.
6. Định nghĩa rõ ranh giới **`events`** (mục public, marketing) vs **`tournaments`** (thực thể giải đấu có đăng ký/lịch/kết quả). Tránh hai collection mô tả cùng một giải.

### Nấc 3 — Dọn cấu trúc tạm (ưu tiên trung)
7. `settings/adminData` đang là "blob tạm" chứa `players[]/tournaments[]/registrations[]/history[]` (theo schema doc). Lập kế hoạch migrate sang các collection riêng, rồi ngừng đọc blob.
8. Đồng bộ hai đường ghi `videos.json` (admin push vs cron) về một quy ước (vd cron chỉ thêm "candidate", admin duyệt mới publish) để tránh ghi đè lẫn nhau.

> Tất cả thay đổi rules nên test bằng Firestore Rules emulator trước khi `firebase deploy --only firestore:rules`.

---

## 5. Tham chiếu
- Schema chi tiết theo từng field → `firestore-schema.md`
- Rủi ro rules (`create: if true`, thiếu rule) → `SECURITY.md`
- Bức tranh kiến trúc & luồng dữ liệu → `ARCHITECTURE.md`
