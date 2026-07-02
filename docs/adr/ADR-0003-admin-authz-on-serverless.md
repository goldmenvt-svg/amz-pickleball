# ADR-0003 — Bắt buộc kiểm quyền admin ở serverless `api/push-*`

- **Trạng thái:** Proposed
- **Ngày:** 2026-06-30
- **Người quyết định:** CTO / Lead Architect
- **Liên quan:** TD-02, TD-15, `docs/design/DESIGN-admin-auth.md`, `SECURITY.md` #1

## Bối cảnh
`api/push-data.js`/`push-videos.js` chỉ verify token Firebase *hợp lệ* (`accounts:lookup` → `verifyRes.ok`), KHÔNG kiểm danh tính admin. Bất kỳ user Firebase nào cũng có thể đẩy JSON lên repo và lên site (Critical).

## Các phương án
1. **REST + kiểm email** — giữ `accounts:lookup`, so `email === ADMIN_EMAIL`. Nhanh, ít rủi ro.
2. **Firebase Admin SDK `verifyIdToken` + custom claim `admin`** — chuẩn hơn, verify chữ ký server-side; dùng service account đã khai báo nhưng chưa dùng (TD-15).

## Quyết định
Làm **(1) ngay (P0)** để chặn lỗ hổng nhanh; lên lịch **(2) ở P2** để chuẩn hoá (custom claim + Admin SDK), gỡ luôn biến env thừa. Đồng thời kiểm tra/tắt self-signup Firebase nếu chỉ admin dùng.

## Hệ quả
- Tích cực: chặn ghi production trái phép; nền tảng cho phân vai bằng claim.
- Tiêu cực: thêm một env (`ADMIN_EMAIL`); giai đoạn (1) vẫn phụ thuộc REST.
- Kéo theo: cập nhật cả hai function; test token admin/non-admin (acceptance ở design doc).
