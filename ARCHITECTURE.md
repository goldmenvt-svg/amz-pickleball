# ARCHITECTURE.md — AMZ Pickleball

> Tài liệu kiểm toán kiến trúc. Cập nhật: 2026-06-30. Vai trò: CTO / Software Architect.
> Phạm vi: mô tả hiện trạng, KHÔNG đề xuất viết tính năng mới hay refactor lớn.

---

## 1. Kiến trúc hiện tại (as-is)

Dự án hiện gồm **hai ứng dụng độc lập** chạy trên **cùng một dự án Firebase** (`amz-pickleball`):

### A. Site tĩnh — PRODUCTION (đang chạy `amzpickleball.vn`)

| Thành phần | Vai trò |
|---|---|
| `index.html` | Trang chủ public. Đọc dữ liệu từ `data/*.json` (read-only, KHÔNG kết nối Firebase). |
| `blog/` | 6 bài blog HTML + index, đọc `data/blog-posts.json`. |
| `admin.html` | Panel quản trị. Kết nối **Firestore** (email/password login) để sửa events/players/tournaments/matches/groups/registrations. Sau khi sửa, gọi `/api/push-data` và `/api/push-videos`. |
| `api/push-data.js`, `api/push-videos.js` | Vercel serverless. Nhận JSON từ admin, ghi đè `data/*.json` **ngược lên GitHub repo** `goldmenvt-svg/amz-pickleball` qua GitHub Contents API → kích hoạt Vercel redeploy. |
| `middleware.js` | Vercel Edge middleware. Basic auth bảo vệ `/admin.html` và `/admin`. |
| `data/*.json` | "Snapshot công khai": `events.json`, `players.json`, `videos.json`, `blog-posts.json`. |

**Đặc điểm:** Firestore là DB chỉnh sửa (qua admin); JSON là bản chụp tĩnh mà site công khai đọc. Hai bước, có độ trễ (phải redeploy).

### B. App Next.js — WIP, CHƯA deploy (`app-nextjs/`)

| Thuộc tính | Giá trị |
|---|---|
| Stack | Next 15 (App Router) + React 19 + Firebase Web SDK + Tailwind 3 |
| Cổng dev | 3001 |
| Trang | `/dat-san` (đặt sân + VietQR), `/giai-dau` + `[id]/{dang-ky,lich,ket-qua}`, `/bang-xep-hang`, `/hoi-vien` |
| Dữ liệu | Đọc/ghi **Firestore trực tiếp** (live). Không qua JSON snapshot. |
| Trạng thái deploy | Không có `.vercel`, không nằm trong pipeline nào → chỉ chạy local. |

**Trang chủ Next.js (`/`) redirect sang `/dat-san`** — app này định hướng quanh đặt sân/giải đấu (gọi là "Tournament OS", Sprint 3).

### Sơ đồ hiện trạng

```
                         ┌──────────────────────────┐
   Public  ───── GET ───▶│  index.html / blog/      │──── fetch ──▶ data/*.json (tĩnh)
                         └──────────────────────────┘
                                    ▲
                                    │ redeploy khi data/*.json đổi
                                    │
   Admin  ── Basic auth ──▶ admin.html ── Firestore RW ──▶ ┌─────────────┐
                                 │                          │  Firestore  │
                                 └── POST /api/push-* ──┐   │ (amz-       │
                                                        │   │  pickleball)│
                                          GitHub Contents API             │
                                                        │   └─────────────┘
                                                        ▼          ▲
                                                  repo data/*.json │ RW trực tiếp
                                                                   │
   Public  ───── (local 3001) ─────▶ app-nextjs ──────────────────┘
                 dat-san / giai-dau / bang-xep-hang / hoi-vien
```

### Điểm căng kiến trúc

1. **Hai nguồn sự thật cho cùng nội dung.** Bảng xếp hạng (`players`) và giải đấu/sự kiện (`events`/`tournaments`) tồn tại **cả** trong JSON snapshot (site tĩnh đọc) **lẫn** Firestore live (app Next.js đọc/ghi). Shape dữ liệu đã lệch nhau (xem `DATABASE.md`).
2. **Hai pipeline deploy chĩa vào một domain.** Vercel và GitHub Pages (xem `DEPLOYMENT.md`).
3. **App Next.js không deploy** → công sức Sprint 3 chưa tạo giá trị production và đang phình `node_modules`.

---

## 2. Kiến trúc mục tiêu (to-be)

> Nguyên tắc: giữ site tĩnh nhanh/SEO cho phần marketing, đưa phần động (đặt sân, giải đấu, hội viên) về một app duy nhất trên một nguồn dữ liệu duy nhất. Không yêu cầu viết tính năng mới — đây là định hướng hợp nhất.

### Phân vai rõ ràng

| Lớp | Trách nhiệm | Nguồn dữ liệu |
|---|---|---|
| **Marketing/nội dung** (site tĩnh `index.html`, `blog/`) | Hero, dịch vụ, bảng giá, FAQ, tin tức, blog | `data/*.json` (snapshot, ít đổi) |
| **Ứng dụng động** (chọn 1: `admin.html` hoặc `app-nextjs`) | Đặt sân, giải đấu, bảng xếp hạng, hội viên | **Firestore live (1 nguồn)** |
| **Database** | Firestore | — |
| **Hosting** | **Vercel duy nhất** | — |

### Quyết định cần chốt (mỗi cái 1 nguồn sự thật)

- **Bảng xếp hạng & giải đấu:** chọn **Firestore live** làm nguồn chính; site tĩnh đọc qua một bản chụp `data/*.json` được sinh tự động (giữ cơ chế push hiện có) HOẶC nhúng widget đọc Firestore. Không để admin và app ghi hai shape khác nhau.
- **Số phận `app-nextjs`:** quyết định *deploy* (đưa lên Vercel ở subdomain/path), *gộp* (di phần động của admin.html sang app), hay *đóng băng*. Hiện trạng "treo" là tốn kém nhất.
- **Bỏ pipeline GitHub Pages**, chỉ giữ Vercel (xem `DEPLOYMENT.md` + `SECURITY.md`).

### Sơ đồ mục tiêu (ví dụ: giữ site tĩnh + đưa app-nextjs lên cùng Vercel)

```
amzpickleball.vn         → Vercel: site tĩnh (marketing + blog + admin + api)
app.amzpickleball.vn     → Vercel: app-nextjs (đặt sân / giải đấu / hội viên)
                                 │
                         (cả hai dùng) ──▶ Firestore (1 schema chuẩn hóa)
```

---

## 3. Luồng dữ liệu (data flow)

### 3.1 Nội dung public (đọc)
```
data/*.json  ──fetch──▶  index.html / blog/   (Cache-Control 300s, xem vercel.json)
```

### 3.2 Admin chỉnh nội dung (ghi — site tĩnh)
```
admin.html ──signIn (email/pw)──▶ Firebase Auth
admin.html ──RW──▶ Firestore (events/players/tournaments/matches/groups/registrations)
admin.html ──POST {eventsJSON, playersJSON, videoData} + Bearer idToken──▶ /api/push-*
/api/push-* ──verify idToken──▶ identitytoolkit accounts:lookup
/api/push-* ──PUT (GITHUB_TOKEN)──▶ GitHub Contents API → data/*.json trong repo
GitHub push ──webhook──▶ Vercel build → site tĩnh cập nhật
```
> ⚠️ Nút thắt: cập nhật nội dung public phải qua redeploy (độ trễ phút). Và `accounts:lookup` chỉ kiểm tra token *hợp lệ*, KHÔNG kiểm tra *admin* (xem `SECURITY.md`).

### 3.3 App động (đọc/ghi — Next.js)
```
app-nextjs ──Firebase Web SDK──▶ Firestore (courts/bookings/players/tournaments/
                                  events/matches/registrations/groups)  [LIVE, 2 chiều]
```

### 3.4 Cron tự động
```
.github/workflows/sync-youtube.yml ──(8:00 VN/ngày)──▶ cập nhật data/videos.json
.github/workflows/video-scan.yml   ──▶ quét video
```

---

## 4. Luồng deploy (tóm tắt — chi tiết ở DEPLOYMENT.md)

```
git push master
   ├─▶ Vercel build          → amzpickleball.vn (static + api/ + middleware + headers)   ✅ đủ tính năng
   └─▶ GitHub Pages (deploy.yml + CNAME) → cùng domain                                   ❌ không chạy api/middleware/headers
firebase deploy --only firestore:rules → cập nhật Firestore rules (thủ công)
app-nextjs                              → KHÔNG có pipeline (local only)
```
**Khuyến nghị:** chỉ giữ một pipeline (Vercel). Hai pipeline trên cùng domain là mâu thuẫn và là lỗ hổng auth.

---

## 5. Luồng xác thực (authentication & authorization)

| Bề mặt | Cơ chế | Phân quyền |
|---|---|---|
| `/admin.html` (mạng) | **Basic auth** qua `middleware.js` (Vercel Edge). User `ADMIN_USER`, mật khẩu so sánh bằng SHA-256 hash + timing-safe. | Chặn truy cập panel ở tầng HTTP. **Chỉ chạy trên Vercel.** |
| `admin.html` (ứng dụng) | **Firebase Auth** `signInWithEmailAndPassword`. | Firestore rules cho ghi nếu `request.auth.token.email == "goldmenvt@gmail.com"`. |
| `/api/push-*` | **Firebase ID token** (Bearer) verify qua `identitytoolkit accounts:lookup`. | ⚠️ Chỉ kiểm token hợp lệ — **KHÔNG** kiểm email admin. Broken access control (xem SECURITY.md). |
| `app-nextjs` | Firebase Auth (Web SDK) — `getAuth` khởi tạo client. | Phụ thuộc Firestore rules. Nhiều collection app cần (courts/bookings/...) **chưa có rule** → mặc định bị từ chối. |
| Firestore | `firestore.rules` | `read: if true` cho players/tournaments/events/matches/groups; `write: isAdmin()`. `registrations` `create: if true` (ai cũng tạo được). |

### Điểm yếu xác thực (đầy đủ ở SECURITY.md)
1. API serverless không kiểm tra danh tính admin → bất kỳ user Firebase hợp lệ nào cũng có thể đẩy JSON lên repo.
2. Nếu domain trỏ GitHub Pages, **mất hoàn toàn** Basic auth + headers.
3. Một danh tính admin hardcode duy nhất (`goldmenvt@gmail.com`), không phân tách vai trò, chưa bật App Check.

---

## 6. Tham chiếu chéo
- Chi tiết DB & trùng lặp → `DATABASE.md`
- Domain / Vercel / Firebase / Pages / CI-CD → `DEPLOYMENT.md`
- Rủi ro bảo mật + mức độ + khắc phục → `SECURITY.md`
- Nợ kỹ thuật + ưu tiên → `TECH_DEBT.md`
- Trạng thái tổng thể → `CLAUDE.md`
