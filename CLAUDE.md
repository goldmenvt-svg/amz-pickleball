# AMZ Pickleball — Project Guide

---

## 🗂 Trạng Thái Dự Án (cập nhật lần cuối: 2026-06-30)

> Dự án đã vượt xa "Phase 1 static" ban đầu. Hiện có **HAI ứng dụng** + Firebase + 2 pipeline deploy. Đọc kỹ phần Kiến Trúc bên dưới.

### 🏗 Kiến Trúc Tổng Thể (thực tế)

**1. Site tĩnh (PRODUCTION — đang chạy trên `amzpickleball.vn`)**
- `index.html` — trang chủ: bảng xếp hạng, sự kiện, trận đấu, tin tức, sân, training, bảng giá, FAQ, liên hệ. Đọc dữ liệu từ `data/*.json` (read-only, không Firebase).
- `admin.html` — panel quản trị, dùng **Firestore** để sửa events/players/tournaments/matches/groups/registrations, rồi gọi `/api/push-data` + `/api/push-videos` để **ghi JSON ngược lên GitHub repo** → Vercel redeploy → site tĩnh cập nhật. Bảo vệ bằng Basic auth (`middleware.js`).
- `blog/` — 6 bài HTML + index, đọc `data/blog-posts.json`.
- `api/push-data.js`, `api/push-videos.js` — Vercel serverless functions.

**2. App Next.js (`app-nextjs/` — WIP, CHƯA deploy)**
- Next 15 + React 19 + Firebase + Tailwind, chạy local port 3001. "Tournament OS" (Sprint 3).
- Trang: đặt sân (`/dat-san` — booking + VietQR), giải đấu (`/giai-dau` + đăng ký/lịch/kết quả), bảng xếp hạng, hội viên.
- Đọc/ghi **Firestore trực tiếp** (live, không qua JSON snapshot). Collections: courts, bookings, players, tournaments, events, matches, registrations, groups.
- Không có `.vercel`, không nằm trong pipeline nào → hiện chỉ dev cục bộ.

**Điểm căng cần quyết:** site tĩnh và app Next.js **trùng** bảng xếp hạng + giải đấu, nhưng dùng **hai cách lưu data khác nhau** (JSON snapshot vs Firestore live) trên **cùng một Firestore**. Cần chốt một nguồn dữ liệu duy nhất cho mỗi loại nội dung.

### ⚠️ Xung Đột Deploy (ƯU TIÊN XỬ LÝ)

Repo có **2 pipeline deploy chĩa vào cùng domain** — không thể cùng tồn tại:

| Pipeline | File | Hỗ trợ |
|---|---|---|
| **Vercel** | `.vercel/`, `vercel.json` | ✅ serverless `api/`, ✅ Basic auth `middleware.js`, ✅ security headers |
| **GitHub Pages** | `.github/workflows/deploy.yml`, `CNAME` | ❌ KHÔNG chạy được api/, middleware, headers |

→ Nếu domain trỏ về **GitHub Pages**, `admin.html` **mất Basic auth** (lộ panel) và `/api/push-*` không hoạt động. **Khuyến nghị: chỉ giữ Vercel**, xóa `deploy.yml` + `CNAME` (cấu hình domain trong Vercel). Firebase chỉ dùng cho Firestore (rules deploy qua `firebase deploy --only firestore:rules`), KHÔNG dùng hosting.

### 🔄 Còn thiếu / chưa làm

| Hạng mục | Ưu tiên | Ghi chú |
|---|---|---|
| Chốt 1 pipeline deploy (bỏ GitHub Pages) | 🔴 Cao | Xung đột domain + lỗ hổng auth admin |
| Hợp nhất nguồn data (JSON snapshot vs Firestore) | 🔴 Cao | Tránh lệch dữ liệu giữa 2 app |
| Quyết định số phận `app-nextjs` (deploy / gộp / bỏ) | 🔴 Cao | Hiện là WIP không deploy |
| Email liên hệ chính thức | 🟡 Trung | CLAUDE.md vẫn ghi [CHƯA CÓ] |
| Thông tin social còn thiếu (Instagram, Zalo, TikTok) | 🟡 Trung | Placeholder trong footer |
| Dọn file dev khỏi repo | 🟢 Thấp | `*.docx`, `test-results/`, `contact-*.png` |

### 🏛 Quyết Định Quan Trọng & Lý Do

| Quyết định | Lý do |
|---|---|
| **Deploy: Vercel** (không phải Cloudflare/GitHub Pages) | Cần serverless `api/` + Basic auth middleware + security headers — chỉ Vercel chạy đủ |
| **Firestore làm DB sống**, JSON là snapshot công khai | Admin sửa trên Firestore → push JSON → site tĩnh đọc JSON nhanh, SEO tốt |
| **app-nextjs = "Tournament OS"** cho phần động (đặt sân, giải đấu) | Site tĩnh giữ marketing/nội dung; phần tương tác cần app riêng |
| **Background `#000000`**, accent `#c8f03a` dùng cực ít | Bám inspiration monochromatic; accent càng ít càng có lực |
| **Contact form Formspree** (`/f/xeebjkrz`) tích hợp trong index.html | Tăng conversion, giữ user trên trang chủ — đã kích hoạt thật |

---

## Project Overview

Website giới thiệu dịch vụ Pickleball cho thương hiệu **AMZ Pickleball**. Mục tiêu là xây dựng một trang web hiện đại, tối giản, chuyên nghiệp — truyền tải năng lượng của môn thể thao Pickleball đồng thời duy trì tính sang trọng và uy tín của thương hiệu.

## Company Information

> Cập nhật các thông tin dưới đây trước khi bắt đầu code. Dùng thông tin này cho footer, trang Contact, SEO meta tags, và structured data (LocalBusiness schema).

| Thông tin | Giá trị |
|---|---|
| **Tên thương hiệu** | AMZ Pickleball |
| **Tên đầy đủ** | AMZ Pickle Ball Club |
| **Facebook** | https://www.facebook.com/p/AMZ-Pickle-Ball-Club-61574575574795/ |
| **Địa chỉ sân** | 179 Thống Nhất, Phường Vũng Tàu, TP.HCM |
| **Quận / Thành phố** | TP. Hồ Chí Minh |
| **Số điện thoại** | 0914 859 927 |
| **Email liên hệ** | [CHƯA CÓ — cần bổ sung] |
| **Giờ hoạt động** | T2–T6: 05:00–22:00 / T7–CN: 05:00–23:00 |
| **Số sân** | 8 sân |
| **Loại sân** | [CHƯA XÁC NHẬN — Indoor / Outdoor / Cả hai] |

### Mô tả ngắn (dùng cho meta description & About section)

> [Điền mô tả 1–2 câu về AMZ Pickleball — lịch sử thành lập, sứ mệnh, điểm khác biệt so với các CLB khác]

### Điểm mạnh / USP (Unique Selling Points)

> Điền các điểm nổi bật để làm nội dung hero/about:
- [ ] [USP 1 — VD: Sân tiêu chuẩn quốc tế, mặt sân Pro Series]
- [ ] [USP 2 — VD: Huấn luyện viên có chứng chỉ quốc tế]
- [ ] [USP 3 — VD: Cộng đồng thân thiện, phù hợp mọi trình độ]
- [ ] [USP 4 — VD: Vị trí trung tâm, dễ di chuyển]

### Mạng xã hội

| Kênh | Link |
|---|---|
| Facebook | https://www.facebook.com/p/AMZ-Pickle-Ball-Club-61574575574795/ |
| Instagram | [CHƯA CÓ] |
| Zalo | [CHƯA CÓ] |
| TikTok | [CHƯA CÓ] |
| YouTube | [CHƯA CÓ] |

---

## Design Philosophy

**Reference**: `godly.website_website_ohzi-interactive-555.png`

### Core Principles
- **Tối giản (Minimalism)**: Không gian âm nhiều, bố cục thưa thoáng, loại bỏ mọi thứ không cần thiết
- **Dark-first**: Nền tối chủ đạo (near-black `#0a0a0a` hoặc `#0d0d0d`), text sáng tương phản cao
- **Typography-led**: Chữ là nhân vật chính — font lớn, bold, có tính cách
- **Motion intentional**: Animation mượt mà, có chủ đích — không rối mắt
- **Professional energy**: Cảm giác thể thao nhưng không kém phần cao cấp

### Color Palette (đang dùng trong index.html)
```
--bg:       #000000   pure black background
--surface:  #0d0d0d   subtle surface
--surface2: #141414   hover states
--border:   rgba(255,255,255,0.06)  thin dividers
--text:     #f0f0f0   primary text
--muted:    #606060   secondary text
--muted2:   #383838   disabled / decorative
--accent:   #c8f03a   neon yellow-green — CHỈ dùng cho:
                       1. Hero <em>PICKLEBALL</em> italic
                       2. Primary CTA button background
                       3. Nav logo dot
                       4. Hero badge dot
```
> ⚠️ Accent discipline: Không dùng ở bất kỳ nơi nào khác. Càng ít càng có lực.

### Typography
- **Display / Headings**: Font sans-serif mạnh mẽ — Inter, Geist, hoặc Space Grotesk (weight 700–900)
- **Body**: Inter hoặc system-ui, weight 400–500, size 16–18px
- **Uppercase labels**: Letter-spacing rộng cho category labels / nav items
- **Scale**: Fluid type scale — heading có thể lên đến 80–120px trên desktop

### Motion & Interaction
- Scroll-triggered fade/slide animations (framer-motion hoặc GSAP)
- Smooth page transitions
- Hover states tinh tế — không flash, không jump
- Parallax nhẹ cho hero section

## Tech Stack

### Recommended
- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS v4
- **Animation**: Framer Motion hoặc GSAP
- **Language**: TypeScript
- **Font**: next/font với Google Fonts (Inter + một display font)
- **Icons**: Lucide React hoặc Phosphor Icons
- **Deployment**: Vercel

### Alternative (simpler)
- Vite + React + Tailwind CSS (nếu không cần SSR/SEO phức tạp)

## Site Structure

```
/                    → Hero + Services overview + CTA
/about               → Về AMZ Pickleball, đội ngũ, sứ mệnh
/services            → Danh sách dịch vụ chi tiết
/courts              → Sân chơi, tiện ích, đặt sân
/training            → Chương trình tập luyện, huấn luyện viên
/events              → Giải đấu, sự kiện cộng đồng
/contact             → Liên hệ, vị trí, form đăng ký
```

## Page Sections (Homepage)

1. **Hero** — Full-viewport, headline lớn, sub-text, CTA button, background video hoặc ảnh chất lượng cao
2. **Services Strip** — Horizontal scroll hoặc grid 3 cột: Sân chơi / Tập luyện / Giải đấu
3. **About Teaser** — 2 cột: text trái, ảnh hành động phải
4. **Stats** — Số liệu nổi bật (số sân, HLV, thành viên, giải đấu)
5. **Featured Services** — Cards chi tiết từng dịch vụ
6. **Testimonials** — Đánh giá từ thành viên
7. **Events** — Sự kiện sắp tới
8. **CTA Banner** — Kêu gọi đăng ký / đặt sân
9. **Footer** — Links, mạng xã hội, thông tin liên hệ

## Content Guidelines

### Tone of Voice
- Tự tin, năng động nhưng không quá to tiếng
- Chuyên nghiệp — như một thương hiệu thể thao cao cấp
- Ngắn gọn — headline tối đa 6–8 từ, sub-text tối đa 2–3 câu
- Ưu tiên tiếng Việt, có thể song ngữ Việt-Anh nếu cần

### Imagery
- Ảnh chất lượng cao: người chơi Pickleball, sân chơi, giải đấu
- Tone ảnh: dark/moody hoặc high-contrast, tránh ảnh stock cliché
- Video background trong hero nếu có thể

## Component Conventions

- Mỗi section là một React component riêng trong `components/sections/`
- UI primitives (Button, Card, Badge) trong `components/ui/`
- Layout components trong `components/layout/`
- Không dùng inline styles — chỉ Tailwind utility classes
- Responsive: mobile-first, breakpoints `sm / md / lg / xl`

## Mandatory Rules (Quy tắc bắt buộc)

> Các quy tắc này KHÔNG được bỏ qua trong bất kỳ tình huống nào.

### 1. Screenshot & Design Review sau mỗi thay đổi lớn
- Sau mỗi thay đổi lớn (section mới, layout thay đổi, style update), **bắt buộc chụp screenshot** và so sánh với design gốc (`godly.website_website_ohzi-interactive-555.png`)
- Kiểm tra: spacing, typography, màu sắc, tỷ lệ — phải khớp với phong cách tham khảo
- Nếu lệch, sửa ngay trước khi tiếp tục task tiếp theo
- Dùng lệnh: `/verify` sau mỗi thay đổi lớn để xác nhận UI trên trình duyệt

### 2. Mobile-First & Responsive bắt buộc
- **Viết CSS mobile-first** — mọi component bắt đầu từ màn hình nhỏ nhất
- Test trên các breakpoint: `375px` (iPhone SE), `768px` (tablet), `1280px` (desktop), `1920px` (large)
- Navigation phải có hamburger menu trên mobile
- Font size tối thiểu `16px` trên mobile, không zoom-block (`user-scalable=no` bị cấm)
- Touch targets tối thiểu `44×44px`
- Không dùng `hover`-only interaction cho tính năng quan trọng

### 3. Scroll Animation bắt buộc cho mọi Section
- **Mọi section phải có animation khi scroll vào viewport** — không có section nào static
- Animation mặc định: `fade-up` (opacity 0→1, translateY 24px→0, duration 0.6s, ease-out)
- Dùng `IntersectionObserver` hoặc Framer Motion `whileInView` / GSAP ScrollTrigger
- Stagger animation cho các item trong list/grid: delay `0.1s` giữa các phần tử
- `prefers-reduced-motion`: wrap tất cả animation trong media query — người dùng tắt animation phải được tôn trọng
- Animation chỉ chạy **một lần** khi element vào viewport (không lặp lại khi scroll ngược)

```tsx
// Pattern chuẩn cho mọi section
const sectionVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } }
}
// <motion.section variants={sectionVariants} initial="hidden" whileInView="visible" viewport={{ once: true }} />
```

---

## Development Rules

- **No comments** trừ khi logic không hiển nhiên
- Không thêm tính năng ngoài scope đã yêu cầu
- Validate HTML semantics — dùng đúng tag (`section`, `article`, `nav`, `main`)
- Tối ưu Core Web Vitals: lazy-load ảnh, font display swap, minimize JS
- Accessibility: đảm bảo contrast ratio WCAG AA, keyboard navigation

## Services to Showcase

1. **Cho thuê sân Pickleball** — Sân tiêu chuẩn, indoor/outdoor
2. **Chương trình tập luyện** — Cho người mới bắt đầu đến nâng cao
3. **Huấn luyện cá nhân (1-on-1)** — HLV chuyên nghiệp
4. **Tổ chức giải đấu** — Nội bộ và liên câu lạc bộ
5. **Thành viên CLB** — Gói membership với ưu đãi
6. **Thuê thiết bị** — Vợt, bóng, phụ kiện

## Key CTAs

- "Đặt sân ngay" (Book a court)
- "Đăng ký tập luyện" (Register for training)
- "Xem lịch sự kiện" (View events)
- "Liên hệ chúng tôi" (Contact us)

## File Structure (thực tế — 2026-06-30)

```
d:\website test\
├── CLAUDE.md                        ← project guide (file này)
│
│   ── SITE TĨNH (production / Vercel) ──
├── index.html                       ← trang chủ (HTML + CSS + JS, đọc data/*.json)
├── admin.html                       ← panel quản trị (Firestore, sau Basic auth)
├── 404.html
├── blog/
│   ├── index.html
│   └── posts/                       ← 6 bài blog HTML
├── data/                            ← snapshot công khai site tĩnh đọc
│   ├── events.json · players.json · videos.json · blog-posts.json
├── content/                         ← 5 bài blog nguồn (.md)
├── api/
│   ├── push-data.js                 ← Vercel fn: ghi JSON ngược lên GitHub
│   └── push-videos.js
├── middleware.js                    ← Basic auth cho /admin.html (Vercel Edge)
├── vercel.json                      ← functions + security headers + cache
├── firebase.json · firestore.rules  ← chỉ deploy Firestore rules
├── manifest.json · sw.js · favicon.svg · robots.txt · sitemap.xml
├── logo.jpg · logo.webp · images/
│
│   ── XUNG ĐỘT DEPLOY (xem phần Kiến Trúc) ──
├── CNAME                            ← ⚠️ GitHub Pages (amzpickleball.vn)
├── .github/workflows/
│   ├── deploy.yml                   ← ⚠️ deploy GitHub Pages (xung đột Vercel)
│   ├── sync-youtube.yml             ← cron cập nhật videos.json
│   └── video-scan.yml
├── .vercel/                         ← Vercel project "website-test"
│
│   ── APP NEXT.JS (WIP, chưa deploy) ──
├── app-nextjs/                      ← Next 15 "Tournament OS", port 3001
│   └── src/{app,components,lib,types}   ← Firestore trực tiếp
│
│   ── CẤU HÌNH / NỘI DUNG ──
├── .claude/
│   ├── settings.json                ← Gmail MCP config
│   ├── agents/                      ← researcher, tao-noi-dung, cto-advisor, ...
│   └── rules/                       ← design-system, company-info, dev-conventions, ...
├── firestore-schema.md · huong-dan-airtable.md · huong-dan-youtube.md
└── godly.website_website_ohzi-interactive-555.png  ← design inspiration

  (dev artifacts — nên gitignore: *.docx, test-results/, *-mobile.png, screenshot*.png)
```

## Notes

- Giữ bundle size nhỏ — tránh dependency nặng không cần thiết
- Ưu tiên performance trên mobile (phần lớn user Việt Nam dùng điện thoại)
- SEO: meta tags đầy đủ, structured data cho local business
- Cân nhắc thêm Google Maps embed cho vị trí sân
