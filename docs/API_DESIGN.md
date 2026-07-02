# API Design — AMZ Pickleball

> Hợp đồng API hiện tại + nguyên tắc thiết kế. Cập nhật: 2026-06-30.
> Phạm vi: serverless `api/*` (Vercel) và truy cập Firestore (qua SDK). KHÔNG đề xuất endpoint mới ngoài ghi nhận.

---

## 1. Serverless endpoints (Vercel `api/`)

### `POST /api/push-data`
Đẩy `events.json` + `players.json` lên GitHub repo (snapshot công khai).

| | |
|---|---|
| **Auth** | Header `Authorization: Bearer <Firebase ID token>` |
| **Authz** | ⚠️ Hiện chỉ verify token hợp lệ. **Phải** kiểm admin (ADR-0003 / DESIGN-admin-auth) |
| **Body** | `{ "eventsJSON": string, "playersJSON": string }` (chuỗi JSON đã serialize) |
| **200** | `{ "ok": true }` |
| **400** | `{ "error": "Missing data" }` |
| **401** | `{ "error": "Missing auth token" \| "Invalid token" }` |
| **403** | *(cần bổ sung)* không phải admin |
| **405** | method ≠ POST |
| **500** | `GITHUB_TOKEN not set` / lỗi GitHub PUT |
| **Side-effect** | Commit `chore: export events/players <date>` vào `master` → trigger deploy |

### `POST /api/push-videos`
Đẩy `videos.json` (kết quả duyệt video).

| | |
|---|---|
| **Auth/Authz** | Như trên (cùng lỗ hổng authz — ADR-0003) |
| **Body** | `{ "videoData": object }` |
| **200** | `{ "ok": true, "message": "Pushed to GitHub successfully" }` |
| **400/401/405/500** | tương tự push-data |
| **Side-effect** | Commit `chore: update video approvals <date>` |

---

## 2. Truy cập Firestore (qua SDK, không phải REST nội bộ)

App-nextjs và admin.html không gọi REST riêng mà dùng Firebase Web SDK; "API" ở đây là tập hàm trong `app-nextjs/src/lib/firestore.ts` + quyền do `firestore.rules` kiểm.

| Nhóm hàm (lib/firestore.ts) | Thao tác | Collection | Phân quyền (mục tiêu) |
|---|---|---|---|
| `getCourts` | read | courts | public |
| `getBookingsByDate`, `createBooking`, `updateBookingStatus` | read/create/update | bookings | owner-or-admin (DESIGN-firestore-rules) |
| `getPlayers` | read | players | public |
| tournaments/events/matches/groups | read/write | … | read public, write admin |
| registrations | create/read | registrations | create: signed-in (siết — TD-03) |

> Hợp đồng kiểu (request/response shape) định nghĩa ở `app-nextjs/src/types/index.ts` và `firestore-schema.md`.

---

## 3. Nguyên tắc thiết kế API (cho thay đổi tương lai)
1. **Authn ≠ Authz:** verify token *và* kiểm vai trò ở mọi endpoint ghi.
2. **Least privilege:** endpoint/rule chỉ mở đúng nhu cầu.
3. **Idempotent ghi:** đọc SHA rồi PUT (đã áp dụng trong push-*); thao tác lặp không gây hại.
4. **Mã lỗi nhất quán:** 400 (input), 401 (chưa auth), 403 (không quyền), 405 (method), 500 (server).
5. **Không lộ secret trong log/response;** log đủ để truy vết (request id, lý do từ chối).
6. **Validate input** theo schema trước khi ghi (đặc biệt body push-* và registration).
7. **Versioning:** nếu cần đổi hợp đồng phá vỡ tương thích → tiền tố `/api/v2/...`, không sửa ngầm `v1`.

---

## 4. Bảng mã trạng thái chuẩn

| Code | Khi nào |
|---|---|
| 200 | Thành công |
| 400 | Body/tham số sai hoặc thiếu |
| 401 | Thiếu/sai token |
| 403 | Token hợp lệ nhưng không đủ quyền (admin) |
| 405 | HTTP method không hỗ trợ |
| 429 | (đề xuất) rate limit khi mở endpoint công khai |
| 500 | Lỗi server/cấu hình (thiếu env) |

## 5. Tham chiếu
- Auth chi tiết → `docs/design/DESIGN-admin-auth.md`, `SECURITY.md`
- Rules → `docs/design/DESIGN-firestore-rules.md`
- Module → `MODULE_BOUNDARY.md`
