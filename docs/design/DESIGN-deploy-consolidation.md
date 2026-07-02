# Design Doc — Hợp nhất Deploy về một host (Vercel)

> Liên quan: TD-01 (P0). Trạng thái: **APPROVED (kèm 3 điều chỉnh)** — đã triển khai phần repo 2026-06-30. Tác giả: CTO/Architect.
> ADR: `docs/adr/ADR-0001-single-host-vercel.md`. Runbook: `docs/runbooks/TD-01-deploy-consolidation-runbook.md`.
> **Gate:** đã duyệt.
>
> ### Điều chỉnh bắt buộc khi duyệt (override nội dung gốc bên dưới)
> 1. **Rollback KHÔNG mặc định trỏ lại GitHub Pages** (Pages không chạy middleware/API/headers). Nếu buộc rollback về Pages → **khoá/ẩn `admin.html` TRƯỚC**. (Xem mục 3 đã sửa.)
> 2. **Không xoá `deploy.yml`.** Vô hiệu hoá an toàn: đổi trigger sang `workflow_dispatch` (đã làm) hoặc đổi tên `.disabled`.
> 3. **`amzpickleball.vn` là domain chính**; `www.amzpickleball.vn` **301** về apex (đã thêm vào `vercel.json`).

---

## 1. Tài liệu thiết kế

### Vấn đề
Repo có hai pipeline deploy cùng nhắm `amzpickleball.vn`:
- **Vercel** (`vercel.json`, `.vercel`) — chạy đủ `api/`, `middleware.js` (Basic auth), security headers.
- **GitHub Pages** (`.github/workflows/deploy.yml` + `CNAME`) — chỉ tĩnh, KHÔNG chạy được api/middleware/headers.

Nếu DNS trỏ Pages: `admin.html` mất Basic auth, mất CSP/HSTS. Hai pipeline cùng chạy trên mỗi push `master` là mâu thuẫn.

### Giải pháp
Chốt **Vercel là host duy nhất**. Vô hiệu hoá pipeline Pages và gỡ `CNAME` (cấu hình domain trực tiếp trong Vercel dashboard). GitHub Actions giữ lại **chỉ** các workflow không-deploy: `sync-youtube.yml`, `video-scan.yml`.

### Thay đổi cụ thể (ĐÃ thực hiện phần repo)
1. ✅ `.github/workflows/deploy.yml`: đổi trigger `push` → `workflow_dispatch` (vô hiệu hoá auto-deploy, KHÔNG xoá — điều chỉnh #2).
2. ✅ `vercel.json`: thêm khối `redirects` → `www.amzpickleball.vn/*` **301** → `https://amzpickleball.vn/*` (điều chỉnh #3).
3. ⏳ `CNAME`: **giữ nguyên** (vô hại trên Vercel); chỉ xoá **thủ công sau** khi xác nhận DNS đã trỏ Vercel ổn định.
4. ⏳ (Thủ công) Thêm domain `amzpickleball.vn` (Primary) + `www` trong Vercel → Settings → Domains; cập nhật DNS; gỡ custom domain trong GitHub Pages settings.

### Không nằm trong phạm vi
- Không đổi nội dung site, không refactor `index.html`/`admin.html`.

---

## 2. Kế hoạch migration

| Bước | Hành động | Người | Ghi chú |
|---|---|---|---|
| M1 | Chụp DNS hiện tại (A/CNAME records) | DevOps | Để rollback |
| M2 | Ghi lại cấu hình Vercel domain hiện có | DevOps | Screenshot |
| M3 | Thêm domain vào Vercel, lấy record đích | DevOps | Chưa đổi DNS |
| M4 | Cập nhật DNS trỏ Vercel | DevOps | TTL thấp trước 24h |
| M5 | Chờ propagate, verify HTTPS + Basic auth `/admin.html` | DevOps | |
| M6 | Vô hiệu hoá `deploy.yml` (đổi tên `.disabled` hoặc xoá) | Dev | Sau khi M5 xanh |
| M7 | Gỡ `CNAME` khỏi repo | Dev | |

> Thực hiện trong khung giờ thấp điểm (đêm VN). Hạ TTL DNS xuống 300s trước 1 ngày.

---

## 3. Kế hoạch rollback (sửa theo điều chỉnh #1)

> **Mặc định rollback nằm TRONG Vercel + DNS, KHÔNG quay về GitHub Pages.** Pages không có Basic auth/headers nên không phải đích rollback an toàn.

| Tình huống | Hành động hoàn tác |
|---|---|
| Site lỗi sau đổi DNS | Vercel → Deployments → **Promote** deployment trước đó; giữ DNS ở Vercel. KHÔNG trỏ Pages. |
| Basic auth không hoạt động trên Vercel | Kiểm `ADMIN_USER`/`ADMIN_PASSWORD_HASH` env trên Vercel |
| Hoàn tác thay đổi repo | `git revert <sha>` → khôi phục `on: push` cho deploy.yml + bỏ redirect (Pages KHÔNG tự bật lại vì DNS/Pages-settings vẫn ở Vercel) |
| **Bắt buộc** phải về GitHub Pages (phương án cuối) | **BƯỚC 1: khoá/ẩn `admin.html`** (gỡ/đổi tên khỏi nội dung Pages hoặc chặn ở tầng host) vì Pages không có Basic auth. **BƯỚC 2:** mới trỏ DNS về Pages. |

**Mức rollback: ✅ Dễ** (trong Vercel). RTO mục tiêu < 30 phút.

---

## 4. Tiêu chí nghiệm thu (Acceptance Criteria)

- [ ] `https://amzpickleball.vn` phục vụ bởi Vercel (kiểm header `x-vercel-id`).
- [ ] `https://www.amzpickleball.vn` trả **301** về `https://amzpickleball.vn/` (điều chỉnh #3).
- [ ] `GET /admin.html` trả **401** khi không có Basic auth; **200** khi đúng credential.
- [ ] Các security headers (CSP, HSTS, X-Frame-Options) hiện diện trên mọi response (kiểm `curl -I`).
- [ ] `POST /api/push-data` và `/api/push-videos` phản hồi đúng (không 404).
- [ ] Chỉ còn **một** deployment chạy khi push `master` (Pages không còn build).
- [ ] DNS không còn record trỏ GitHub Pages.
- [ ] Cron `sync-youtube.yml` vẫn chạy bình thường.
