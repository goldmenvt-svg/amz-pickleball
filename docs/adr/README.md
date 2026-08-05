# Architecture Decision Records (ADR)

> Mỗi ADR ghi lại **một** quyết định kiến trúc quan trọng: bối cảnh, lựa chọn, hệ quả.
> Định dạng: MADR rút gọn. Trạng thái: Proposed → Accepted → (Superseded).

## Chỉ mục

| ID | Tiêu đề | Trạng thái | Liên quan |
|---|---|---|---|
| [ADR-0000](ADR-0000-template.md) | Template | — | — |
| [ADR-0001](ADR-0001-single-host-vercel.md) | Chốt một host: Vercel (bỏ GitHub Pages) | Proposed | TD-01 |
| [ADR-0002](ADR-0002-firestore-single-source-of-truth.md) | Firestore là nguồn sự thật, JSON là snapshot | Accepted — 2026-08-05 | TD-06 |
| [ADR-0003](ADR-0003-admin-authz-on-serverless.md) | Bắt buộc kiểm quyền admin ở serverless | Proposed | TD-02 |
| [ADR-0004](ADR-0004-app-nextjs-fate.md) | Số phận app-nextjs (Tournament OS) | Accepted — 2026-07-02 | TD-05 |
| [ADR-0005](ADR-0005-court-schedule-source-of-truth.md) | Nguồn sự thật lịch sân | Accepted — 2026-07-06 | Courts/bookings |
| [ADR-0007](ADR-0007-tournament-auto-pairing-mvp.md) | Tournament Auto Pairing MVP | Proposed; code đã triển khai | Tournament OS |
| [ADR-0008](ADR-0008-admin-import-players-registrations.md) | Import VĐV và đăng ký giải | Proposed; code đã triển khai một phần | Admin/import |

> Kiểm toán R25.08B ngày 2026-08-04: trạng thái “code đã triển khai” không tự động đổi một ADR `Proposed` thành `Accepted`. Owner cần ratify riêng nếu muốn chuẩn hóa trạng thái quyết định.

## Quy ước
- Tạo ADR mới khi có quyết định ảnh hưởng cấu trúc, deploy, dữ liệu, bảo mật, hoặc khó đảo ngược.
- Không sửa ADR đã Accepted; nếu đổi ý → tạo ADR mới "Supersedes ADR-XXXX".
