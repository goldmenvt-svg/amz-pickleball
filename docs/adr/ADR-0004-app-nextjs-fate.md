# ADR-0004 — Số phận app-nextjs (Tournament OS)

- **Trạng thái:** **Accepted — deploy app-nextjs riêng, preview/private trước, chưa public** — chốt 2026-07-02.
- **Ngày:** 2026-06-30 (đề xuất) · 2026-07-02 (chốt)
- **Người quyết định:** CTO / Lead Architect + Product Owner
- **Liên quan:** TD-05, TD-04, `ARCHITECTURE.md`, `MODULE_BOUNDARY.md`, `docs/runbooks/app-nextjs-deploy.md`

## Quyết định (2026-07-02)
Chọn **Phương án 1 — Deploy riêng**. Site tĩnh giữ marketing/nội dung; `app-nextjs` lo phần động (đặt sân, giải đấu, hội viên) ở subdomain — vì site tĩnh không phù hợp chứa booking/payment, và Firestore live là đúng cho phần động.

**`app-nextjs` chưa phải production chính của AMZ ở giai đoạn này** — hiện là **WIP**:
- Đặt sân (`/dat-san`) đang **mock** (`setTimeout`, `// TODO: gọi createBooking()`), chưa ghi Firestore.
- **Chưa có đăng nhập đầy đủ** (`auth` khởi tạo nhưng không dùng).
- Hội viên/thanh toán: có hàm lib nhưng chưa trang nào gọi.

→ Vì vậy **giai đoạn 1: chỉ deploy bản xem thử riêng tư** (`*.vercel.app`, KHÔNG gắn subdomain công khai) để review nội bộ. **Chỉ chuyển sang public khi Product Owner duyệt** — sau khi hoàn thiện đặt sân thật + mô hình đăng nhập. TD-04 đã thêm rule `courts` (read) + placeholder admin-only cho bookings/payments/members/users/elo_history (mở owner-based khi có auth).

## Bối cảnh
`app-nextjs/` (Next 15 + Firebase) hiện có đặt sân (`/dat-san` + VietQR), giải đấu (`/giai-dau` + đăng ký/lịch/kết quả), bảng xếp hạng, hội viên. Nhưng **không deploy**, không `.vercel`, không pipeline → chỉ chạy local 3001. Nó **trùng** bảng xếp hạng/giải đấu với site tĩnh nhưng dùng Firestore live. Để treo gây lệch và tốn bảo trì.

## Các phương án
1. **Deploy riêng (khuyến nghị)** — đưa lên Vercel ở `app.amzpickleball.vn`; site tĩnh giữ marketing/nội dung, app giữ phần động. Cần hoàn thiện rules (DESIGN-firestore-rules) trước.
2. **Gộp vào site tĩnh** — port tính năng động sang HTML/admin hiện tại. Chi phí cao, mâu thuẫn kiến trúc (monolith HTML khó chứa booking/payment).
3. **Đóng băng/bỏ** — giữ marketing tĩnh, hoãn phần động. Mất công Sprint 3 nhưng giảm độ phức tạp ngắn hạn.

## Hệ quả (đã chọn Phương án 1)
- Tích cực: tận dụng công đã làm; phân tách rõ marketing vs app.
- Tiêu cực: thêm một deployment để vận hành/giám sát; cần chuẩn hoá nguồn dữ liệu (ADR-0002).
- Kéo theo: subdomain + DNS; CI build/lint cho app (TD-08); monitoring (MONITORING.md).
