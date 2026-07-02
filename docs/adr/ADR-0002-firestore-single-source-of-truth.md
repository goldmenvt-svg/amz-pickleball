# ADR-0002 — Firestore là nguồn sự thật, JSON là snapshot công khai

- **Trạng thái:** Proposed
- **Ngày:** 2026-06-30
- **Người quyết định:** CTO / Lead Architect
- **Liên quan:** TD-06, TD-04, `DATABASE.md`, `docs/design/DESIGN-firestore-rules.md`

## Bối cảnh
`players` và `events` tồn tại ở **hai nguồn**: `data/*.json` (site tĩnh đọc) và Firestore (admin + app-nextjs đọc/ghi). Shape đã lệch (`level`/`points` vs `duprLevel`/`elo`). Hai đường ghi độc lập → số liệu mâu thuẫn.

## Các phương án
1. **Firestore = nguồn chính; JSON = snapshot sinh tự động (một chiều).** Site tĩnh vẫn đọc JSON (nhanh, SEO), nhưng JSON chỉ do Firestore sinh ra.
2. **JSON = nguồn chính.** Bỏ ghi Firestore cho players/events. Nhưng app-nextjs cần Firestore live (đặt sân/giải đấu) → không khả thi cho phần động.
3. **Đọc Firestore trực tiếp từ site tĩnh.** Mất lợi thế tĩnh/SEO, tăng đọc Firestore (chi phí).

## Quyết định
Chọn **(1)**: Firestore là nguồn sự thật cho dữ liệu động (players, events, tournaments, bookings…); `data/*.json` là **snapshot một chiều** sinh từ Firestore qua `api/push-*`. Thống nhất **một** shape `players` (gộp level/points ↔ duprLevel/elo). Định nghĩa rõ ranh giới `events` (marketing) vs `tournaments` (thực thể giải có đăng ký/lịch/kết quả).

## Hệ quả
- Tích cực: hết lệch số liệu; site tĩnh vẫn nhanh.
- Tiêu cực: cập nhật public có độ trễ redeploy; cần migration shape `players` (có backup).
- Kéo theo: rules cho collection mới (ADR liên quan DESIGN-firestore-rules); cập nhật `firestore-schema.md`.
