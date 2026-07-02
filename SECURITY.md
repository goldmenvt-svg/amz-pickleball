# SECURITY.md — AMZ Pickleball

> Kiểm toán bảo mật. Cập nhật: 2026-06-30. Vai trò: CTO / Software Architect.
> Thang mức độ: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low.
> Tài liệu này chỉ ghi nhận & khuyến nghị — KHÔNG tự sửa code.

---

## Tóm tắt mức độ

| # | Rủi ro | Mức |
|---|---|---|
| 1 | API `push-*` không kiểm tra admin (broken access control) | 🔴 Critical |
| 2 | Pipeline GitHub Pages có thể bỏ qua Basic auth + headers | 🟠 High |
| 3 | `firestore.rules`: `registrations` cho `create: if true` | 🟠 High |
| 4 | `firestore.rules` thiếu rule cho nhiều collection | 🟡 Medium |
| 5 | Một danh tính admin hardcode, không App Check | 🟡 Medium |
| 6 | CSP cho `'unsafe-inline'` script | 🟡 Medium |
| 7 | Quản lý secret (`GITHUB_TOKEN`, hash) | 🟡 Medium |
| 8 | Firebase web config lộ trong client | 🟢 Low |
| 9 | Vệ sinh repo / file dev lẫn lộn | 🟢 Low |

---

## 1. 🔴 API `push-*` không xác thực quyền admin

**Vị trí:** `api/push-data.js`, `api/push-videos.js`.

**Mô tả:** Hai function verify Firebase ID token bằng `identitytoolkit accounts:lookup` rồi chỉ kiểm `verifyRes.ok`. Nghĩa là **bất kỳ user Firebase hợp lệ nào** (không nhất thiết là admin `goldmenvt@gmail.com`) cũng vượt qua được, rồi function dùng `GITHUB_TOKEN` (quyền ghi repo) để PUT nội dung vào `data/*.json`.

**Tác động:** Nếu dự án Firebase cho phép tự đăng ký (email/password hoặc anonymous), kẻ tấn công tạo tài khoản → gọi `/api/push-data` với `eventsJSON`/`playersJSON` tùy ý → nội dung được commit và **deploy lên site công khai**. Dẫn đến defacement và **stored XSS** (kết hợp #6). Đây là leo thang quyền ghi production.

**Khắc phục (khuyến nghị):**
- Sau `accounts:lookup`, đọc `users[0].email` trong response và **chỉ cho qua nếu** đúng email admin (hoặc kiểm custom claim `admin === true`).
- Lý tưởng: dùng **Firebase Admin SDK** `verifyIdToken()` (đã khai báo `FIREBASE_ADMIN_SERVICE_ACCOUNT_KEY` trong `.env.local.example` nhưng chưa dùng) để verify chữ ký phía server thay vì REST.
- Kiểm tra cấu hình Firebase Auth: **tắt self-signup** nếu chỉ admin được dùng.

---

## 2. 🟠 GitHub Pages có thể vô hiệu hoá Basic auth + security headers

**Vị trí:** `.github/workflows/deploy.yml`, `CNAME` (so với `middleware.js`, `vercel.json`).

**Mô tả:** Basic auth bảo vệ `/admin.html` (`middleware.js`) và toàn bộ security headers (`vercel.json`) **chỉ chạy trên Vercel**. Repo lại có pipeline GitHub Pages deploy cùng domain `amzpickleball.vn`. Nếu DNS trỏ (hoặc bị chuyển) về Pages, `admin.html` được phục vụ **không có Basic auth** và **không có CSP/HSTS/X-Frame-Options**.

**Tác động:** Panel quản trị lộ public; mất phòng thủ clickjacking/XSS ở tầng header. Dù admin.html còn lớp Firebase login, việc panel lộ ra giảm đáng kể chiều sâu phòng thủ.

**Khắc phục:** Chốt **một** host = Vercel. Vô hiệu hoá `deploy.yml` và `CNAME`; cấu hình domain trong Vercel. Xác minh DNS hiện đang trỏ Vercel.

---

## 3. 🟠 `registrations` cho phép tạo không cần đăng nhập

**Vị trí:** `firestore.rules` → `match /registrations/{regId} { allow create: if true; ... }`.

**Mô tả:** Bất kỳ ai (không cần auth) cũng tạo được document `registrations`.

**Tác động:** Spam/abuse — ghi rác vào Firestore, tăng chi phí, làm nhiễu dữ liệu đăng ký giải. Không kiểm soát nội dung field.

**Khắc phục:** Yêu cầu `request.auth != null`; validate kích thước/định dạng field (`request.resource.data` đúng schema, giới hạn key); cân nhắc rate-limit phía app hoặc App Check.

---

## 4. 🟡 `firestore.rules` thiếu rule cho nhiều collection

**Vị trí:** `firestore.rules` so với `firestore-schema.md` và code app-nextjs.

**Mô tả:** Không có `match` cho `users`, `courts`, `bookings`, `payments`, `members`, `elo_history`. Firestore mặc định **deny** → an toàn (fail-closed) nhưng khiến tính năng đặt sân/hội viên của app-nextjs không chạy được; đồng thời cho thấy rules đi sau thiết kế.

**Tác động:** Rủi ro chính là **vận hành** (tính năng hỏng), và nguy cơ tương lai: khi vội cho app chạy, dễ thêm rule quá lỏng (vd `allow read, write: if true`).

**Khắc phục:** Bổ sung rule tối thiểu-đặc-quyền cho từng collection (xem `DATABASE.md` mục 4, Nấc 1). Đặc biệt `elo_history`/`payments` phải **append-only** (cấm update/delete), khớp nguyên tắc audit trail trong schema doc. Test bằng Rules emulator trước khi deploy.

---

## 5. 🟡 Một danh tính admin hardcode, chưa bật App Check

**Vị trí:** `firestore.rules` (`email == "goldmenvt@gmail.com"`), `middleware.js`, dự án Firebase.

**Mô tả:** Toàn bộ quyền ghi gắn vào một email. Không phân tách vai trò (admin/staff như schema doc dự kiến chưa hiện thực trong rules). Chưa thấy bật Firebase App Check → API key có thể bị dùng từ origin khác trong giới hạn rules.

**Tác động:** Một điểm hỏng duy nhất — nếu tài khoản đó bị chiếm, toàn quyền ghi DB. Thiếu App Check tăng bề mặt lạm dụng các endpoint `read: if true`.

**Khắc phục:** Dùng **custom claims** cho vai trò thay vì hardcode email; bật **App Check** (reCAPTCHA) cho Firestore + endpoint; bật xác thực nhiều lớp cho tài khoản admin Google.

---

## 6. 🟡 CSP cho phép `'unsafe-inline'` cho script

**Vị trí:** `vercel.json` → `Content-Security-Policy: ... script-src 'self' 'unsafe-inline' https://www.gstatic.com ...`.

**Mô tả:** `'unsafe-inline'` cần để chạy script nội tuyến trong `index.html`/`admin.html` (kiến trúc single-file), nhưng nó **làm yếu** khả năng chống XSS của CSP.

**Tác động:** Nếu có nội dung do người dùng/đầu vào kiểm soát chèn vào trang (kết hợp #1), inline script độc hại có thể thực thi.

**Khắc phục:** Lộ trình bỏ inline script (nonce/hash CSP) khi tách JS ra file. Trước mắt: kiểm soát chặt mọi nội dung render từ `data/*.json` (escape khi chèn HTML).

---

## 7. 🟡 Quản lý secret

**Vị trí:** Vercel env (`GITHUB_TOKEN`, `FIREBASE_API_KEY`, `ADMIN_PASSWORD_HASH`), `app-nextjs/.env.local`.

**Mô tả & trạng thái:**
- ✅ `app-nextjs/.env.local` **không** được track trong git (đã kiểm tra — bị `.gitignore`).
- ✅ Mật khẩu admin lưu dạng **SHA-256 hash**, so sánh timing-safe (`middleware.js`).
- ⚠️ `GITHUB_TOKEN` là PAT có quyền ghi repo; phạm vi rộng → nếu lộ, kẻ tấn công ghi vào repo. Nên dùng **fine-grained token** chỉ quyền Contents:write trên đúng repo, và xoay vòng định kỳ.
- ⚠️ SHA-256 trần (không salt, không bcrypt/scrypt) cho mật khẩu — chấp nhận được cho Basic auth nội bộ nhưng yếu nếu mật khẩu đơn giản. Dùng mật khẩu mạnh, dài.

**Khắc phục:** Thu hẹp scope `GITHUB_TOKEN`; đặt lịch xoay vòng; đảm bảo mật khẩu admin đủ mạnh.

---

## 8. 🟢 Firebase web config lộ trong client

**Vị trí:** `admin.html` (apiKey, authDomain, projectId, appId hardcode); app-nextjs (`NEXT_PUBLIC_*`).

**Mô tả:** Đây là **hành vi bình thường** của Firebase Web — các giá trị này công khai theo thiết kế; bảo mật dựa vào Firestore rules + Auth, không phải giấu key.

**Tác động:** Thấp. Chỉ trở thành vấn đề nếu rules lỏng (xem #3, #4) hoặc chưa bật App Check (#5).

**Khắc phục:** Không cần giấu; tập trung siết rules + App Check.

---

## 9. 🟢 Vệ sinh repo

**Vị trí:** repo root.

**Mô tả:** File dev lẫn trong repo: `*.docx` (báo cáo CTO), `test-results/`, `contact-*.png`, nhiều screenshot lớn, file xác thực (`085d644...txt`, `google16e297235f744fdc.html`). Các file xác thực domain là công khai (không phải secret) nhưng làm rối repo.

**Tác động:** Thấp về bảo mật; chủ yếu là nhiễu và rủi ro vô tình commit nội dung nhạy cảm tương lai.

**Khắc phục:** Mở rộng `.gitignore` cho artifact dev; xem `TECH_DEBT.md`. (Không xóa file production theo yêu cầu kiểm toán.)

---

## Việc cần làm ngay (theo thứ tự)
1. **#1** — Thêm kiểm tra email admin trong `api/push-*` (hoặc tắt self-signup Firebase).
2. **#2** — Chốt domain về Vercel, vô hiệu hoá pipeline Pages.
3. **#3** — Siết `registrations` `create`.
4. **#4** — Bổ sung rules thiếu (least-privilege, append-only cho audit).

## Tham chiếu
- Luồng xác thực → `ARCHITECTURE.md` mục 5
- Rules & collection → `DATABASE.md`
- Pipeline Pages vs Vercel → `DEPLOYMENT.md` mục 5
