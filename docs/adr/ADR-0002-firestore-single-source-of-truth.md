# ADR-0002 — Firestore là nguồn sự thật, JSON là snapshot công khai

- **Trạng thái:** Proposed
- **Trạng thái triển khai:** Owner đã chấp nhận hợp đồng dữ liệu TD-06A ngày 2026-08-05; runtime/migration chưa triển khai
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
Chọn **(1)**: Firestore là nguồn sự thật cho dữ liệu động (players, events, tournaments, bookings…); `data/*.json` là **snapshot một chiều** sinh từ Firestore qua `api/push-*`.

- `players` dùng trường chuẩn `full_name`, `amz_rating`, `elo_score`; tên cũ chỉ là alias đọc trong giai đoạn migration.
- `tournaments` là thực thể giải đấu.
- `events` là nội dung thi đấu thuộc một tournament qua `tournament_id`.
- `data/events.json` là snapshot tournament công khai; tên file/khóa `events` được giữ ở version 1 để tương thích.
- `data/players.json` và `data/events.json` phải có cùng `schemaVersion`, `snapshotId`, `generatedAt` và được ghi trong một commit.

Hợp đồng trường, mapping và các cổng cutover nằm tại `docs/design/DESIGN-td-06-data-contract.md`.

## Hệ quả
- Tích cực: hết lệch số liệu; site tĩnh vẫn nhanh.
- Tiêu cực: cập nhật public có độ trễ redeploy; cần migration shape `players` (có backup).
- Kéo theo: rules cho collection mới (ADR liên quan DESIGN-firestore-rules); cập nhật `firestore-schema.md`.
