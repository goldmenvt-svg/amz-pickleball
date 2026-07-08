# AMZ Design Playbook

Hướng dẫn riêng cho AMZ Pickleball khi dùng Taste Skill (`.agents/skills/design-taste-frontend`, `redesign-existing-projects`, `high-end-visual-design`, `brandkit`). Đọc cùng `.claude/rules/design-system.md`, `.claude/rules/content-guidelines.md`, và `.agents/amz-marketing-playbook.md` trước khi sửa UI.

## AMZ visual direction

- Xanh đậm/đen, thể thao, hiện đại, sạch.
- Có cảm giác cafe + sân pickleball + cộng đồng — không phải SaaS/tech thuần túy.

## Không dùng giao diện AI-generic

- Không quá nhiều gradient.
- Không icon vô nghĩa.
- Không section na ná template có sẵn.

## UI principles

- CTA rõ ràng, dễ thấy.
- Nhiều khoảng thở (whitespace).
- Mobile-first.
- Section ngắn, dễ đọc.

## Brand feeling

- Năng động, thân thiện.
- Có chiều sâu.
- Không lòe loẹt.

## Conversion priority

Mỗi trang/section quan trọng nên dẫn tới một trong các hành động sau:
1. Đặt sân.
2. Tham gia Social Club.
3. Xem giải đấu.
4. Liên hệ/Zalo.

## Pricing UI

- Rõ giá, rõ khung giờ.
- Không tự thêm ưu đãi/giảm giá nếu không có trong `data/pricing.json` hoặc chủ dự án xác nhận.

## Trust UI

- Chỉ dùng chứng cứ thật (ảnh thật, số liệu thật, review thật).
- Không tự bịa review/claim.

## Production note

- Production hiện tại là **static root** (`index.html`, `data/*.json`, `blog/`, `sitemap.xml`, `vercel.json`).
- `app-nextjs/` là Phase 2 đang phát triển song song, chưa phải production.
