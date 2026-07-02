# DEPLOYMENT.md — AMZ Pickleball

> Kiểm toán hạ tầng triển khai. Cập nhật: 2026-06-30.
> Nguồn: `vercel.json`, `.vercel/project.json`, `.vercelignore`, `firebase.json`, `.github/workflows/*`, `CNAME`, `middleware.js`, `api/*`.

---

## 1. Domain

| Thuộc tính | Giá trị |
|---|---|
| Domain chính | `amzpickleball.vn` |
| Khai báo trong repo | `CNAME` (chứa `amzpickleball.vn`) — đây là quy ước **GitHub Pages** |
| Tham chiếu khác | `sitemap.xml`, `robots.txt`, `Referer` header trong `api/push-*` đều trỏ `https://amzpickleball.vn/` |

⚠️ **Vấn đề:** file `CNAME` ở repo root là cơ chế GitHub Pages. Nếu domain đang phục vụ bởi **Vercel**, file này thừa và gây hiểu nhầm; nếu domain trỏ **GitHub Pages**, xem rủi ro ở mục 5 và `SECURITY.md`. Cần xác định DNS đang trỏ đâu và chốt **một** nhà cung cấp.

---

## 2. Vercel (nhà cung cấp được khuyến nghị)

| Thuộc tính | Giá trị |
|---|---|
| Project | `website-test` (`.vercel/project.json`) |
| projectId / orgId | `prj_JWd8dLjNsOFWXH2GoFtqFcghY4eM` / `team_RwtvNy7VNlkJXTCUCmQ7Uofj` |
| Kiểu deploy | Static + serverless functions (KHÔNG phải Next.js build — `app-nextjs/` không nằm trong project này) |
| Cấu hình | `vercel.json` |

**`vercel.json` cung cấp:**
- Khai báo runtime cho `api/push-videos.js`, `api/push-data.js` (`nodejs20.x`).
- **Security headers** toàn site: `X-Content-Type-Options`, `X-Frame-Options=SAMEORIGIN`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`, **CSP**, **HSTS** (`max-age=31536000; includeSubDomains`).
- **Cache:** ảnh/font `immutable` 1 năm; `data/*.json` `max-age=300, s-maxage=60`.

**`.vercelignore`** loại khỏi deploy: `node_modules/`, `scripts/`, `reports/`, `screenshots/`, `.claude/`, `CLAUDE.md`, `package*.json`, `*.mjs`, `verify.js`, các ảnh dev (`*-mobile.png`, `final-*.png`, `v2-*.png`, `screenshot*.png`, `contact-*.png`, `compare-*.png`, `godly.website_*.png`), `wp-upload/`, `hinh anh/`.

**Biến môi trường (server-side, cấu hình trên Vercel):**

| Biến | Dùng ở | Vai trò |
|---|---|---|
| `ADMIN_USER` | `middleware.js` | Tên đăng nhập Basic auth (mặc định `amzadmin`) |
| `ADMIN_PASSWORD_HASH` | `middleware.js` | SHA-256 hash mật khẩu admin (bắt buộc, thiếu → 500) |
| `FIREBASE_API_KEY` | `api/push-*` | Verify Firebase ID token qua `identitytoolkit accounts:lookup` |
| `GITHUB_TOKEN` | `api/push-*` | PAT ghi vào repo `goldmenvt-svg/amz-pickleball` |

> Chỉ Vercel chạy được cả ba: serverless `api/`, Edge `middleware.js`, và security headers.

---

## 3. Firebase

| Thuộc tính | Giá trị |
|---|---|
| Project | `amz-pickleball` |
| Dùng cho | **Chỉ Firestore** (database + rules). KHÔNG dùng Firebase Hosting. |
| `firebase.json` | Chỉ khai báo `firestore.rules` — không có khối `hosting`. |
| Deploy rules | Thủ công: `firebase deploy --only firestore:rules` |
| Auth | Firebase Auth (email/password) cho admin.html và app-nextjs |
| Client config | Hardcode trong `admin.html` (apiKey công khai — bình thường với Firebase Web); app-nextjs đọc từ `NEXT_PUBLIC_FIREBASE_*` env |

⚠️ Việc deploy rules là **thủ công, ngoài CI** → dễ quên đồng bộ giữa `firestore.rules` trong repo và rules đang chạy trên Firebase. Cân nhắc đưa vào pipeline (xem mục 7).

---

## 4. GitHub

| Thuộc tính | Giá trị |
|---|---|
| Repo | `https://github.com/goldmenvt-svg/amz-pickleball` |
| Branch chính | `master` |
| Vai trò đặc biệt | Vừa là source, vừa là **kho dữ liệu**: `api/push-*` ghi `data/*.json` ngược vào repo qua GitHub Contents API |
| Token | `GITHUB_TOKEN` (PAT) lưu ở Vercel env, quyền ghi repo |

**Cơ chế "repo làm DB":** admin sửa → push commit `chore: export ...` / `chore: update video approvals ...` → trigger redeploy. Hệ quả: lịch sử git lẫn commit dữ liệu tự động.

---

## 5. GitHub Pages (⚠️ XUNG ĐỘT — nên gỡ)

| Thuộc tính | Giá trị |
|---|---|
| Workflow | `.github/workflows/deploy.yml` — "Deploy to GitHub Pages" |
| Trigger | `push` vào `master` |
| Hành vi | Upload **toàn bộ repo** làm artifact → `actions/deploy-pages` |
| Domain | Dùng `CNAME` = `amzpickleball.vn` |

**Vì sao là vấn đề:**
- GitHub Pages chỉ phục vụ **tĩnh** → **KHÔNG** chạy được `api/push-*` (serverless), `middleware.js` (Basic auth), hay security headers trong `vercel.json`.
- Nếu DNS `amzpickleball.vn` trỏ về GitHub Pages: `admin.html` **mất lớp Basic auth** (panel quản trị lộ ra public) và nút push dữ liệu hỏng. Đây là rủi ro bảo mật nghiêm trọng (xem `SECURITY.md` #2).
- Hai pipeline (Vercel + Pages) cùng deploy trên mỗi push `master` vào cùng một domain → không thể đồng thời đúng.

**Khuyến nghị:** chốt **Vercel**, vô hiệu hoá pipeline Pages (`deploy.yml`) và file `CNAME` (cấu hình domain trong Vercel). *Lưu ý: theo yêu cầu kiểm toán, tài liệu này không tự xóa file — đây là khuyến nghị để bạn quyết định.*

### Workflow GitHub Actions khác (không phải deploy)

| Workflow | Lịch | Vai trò |
|---|---|---|
| `sync-youtube.yml` | 08:00 giờ VN mỗi ngày (01:00 UTC) | Cập nhật `data/videos.json` từ YouTube |
| `video-scan.yml` | (cron) | Quét/kiểm video |

---

## 6. Serverless Functions

| Function | Method | Auth | Tác dụng |
|---|---|---|---|
| `api/push-data.js` | POST | Bearer Firebase ID token | Ghi `data/events.json` + `data/players.json` lên GitHub |
| `api/push-videos.js` | POST | Bearer Firebase ID token | Ghi `data/videos.json` lên GitHub |

**Đặc điểm kỹ thuật:**
- Runtime `nodejs20.x`, viết theo CommonJS (`module.exports`) cho tương thích Vercel.
- Verify token bằng REST `identitytoolkit accounts:lookup` (không dùng Firebase Admin SDK, dù `.env.local.example` có khai báo `FIREBASE_ADMIN_SERVICE_ACCOUNT_KEY` — chưa dùng).
- ⚠️ **Chỉ kiểm token hợp lệ, KHÔNG kiểm email admin** → broken access control (xem `SECURITY.md` #1).
- Đọc SHA file hiện tại rồi PUT → cập nhật idempotent.

---

## 7. Luồng CI/CD

### Hiện trạng
```
Developer ──git push master──┐
                             ├─▶ Vercel (auto)        → build static + api/ → amzpickleball.vn
                             └─▶ GitHub Actions deploy.yml → GitHub Pages   → CÙNG domain   ⚠️ xung đột
Admin ──admin.html push──────▶ GitHub Contents API → commit data/*.json → (lại trigger Vercel + Pages)
Cron ──sync-youtube.yml──────▶ commit data/videos.json
Firestore rules ─────────────▶ `firebase deploy --only firestore:rules`  (THỦ CÔNG, ngoài CI)
app-nextjs ──────────────────▶ KHÔNG có pipeline (chỉ `next dev` local)
```

### Vấn đề CI/CD
1. **Hai deploy target trên một domain** (Vercel + Pages) — phải bỏ một.
2. **Rules deploy thủ công** — không có gate, dễ lệch repo ↔ prod.
3. **`app-nextjs` không có pipeline** — không build/test/deploy tự động.
4. **Không có bước test/lint trong CI** — `package.json` root: `test` = `exit 1`; app-nextjs có `lint` nhưng không chạy ở CI.
5. **Vòng lặp deploy do dữ liệu:** mỗi lần admin/cron push `data/*.json` lại trigger cả hai pipeline.

### Định hướng (không bắt buộc làm ngay)
- Giữ **một** pipeline Vercel; xoá pipeline Pages + `CNAME`.
- Nếu quyết định deploy `app-nextjs`: tạo Vercel project riêng (subdomain `app.`), thêm `build`+`lint` vào CI.
- Cân nhắc thêm bước `firebase deploy --only firestore:rules` vào một workflow có kiểm soát (manual approval) để rules luôn đồng bộ.

---

## 8. Tham chiếu
- Bức tranh kiến trúc & luồng → `ARCHITECTURE.md`
- Rủi ro bảo mật (auth bypass, headers) → `SECURITY.md`
- Nợ kỹ thuật CI/CD → `TECH_DEBT.md`
