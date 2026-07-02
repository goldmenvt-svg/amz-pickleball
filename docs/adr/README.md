# Architecture Decision Records (ADR)

> Mỗi ADR ghi lại **một** quyết định kiến trúc quan trọng: bối cảnh, lựa chọn, hệ quả.
> Định dạng: MADR rút gọn. Trạng thái: Proposed → Accepted → (Superseded).

## Chỉ mục

| ID | Tiêu đề | Trạng thái | Liên quan |
|---|---|---|---|
| [ADR-0000](ADR-0000-template.md) | Template | — | — |
| [ADR-0001](ADR-0001-single-host-vercel.md) | Chốt một host: Vercel (bỏ GitHub Pages) | Proposed | TD-01 |
| [ADR-0002](ADR-0002-firestore-single-source-of-truth.md) | Firestore là nguồn sự thật, JSON là snapshot | Proposed | TD-06 |
| [ADR-0003](ADR-0003-admin-authz-on-serverless.md) | Bắt buộc kiểm quyền admin ở serverless | Proposed | TD-02 |
| [ADR-0004](ADR-0004-app-nextjs-fate.md) | Số phận app-nextjs (Tournament OS) | Proposed | TD-05 |

## Quy ước
- Tạo ADR mới khi có quyết định ảnh hưởng cấu trúc, deploy, dữ liệu, bảo mật, hoặc khó đảo ngược.
- Không sửa ADR đã Accepted; nếu đổi ý → tạo ADR mới "Supersedes ADR-XXXX".
