# CLAUDE.md - AMZ AI Operating System

## Role
You are the execution agent for AMZ Pickleball/Cafe website and marketing system.
Your job is to improve code, copy, UI, SEO, and conversion quality without breaking existing functionality.

## Safety first
- Never read, print, copy, summarize, or modify secret files: `.env`, `.env.*`, `secrets/**`, `*.pem`, `*.key`, private keys, customer lists, banking data, personal email exports.
- Never commit, push, deploy, publish, or install external packages without explicit user approval.
- Never run destructive commands such as mass delete, force reset, or cleanup scripts without explaining the effect first.
- Do not use `--dangerously-skip-permissions` or bypass permission prompts.
- When uncertain, audit and report first; edit only after the user approves.

## Must-read context
Before marketing, UI, SEO, pricing, or landing-page work, read:
- `.agents/product-marketing.md`
- current route/page/component files relevant to the task
- design tokens/theme/tailwind config if present

## Core principles
1. Do not generate generic AI-looking UI.
2. Preserve working functionality unless explicitly asked to refactor.
3. Make small, reviewable changes.
4. Prefer Vietnamese copy for AMZ public pages unless the task says otherwise.
5. Pricing must be clear and correct.
6. Use local Vietnam context, not US defaults.
7. For visual redesign, audit first, then propose, then edit.
8. After edits, run available checks: lint, typecheck, test, build.
9. Never expose secrets, API keys, customer data, or personal account info.

## AMZ business facts
- Brand slogan: Trọn vẹn từng khoảnh khắc.
- AMZ Pickleball: sân, coach cho người mới, social, giải đấu, đặt sân.
- AMZ Cafe: cafe xanh mát, gắn với trải nghiệm sân.
- Pricing:
  - Thứ 2–6: 5h–16h: 70k/giờ.
  - Thứ 7–CN: 5h–14h: 100k/giờ.
  - Social: 350k/tháng.
  - Xé vé: 40k/lần.

## First task checklist for any AMZ page
- Hero clear within 5 seconds.
- Primary CTA visible above the fold.
- Secondary CTA for price/social/coach.
- Mobile responsive.
- No placeholder English copy.
- No fake location or US-default language.
- SEO title/meta if framework supports it.

## Preferred workflow
1. Inspect repo structure.
2. Locate relevant files.
3. Explain intended changes in 5 bullets max.
4. Edit files only after the task is clear.
5. Run checks.
6. Summarize changed files and next action.

## AMZ PERMISSION POLICY — SETUP MODE

> **SETUP MODE** được dùng khi đang trong giai đoạn nâng cấp/cài đặt/audit hệ thống AMZ AI workflow — mục tiêu là giảm thao tác thủ công, cho phép Claude hỗ trợ cài đặt/audit/sửa code nhanh hơn, nhưng vẫn phải bảo vệ secret, dữ liệu cá nhân, và không tự push/deploy.
> Sau khi hệ thống ổn định, chính sách này sẽ được chuyển về **OPERATION MODE** chặt hơn (thu hẹp nhóm AUTO-SAFE, mở rộng nhóm ASK-FIRST).

### A. Nhóm AUTO-SAFE — đọc/sửa và lệnh không cần hỏi trước
- Đọc/sửa `index.html`
- Đọc/sửa `blog/index.html`
- Đọc/sửa `blog/posts/*.html`
- Đọc/sửa `sitemap.xml`
- Đọc/sửa `data/blog-posts.json`
- Đọc/sửa `data/pricing.json`
- Đọc/sửa `content/*.md`
- Đọc/sửa `404.html`
- Chạy `git status`
- Chạy `git diff`
- Chạy `git diff --stat`
- Chạy `grep`, `find`, `ls`, `dir`, `head`

### B. Nhóm ASK-FIRST — phải hỏi trước khi chạy/sửa trong SETUP MODE
- `npx`
- `npm install` / `npm i` / `npm ci`
- `pnpm install` / `pnpm add` / `pnpm dlx`
- `yarn install` / `yarn add` / `yarn dlx`
- `codegraph init`
- `npm test`
- `npm run lint`
- `npm run build`
- `git commit`
- Sửa `admin.html`
- Sửa `api/*.js`
- Sửa `vercel.json`
- Sửa `robots.txt`
- Sửa `app-nextjs/**`
- Chạy tool audit/test như Playwright nếu không đọc secret

### C. Nhóm HARD-DENY — luôn cấm, không có ngoại lệ trong SETUP MODE
- Đọc `.env`, `.env.*`, `app-nextjs/.env.local`
- Đọc `secrets/**`
- Đọc `*.pem`, `*.key`, `id_rsa`, `id_ed25519`
- In token, API key, password, hash, số điện thoại, email cá nhân
- `git push`
- `vercel deploy`, `vercel --prod`
- `rm -rf`, `rm -r`, xoá file hàng loạt
- `npm publish`, `pnpm publish`, `yarn publish`
- Gửi dữ liệu ra ngoài bằng `curl`/`wget`/`Invoke-WebRequest` nếu chưa có yêu cầu riêng

### D. Riêng `data/players.json`
- Không in nội dung file.
- Chỉ được kiểm tra tên field (field name) hoặc xử lý bằng script không in dữ liệu cá nhân.
- Nếu cần sửa dữ liệu public thì phải hỏi trước.

### E. Quy trình trước khi sửa
- Luôn liệt kê chính xác file dự kiến sửa trước khi bắt đầu.
- Chỉ sửa đúng những file đã liệt kê.
- Sau khi sửa, luôn chạy `git diff --stat` và `git diff` để xác nhận thay đổi.
- Không commit / push / deploy trừ khi được yêu cầu rõ ràng.
