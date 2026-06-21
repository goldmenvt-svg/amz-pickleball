---
description: Quy ước code, HTML semantics, performance, accessibility cho dự án AMZ Pickleball
globs: "**/*.html,**/*.css,**/*.js,**/*.ts,**/*.tsx"
alwaysApply: false
---

# Development Conventions

## Code Style

- **Không viết comments** trừ khi logic thực sự không hiển nhiên (constraint ẩn, workaround cụ thể)
- Không thêm tính năng ngoài scope đã yêu cầu
- Không thêm error handling cho scenario không thể xảy ra
- Không dùng feature flags hay backwards-compat shims khi có thể sửa trực tiếp

## HTML Semantics

Dùng đúng semantic tags — không dùng `<div>` cho mọi thứ:

```
<nav>       navigation
<main>      main content
<section>   thematic sections (với id để anchor)
<article>   standalone content (testimonials, event items)
<header>    section headers
<footer>    footer
<h1>–<h6>  heading hierarchy (không skip levels)
<time>      dates/times
<address>   contact info
```

## Performance

- Lazy-load images: `loading="lazy"` cho tất cả ảnh dưới fold
- Font: `font-display: swap` để tránh FOIT
- Minimize JavaScript — không thêm library nặng cho animation đơn giản
- IntersectionObserver thay vì scroll event listener
- `{ passive: true }` cho scroll/touch event listeners

## Accessibility

- Contrast ratio tối thiểu WCAG AA (4.5:1 cho text thường, 3:1 cho large text)
- Keyboard navigation: tất cả interactive elements phải reachable bằng Tab
- `aria-label` cho buttons chỉ có icon
- `alt` text cho tất cả images
- `prefers-reduced-motion` media query wrap tất cả animation
- Không dùng `user-scalable=no` trong viewport meta

## CSS

- Mobile-first: viết base styles cho mobile, dùng `min-width` media queries để scale up
- Breakpoints: `480px`, `768px`, `1024px`, `1440px`
- Dùng CSS custom properties (`--var`) cho tất cả design tokens
- Không dùng `!important`
- `clamp()` cho fluid typography và spacing

## JavaScript

- Vanilla JS ưu tiên — không import thư viện nếu có thể làm bằng 20 dòng native
- `IntersectionObserver` cho scroll animations (không dùng scroll event)
- Event delegation thay vì attach listener cho từng element
- Không blocking scripts trong `<head>` — dùng `defer` hoặc cuối `<body>`
