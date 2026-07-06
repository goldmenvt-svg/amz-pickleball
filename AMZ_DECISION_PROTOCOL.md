# AMZ_DECISION_PROTOCOL.md — Quy trình ra quyết định

> Trạng thái: Đã xác nhận — 2026-07-06
> Vai trò tài liệu: Ghi lại quy trình ra quyết định giữa Owner, ChatGPT, Claude Code.
> Không tạo business truth mới. Nếu mâu thuẫn với AMZ_BUSINESS_BLUEPRINT.md hoặc AMZ_OS.md, hai tài liệu đó thắng.

---

## 1. Vai trò

- **Owner** — người quyết định cuối cùng về business, duyệt mọi thay đổi quan trọng.
- **ChatGPT** — cố vấn chiến lược và CTO reviewer, phản biện phương án, giảm rủi ro.
- **Claude Code** — phân tích và thực thi kỹ thuật. Không tự quyết định business.

---

## 2. Tài liệu nền

- `AMZ_BUSINESS_BLUEPRINT.md` — nguồn sự thật về business.
- `AMZ_OS.md` — nguồn sự thật về cấu trúc vận hành.
- `AMZ_90_DAY_ACTION_PLAN.md` — kế hoạch 90 ngày.
- `docs/adr/` — ghi lại quyết định kiến trúc/kỹ thuật đã chốt.
- `docs/operations/` — playbook cho quy trình vận hành hằng ngày.

---

## 3. Nguyên tắc

- Claude Code không tự quyết định business.
- Không làm công nghệ chỉ vì công nghệ.
- Ưu tiên giá trị thật tại sân, khách hàng, cộng đồng, nội dung sống.
- Mỗi lần chỉ chọn 1–2 việc chính.
- Nhiệm vụ phân tích thì chỉ phân tích, không sửa file.
- Trước khi sửa code phải audit và được Owner duyệt.
- Trước khi commit phải có final review.
- Không push, deploy, đổi Firebase nếu Owner chưa duyệt rõ.

---

## 4. Quy trình ra quyết định

1. Claude Code phân tích hiện trạng, đề xuất phương án.
2. ChatGPT review — chỉ ra điểm đúng, điểm sai, rủi ro.
3. Owner chốt quyết định.
4. Claude Code ghi nhận bằng ADR hoặc playbook nếu cần.
5. Final review trước commit.
6. Commit riêng, rõ phạm vi.
7. Push thủ công nếu cần.
8. Post-push verification.

---

## 5. Quy tắc giao việc cho Claude Code

- Mỗi task phải ghi rõ được sửa gì và không được sửa gì.
- Không tự mở rộng phạm vi.
- Không tự tạo file nếu chưa được yêu cầu.
- Không tự commit/push/deploy.
- Nếu phát hiện mâu thuẫn giữa tài liệu và code, phải dừng lại báo cáo.

---

## 6. Khi nào dùng ADR, khi nào dùng playbook

- **ADR** — quyết định kiến trúc, dữ liệu, bảo mật, deploy, nguồn sự thật.
- **Playbook** — quy trình vận hành hằng ngày, nhân viên sân, checklist thủ công.

---

## 7. Thứ tự ưu tiên

- Công nghệ mâu thuẫn với business → ưu tiên business.
- Tốc độ mâu thuẫn với an toàn → ưu tiên an toàn.
- Claude Code không chắc → dừng lại, hỏi Owner và ChatGPT.
