# Module Boundary — AMZ Pickleball

> Ranh giới module, trách nhiệm, và quy tắc phụ thuộc. Cập nhật: 2026-06-30.
> Mục tiêu: mỗi module có một trách nhiệm rõ, hạn chế phụ thuộc chéo, dễ thay thế.

---

## 1. Bản đồ module

```
┌─────────────────────────────────────────────────────────────┐
│ MARKETING (site tĩnh)                                         │
│  index.html · blog/ · 404.html                                │
│  Đọc: data/*.json (read-only)        SEO, hero, nội dung      │
└───────────────┬───────────────────────────────────────────────┘
                │ đọc snapshot
┌───────────────▼──────────────┐   ┌────────────────────────────┐
│ CONTENT PIPELINE             │   │ ADMIN (site tĩnh)           │
│  data/*.json (snapshot)      │◀──│  admin.html                 │
│  api/push-data, push-videos  │   │  Firestore RW + push        │
│  .github sync-youtube/scan   │   │  (sau Basic auth)           │
└───────────────┬──────────────┘   └─────────────┬──────────────┘
                │ ghi qua GitHub API               │ RW
                ▼                                  ▼
        ┌──────────────────────────────────────────────────┐
        │ DATA / FIRESTORE  (nguồn sự thật — ADR-0002)       │
        │  players, events, tournaments, matches, groups,    │
        │  registrations, courts, bookings, payments,        │
        │  members, users, elo_history, settings, videos     │
        └───────────────▲──────────────────────────────────┘
                        │ RW trực tiếp (live)
        ┌───────────────┴──────────────┐
        │ APP (app-nextjs) — Tournament OS                    │
        │  dat-san · giai-dau · bang-xep-hang · hoi-vien      │
        │  components/{booking,ui,layout} · lib/{firebase,    │
        │  firestore,utils} · types                           │
        └─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ PLATFORM / INFRA                                              │
│  Vercel (hosting+serverless+edge) · Firebase Auth/Firestore  │
│  GitHub (source + content store) · DNS                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Module & trách nhiệm

| Module | Trách nhiệm | KHÔNG nên làm |
|---|---|---|
| **Marketing** (`index.html`, `blog/`) | Trình bày nội dung public, SEO, đọc snapshot JSON | Không ghi DB, không chứa logic đặt sân/thanh toán |
| **Admin** (`admin.html`) | Quản trị nội dung qua Firestore, kích hoạt push snapshot | Không phục vụ người dùng cuối; phải sau Basic auth |
| **Content Pipeline** (`api/push-*`, `data/*.json`, workflows YouTube) | Sinh snapshot công khai từ Firestore; cập nhật video | Không là nguồn sự thật; không chứa business logic giải đấu |
| **App** (`app-nextjs`) | Phần động: đặt sân, giải đấu, hội viên, bảng xếp hạng live | Không trùng vai trò marketing; không tự định nghĩa schema lệch |
| **Data/Firestore** | Lưu trữ nguồn sự thật + rules phân quyền | — |
| **Platform/Infra** | Hosting, auth, DNS, CI/CD | — |

---

## 3. Quy tắc phụ thuộc (dependency rules)
1. **Marketing → chỉ đọc** `data/*.json`. Không phụ thuộc Firestore trực tiếp.
2. **Snapshot một chiều:** Firestore → `api/push-*` → `data/*.json`. Không có chiều ngược.
3. **App ↔ Firestore:** chỉ App và Admin được ghi Firestore; ghi phải qua rules (least-privilege).
4. **Không vòng lặp:** module cấp cao (UI) phụ thuộc cấp thấp (data/infra), không ngược lại.
5. **Một nguồn sự thật mỗi loại dữ liệu** (ADR-0002) — module không tự tạo bản sao ghi song song.
6. **Ranh giới `events` vs `tournaments`** phải rõ; không để hai module hiểu khác nhau.

---

## 4. Nội bộ app-nextjs (lớp)
```
app/<route>/page.tsx        →  components/<feature>   →  lib/firestore.ts  →  lib/firebase.ts
(routing)                       (UI + state)              (truy vấn DB)        (init SDK)
                                components/ui (Button/Card/Input/Badge) — primitive, không gọi DB
                                lib/utils.ts — thuần, không side-effect
                                types/index.ts — hợp đồng kiểu dùng chung
```
Quy tắc: `components/ui` **không** gọi Firestore; mọi truy cập DB đi qua `lib/firestore.ts`.

---

## 5. Tham chiếu
- Kiến trúc tổng → `ARCHITECTURE.md`
- API giữa các module → `API_DESIGN.md`
- Dữ liệu → `ERD.md`, `DATABASE.md`
