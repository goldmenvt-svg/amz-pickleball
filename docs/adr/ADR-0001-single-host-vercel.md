# ADR-0001 — Chốt một host: Vercel (bỏ GitHub Pages)

- **Trạng thái:** Proposed
- **Ngày:** 2026-06-30
- **Người quyết định:** CTO / Lead Architect
- **Liên quan:** TD-01, `docs/design/DESIGN-deploy-consolidation.md`, `DEPLOYMENT.md`, `SECURITY.md` #2

## Bối cảnh
Repo có hai pipeline deploy cùng nhắm `amzpickleball.vn`: Vercel (`vercel.json`, `.vercel`) và GitHub Pages (`.github/workflows/deploy.yml` + `CNAME`). Site cần serverless `api/push-*`, Edge middleware Basic auth (`middleware.js`), và security headers — **chỉ Vercel chạy được**. GitHub Pages chỉ phục vụ tĩnh.

## Các phương án
1. **Chỉ Vercel** — đủ tính năng (api/middleware/headers). Phải gỡ Pages + CNAME.
2. **Chỉ GitHub Pages** — miễn phí nhưng mất Basic auth admin, mất serverless, mất headers. Loại.
3. **Cloudflare Pages** (từng cân nhắc) — CDN tốt ở VN, nhưng phải port lại serverless/middleware/headers; chi phí chuyển đổi cao, không cần thiết lúc này.

## Quyết định
Chọn **Vercel là host duy nhất**. Vô hiệu hoá pipeline GitHub Pages và gỡ `CNAME`; cấu hình domain trong Vercel. GitHub Actions chỉ giữ workflow không-deploy (`sync-youtube.yml`, `video-scan.yml`).

## Hệ quả
- Tích cực: một nguồn deploy; bảo toàn Basic auth + headers + serverless; hết mâu thuẫn domain.
- Tiêu chí: phụ thuộc Vercel (free tier giới hạn; chấp nhận được ở quy mô hiện tại).
- Kéo theo: cập nhật DNS; xoá `deploy.yml`/`CNAME` (theo gate ở design doc).
