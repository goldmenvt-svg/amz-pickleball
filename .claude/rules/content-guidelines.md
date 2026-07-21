---
description: Hướng dẫn nội dung, tone of voice, và cấu trúc trang cho AMZ Pickleball website
globs: "**/*.html,**/*.md"
alwaysApply: false
---

# Content Guidelines — AMZ Pickleball

## Tone of Voice

- Tự tin, năng động nhưng không quá to tiếng
- Chuyên nghiệp — như một thương hiệu thể thao cao cấp
- **Ngắn gọn:** headline tối đa 6–8 từ, sub-text tối đa 2–3 câu
- Ưu tiên tiếng Việt, có thể song ngữ nếu cần
- Tránh buzzword rỗng tuếch ("đẳng cấp", "số 1", "hàng đầu" không có bằng chứng)

## Cấu trúc Homepage

Thứ tự sections theo đúng flow này:

1. **Hero** — Full-viewport, headline lớn, sub-text, 2 CTAs; proof row chỉ khi dữ liệu đã được xác minh
2. **Marquee strip** — Thin, muted, chỉ là separator tinh tế
3. **Services** — Editorial numbered list (không phải card grid)
4. **About** — Split layout; chỉ dùng số liệu đã được xác minh
5. **Stats** — Chỉ hiển thị số liệu có nguồn hiện hành; nếu chưa có thì bỏ section
6. **Courts** — Visual showcase sân chơi
7. **Training** — Danh sách chương trình + CTA box sticky
8. **Testimonials** — Chỉ dùng phản hồi thật, được phép công bố và có nguồn; nếu chưa có thì bỏ section
9. **Events** — List dạng timeline
10. **CTA Banner** — Full-width, centered, bold
11. **Footer** — 4 cột: brand / dịch vụ / CLB / liên hệ

## Site Structure (Multi-page)

```
/              Hero + tổng quan
/about         Giới thiệu CLB, đội ngũ, sứ mệnh
/services      Danh sách dịch vụ chi tiết
/courts        Sân chơi, tiện ích, đặt sân
/training      Chương trình tập luyện
/events        Giải đấu, sự kiện
/contact       Liên hệ, bản đồ, form
```

## Imagery Guidelines

- Tone ảnh: dark/moody hoặc high-contrast — không dùng ảnh stock sáng chói
- Ưu tiên ảnh thực tế: người chơi Pickleball, sân AMZ, giải đấu
- Nếu chưa có ảnh thực: dùng editorial placeholder (dark bg + subtle geometric)
- Không dùng clip art, icon pack rẻ tiền, hay ảnh minh họa cartoon

## Headlines — Pattern gợi ý

```
Hero:      "ĐỈNH CAO / PICKLEBALL"  (display 900, italic accent)
Services:  "Tất cả trong / một địa điểm"
About:     "Không gian chơi / kết nối cộng đồng"
Training:  "Nâng trình độ của / bạn lên tầm cao mới"
CTA:       "Sẵn sàng lên sân / chưa?"
```

## SEO

- `<title>`: dùng tên trang và địa danh đang được nguồn hiện hành xác nhận
- Meta description: ngắn gọn, mô tả đúng nội dung; chỉ dùng địa chỉ/địa danh đã xác minh
- `<h1>`: Một per page, là headline chính của hero
- Structured data: LocalBusiness schema ở mọi trang
- `<link rel="canonical">` cho tất cả trang

## Factual Claims & Offers

- Đọc `data/pricing.json` ngay trước khi viết giá, khung giờ, ưu đãi, thông tin liên hệ hoặc quyền lợi người mới.
- Chỉ dùng mục giá đang `visible`; giữ nguyên đơn vị, thời gian và ghi chú đi kèm.
- Không bịa hoặc tự suy ra: số sân, số HLV, số thành viên, số giải, tỷ lệ hài lòng, thứ hạng, giải thưởng, đối tác, khuyến mãi, quà tặng, học thử hoặc kết quả sức khỏe.
- Không tạo testimonial/review hoặc gán lời nói cho khách hàng. Phản hồi thật chỉ được dùng khi có nguồn và quyền công bố.
- Tránh các từ "số 1", "tốt nhất", "lớn nhất", "đầu tiên", "cam kết" nếu không có bằng chứng phù hợp.
- Nếu thông tin chưa chắc chắn, bỏ khỏi nội dung public hoặc ghi `[CẦN XÁC MINH]` trong bản nháp nội bộ.
- Nội dung tạo bởi AI phải được kiểm tra lại tên riêng, giá, ngày, liên kết, địa danh và CTA trước khi xuất bản.
