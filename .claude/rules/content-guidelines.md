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

1. **Hero** — Full-viewport, headline lớn, sub-text, 2 CTAs, stats row
2. **Marquee strip** — Thin, muted, chỉ là separator tinh tế
3. **Services** — Editorial numbered list (không phải card grid)
4. **About** — Split: large numbers trái / text phải
5. **Stats** — 4 numbers ngang: 8 sân / 5+ HLV / 1000+ thành viên / 50+ giải đấu
6. **Courts** — Visual showcase sân chơi
7. **Training** — Danh sách chương trình + CTA box sticky
8. **Testimonials** — 3 cột, border-right dividers, không card
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
About:     "Sân Pickleball / đỉnh nhất TP.HCM"
Training:  "Nâng trình độ của / bạn lên tầm cao mới"
CTA:       "Sẵn sàng lên sân / chưa?"
```

## SEO

- `<title>`: `AMZ Pickleball — [Page Name] | TP.HCM`
- Meta description: 120–160 ký tự, chứa "Pickleball", "TP.HCM", địa chỉ
- `<h1>`: Một per page, là headline chính của hero
- Structured data: LocalBusiness schema ở mọi trang
- `<link rel="canonical">` cho tất cả trang
