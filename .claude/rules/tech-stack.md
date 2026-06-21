---
description: Tech stack, file structure và tooling cho dự án AMZ Pickleball
globs: "**/*.json,**/*.config.*,**/*.ts,**/*.tsx"
alwaysApply: false
---

# Tech Stack — AMZ Pickleball

## Hiện tại (Phase 1 — Static)

File đơn `index.html` với embedded CSS và vanilla JS. Không cần build tool.

```
d:\website test\
├── .claude/
│   └── rules/          ← rule files này
├── index.html          ← toàn bộ website
├── CLAUDE.md
└── package.json        ← chỉ có playwright cho testing
```

## Phase 2 — Framework (khi cần scale)

**Recommended stack:**
- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS v4
- **Animation:** Framer Motion hoặc GSAP ScrollTrigger
- **Language:** TypeScript
- **Fonts:** `next/font` với Google Fonts (Inter)
- **Icons:** Lucide React hoặc Phosphor Icons
- **Deployment:** Vercel

**Alternative (simpler):** Vite + React + Tailwind CSS

## File Structure (Next.js — Phase 2)

```
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── about/page.tsx
│   ├── services/page.tsx
│   ├── courts/page.tsx
│   ├── training/page.tsx
│   ├── events/page.tsx
│   └── contact/page.tsx
├── components/
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── Navigation.tsx
│   ├── sections/
│   │   ├── Hero.tsx
│   │   ├── Services.tsx
│   │   ├── About.tsx
│   │   ├── Stats.tsx
│   │   ├── Courts.tsx
│   │   ├── Training.tsx
│   │   ├── Testimonials.tsx
│   │   ├── Events.tsx
│   │   └── CTABanner.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Badge.tsx
│       └── RevealWrapper.tsx
├── lib/
│   └── utils.ts
├── public/
│   └── images/
└── styles/
    └── globals.css
```

## Framer Motion Scroll Animation Pattern

```tsx
const variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: 'easeOut' } }
}

<motion.section
  variants={variants}
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, margin: '-40px' }}
/>
```

## Performance Targets

- Lighthouse Performance: ≥ 90
- LCP: < 2.5s
- CLS: < 0.1
- Bundle JS: < 150kb gzipped
- Ưu tiên mobile performance (phần lớn user Việt Nam dùng điện thoại)
