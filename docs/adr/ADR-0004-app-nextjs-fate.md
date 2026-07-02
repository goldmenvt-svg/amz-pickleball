# ADR-0004 — Số phận app-nextjs (Tournament OS)

- **Trạng thái:** Proposed (cần quyết định của chủ dự án)
- **Ngày:** 2026-06-30
- **Người quyết định:** CTO / Lead Architect + Product Owner
- **Liên quan:** TD-05, `ARCHITECTURE.md`, `MODULE_BOUNDARY.md`

## Bối cảnh
`app-nextjs/` (Next 15 + Firebase) hiện có đặt sân (`/dat-san` + VietQR), giải đấu (`/giai-dau` + đăng ký/lịch/kết quả), bảng xếp hạng, hội viên. Nhưng **không deploy**, không `.vercel`, không pipeline → chỉ chạy local 3001. Nó **trùng** bảng xếp hạng/giải đấu với site tĩnh nhưng dùng Firestore live. Để treo gây lệch và tốn bảo trì.

## Các phương án
1. **Deploy riêng (khuyến nghị)** — đưa lên Vercel ở `app.amzpickleball.vn`; site tĩnh giữ marketing/nội dung, app giữ phần động. Cần hoàn thiện rules (DESIGN-firestore-rules) trước.
2. **Gộp vào site tĩnh** — port tính năng động sang HTML/admin hiện tại. Chi phí cao, mâu thuẫn kiến trúc (monolith HTML khó chứa booking/payment).
3. **Đóng băng/bỏ** — giữ marketing tĩnh, hoãn phần động. Mất công Sprint 3 nhưng giảm độ phức tạp ngắn hạn.

## Quyết định
**Chưa chốt — cần Product Owner xác nhận.** Khuyến nghị kỹ thuật: **(1) Deploy riêng** vì site tĩnh không phù hợp chứa booking/payment, và Firestore live là đúng cho phần động. Điều kiện tiên quyết: hoàn thành P0 (auth/rules/deploy) trước khi public app.

## Hệ quả (nếu chọn 1)
- Tích cực: tận dụng công đã làm; phân tách rõ marketing vs app.
- Tiêu cực: thêm một deployment để vận hành/giám sát; cần chuẩn hoá nguồn dữ liệu (ADR-0002).
- Kéo theo: subdomain + DNS; CI build/lint cho app (TD-08); monitoring (MONITORING.md).
