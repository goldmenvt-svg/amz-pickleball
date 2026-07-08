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

## CODEGRAPH USAGE — AMZ REPO
- CodeGraph đã được cài và index cho repo AMZ.
- Dùng CodeGraph ưu tiên khi cần hiểu `app-nextjs/`, route/component/function, dependency/call graph.
- Với production hiện tại là static root, các file như `index.html`, `data/*.json`, `blog/index.html`, `blog/posts/*.html`, `sitemap.xml`, `vercel.json` phải đọc trực tiếp vì CodeGraph không hiểu đầy đủ HTML/JSON/sitemap như code symbol.
- Không dùng CodeGraph để đọc `.env`, `.env.*`, `app-nextjs/.env.local`, `secrets/**`, `*.pem`, `*.key`.
- Không commit/push/deploy nếu chưa có xác nhận.
- Khi câu hỏi liên quan "production đang chạy gì", mặc định production = static root, app-nextjs = Phase 2 đang phát triển song song, trừ khi `vercel.json` hoặc Vercel config thay đổi.

## MARKETINGSKILLS USAGE — AMZ REPO
- Dùng MarketingSkills (`.agents/skills/`) cho copywriting, SEO local, landing page, campaign, blog, pricing messaging.
- Không dùng MarketingSkills để tự bịa claim như "lớn nhất", "đầu tiên", "số 1".
- Khi sửa blog phải đồng bộ `data/blog-posts.json`, `blog/index.html`, `blog/posts/*.html`, `sitemap.xml`.
- Khi sửa pricing/campaign phải kiểm `data/pricing.json` trước.
- Đọc thêm `.agents/amz-marketing-playbook.md` trước khi áp dụng skill vào nội dung AMZ.

## TASTE SKILL / UI-UX USAGE — AMZ REPO
- Dùng Taste Skill khi audit hoặc sửa UI/UX, landing page, hero, pricing, booking widget, mobile layout.
- Với production static site, ưu tiên `index.html`.
- Không redesign toàn site nếu chưa có yêu cầu.
- Không phá CTA, booking flow, pricing data.
- Không thêm claim "lớn nhất", "số 1", "đầu tiên".
- Không tự thêm testimonial/review giả.
- Trước khi sửa UI phải báo file dự kiến sửa và mục tiêu sửa.
- Đọc thêm `.agents/amz-design-playbook.md` trước khi áp dụng skill vào giao diện AMZ.

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

### D. Riêng `data/players.json` — dữ liệu nhạy cảm
- `data/players.json` chứa thông tin cá nhân thật của VĐV (tên, v.v.) — coi là **dữ liệu nhạy cảm**, không phải file cấu hình thông thường.
- **Không dùng tool Read trên file này** dưới bất kỳ lý do gì — Read in toàn bộ nội dung ra transcript, kể cả khi không cố ý.
- Chỉ được kiểm tra bằng `grep`/`find` (đếm field, kiểm tra tên key có tồn tại hay không, đếm số lượng bản ghi) hoặc script không in giá trị (VD `node -e` chỉ in `Object.keys(...)` hoặc `.length`, không in nội dung từng record).
- **Không in tên VĐV hoặc bất kỳ giá trị cá nhân nào** ra transcript/báo cáo nếu Owner không yêu cầu rõ ràng.
- Nếu cần sửa dữ liệu (kể cả dữ liệu public) trong file này thì phải hỏi trước.

### E. Quy trình trước khi sửa
- Luôn liệt kê chính xác file dự kiến sửa trước khi bắt đầu.
- Chỉ sửa đúng những file đã liệt kê.
- Sau khi sửa, luôn chạy `git diff --stat` và `git diff` để xác nhận thay đổi.
- Không commit / push / deploy trừ khi được yêu cầu rõ ràng.
