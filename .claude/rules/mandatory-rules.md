---
description: Quy tắc bắt buộc phải tuân theo sau mỗi thay đổi: screenshot review, mobile-first, scroll animation
alwaysApply: true
---

# Quy tắc bắt buộc (Mandatory Rules)

Các quy tắc này KHÔNG được bỏ qua trong bất kỳ tình huống nào.

## 1. Screenshot & Design Review sau mỗi thay đổi lớn

- Sau mỗi thay đổi lớn (section mới, layout thay đổi, style update), **bắt buộc chụp screenshot** và so sánh với design gốc (`godly.website_website_ohzi-interactive-555.png`)
- Kiểm tra: spacing, typography, màu sắc, tỷ lệ — phải khớp với phong cách tham khảo
- Nếu lệch, sửa ngay trước khi tiếp tục task tiếp theo
- Dùng `/verify` sau mỗi thay đổi lớn để xác nhận UI trên trình duyệt

## 2. Mobile-First & Responsive bắt buộc

- **Viết CSS mobile-first** — mọi component bắt đầu từ màn hình nhỏ nhất
- Test trên các breakpoint: `375px` (iPhone SE), `768px` (tablet), `1280px` (desktop), `1920px` (large)
- Navigation phải có hamburger menu trên mobile
- Font size tối thiểu `16px` trên mobile, không zoom-block (`user-scalable=no` bị cấm)
- Touch targets tối thiểu `44×44px`
- Không dùng `hover`-only interaction cho tính năng quan trọng

## 3. Scroll Animation bắt buộc cho mọi Section

- **Mọi section phải có animation khi scroll vào viewport** — không có section nào static
- Animation mặc định: `fade-up` (opacity 0→1, translateY 24px→0, duration 0.6s, ease-out)
- Dùng `IntersectionObserver` hoặc Framer Motion `whileInView` / GSAP ScrollTrigger
- Stagger animation cho các item trong list/grid: delay `0.1s` giữa các phần tử
- `prefers-reduced-motion`: wrap tất cả animation — người dùng tắt animation phải được tôn trọng
- Animation chỉ chạy **một lần** khi element vào viewport (`once: true`)

```js
// Pattern chuẩn — IntersectionObserver
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
```
