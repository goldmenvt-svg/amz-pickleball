---
description: Design system cho AMZ Pickleball: màu sắc, typography, motion, dark theme principles
alwaysApply: true
---

# Design System — AMZ Pickleball

**Reference inspiration:** `godly.website_website_ohzi-interactive-555.png`

## Core Principles

- **Tối giản (Minimalism):** Không gian âm nhiều, bố cục thưa thoáng, loại bỏ mọi thứ không cần thiết
- **Dark-first:** Nền pure black `#000000`, text sáng tương phản cao
- **Typography-led:** Chữ là nhân vật chính — font lớn, bold, có tính cách
- **Motion intentional:** Animation mượt mà, có chủ đích — không rối mắt
- **Professional energy:** Cảm giác thể thao nhưng không kém phần cao cấp
- **Editorial:** Generous negative space, thin dividers, không dùng card grid nặng nề

## Color Palette

```
--bg:       #000000   pure black background
--surface:  #0d0d0d   subtle surface (stats, sections)
--surface2: #141414   hover states
--border:   rgba(255,255,255,0.06)  thin dividers
--text:     #f0f0f0   primary text
--muted:    #606060   secondary text
--muted2:   #383838   disabled / decorative
--accent:   #c8f03a   neon yellow-green — CHỈ dùng cho:
                       1. Hero <em>PICKLEBALL</em>
                       2. Primary CTA button background
                       3. Nav logo dot
                       4. Hero badge dot
```

**Accent discipline:** Không dùng accent ở section headings, icons, badges, testimonials, hay các nơi khác. Càng dùng ít càng có lực.

## Typography

- **Display headings:** Inter 900, `clamp(56px, 11vw, 130px)`, letter-spacing `-0.045em`
- **Section headings:** Inter 900, `clamp(40px, 5.5vw, 68px)`, letter-spacing `-0.04em`
- **Body:** Inter 300–400, `15–17px`, line-height `1.75–1.8`
- **Labels/eyebrows:** Inter 500–600, `11px`, `letter-spacing: 0.14em`, `text-transform: uppercase`
- **Nav links:** Inter 500, `12px`, `letter-spacing: 0.06em`, uppercase
- **Scale:** Fluid với `clamp()` — không hardcode px

## Spacing & Layout

- **Section padding:** `160px 0` desktop, `88px 0` mobile
- **Section header margin-bottom:** `80px`
- **Max width:** `1200px`
- **Container padding:** `24px` sides (18px mobile)
- Dùng CSS Grid và Flexbox — không dùng framework utility classes nặng

## Dividers & Borders

- Chỉ dùng `border-top/bottom: 1px solid var(--border)` để phân tách sections
- Testimonials: `border-right` giữa các cột, không dùng card box
- Stats: `border-right` giữa các cột
- Services: `border-top/bottom` cho từng row — editorial list style

## Motion

- Scroll reveal: `opacity 0→1`, `translateY 28px→0`, `duration 0.65s`, `ease`
- Transition delays: `0.1s` stagger giữa các items
- Hover transitions: `0.2–0.3s` ease
- Nav scroll: background `blur(16px)` + darkening khi scroll qua `20px`
- Không dùng bouncy/spring animations — chỉ ease-out
