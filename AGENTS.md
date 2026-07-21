# AGENTS.md — AMZ Pickleball

## Scope

These instructions apply only to the AMZ Pickleball repository. Do not reuse AMZ
context, data, permissions, or decisions for another project.

## Operating model

- Inspect and report for review/audit requests; do not turn them into edits.
- For an approved implementation task, change only the files needed for that task.
- Keep changes small, reviewable, and reversible. Preserve working behavior unless
  the task explicitly authorizes a behavior change.
- Do not commit, push, merge, deploy, publish, modify Firebase, or contact external
  services unless the owner explicitly authorizes that exact action.
- Never bypass permission prompts or weaken repository safety controls.

## Sources of truth

Read the live source before using a fact. If sources conflict, stop and report the
conflict instead of guessing.

| Subject | Source of truth |
|---|---|
| Prices, offers, hours and public contact links | `data/pricing.json` |
| Website colors, type, spacing and motion | `.claude/rules/design-system.md` |
| Content and claim rules | `.claude/rules/content-guidelines.md` |
| Marketing positioning | `.agents/product-marketing.md` |
| Current dependencies | the relevant `package.json` and lockfile |
| Current runtime/deployment behavior | current code and deployment configuration |
| Architecture and security findings | current code first; dated audit documents are supporting context |

Do not copy dynamic facts into agent instructions. Do not assume that a dated audit,
roadmap, screenshot, or prior conversation still describes the current repository.

## Data and security

- Do not read or reveal `.env`, `.env.*`, `secrets/**`, private keys, credentials,
  tokens, passwords, customer exports, private email exports, or banking data.
- Public Firebase web configuration is not a secret by itself. Security depends on
  authorization rules, authentication, API restrictions and App Check. Never print
  credentials or server-side secrets while assessing it.
- `data/players.json` is a public-site snapshot that may contain personal data.
  Prefer schema checks and aggregate counts; do not print complete records or bulk
  personal values. Ask before changing athlete data.
- Git commit SHAs and file-checksum hashes may be printed for source verification.
  Never print password hashes, credential material, or secret-derived values.
- Do not send repository data to third parties unless the owner explicitly approves
  the destination and exact data scope.

## Marketing and design safeguards

- Never invent rankings, awards, attendance, member counts, court counts, event
  counts, testimonials, reviews, discounts, free trials, partnerships, outcomes or
  superlatives.
- A claim may be published only when a current repository source or owner-provided
  evidence supports it. Otherwise label it as a draft requiring verification or
  omit it.
- Read `data/pricing.json` immediately before drafting any price or offer.
- Read `.claude/rules/design-system.md` before UI or creative work.
- Prefer real, approved AMZ media. Do not imply that a placeholder or generated
  image documents an actual AMZ facility, event or customer.

## Repository workflow

1. Confirm the current branch, clean/dirty state, and relevant source files.
2. State the exact files to be changed before editing.
3. Preserve unrelated user changes in a dirty worktree.
4. Run the smallest relevant checks after editing. Tests must not write production
   data, deploy, or call live mutation endpoints.
5. Review `git diff --check`, the scoped diff, and `git status`.
6. Report changed files, checks, remaining risks and the next approval boundary.

Do not use destructive Git commands, mass deletion, forced updates, or unbounded
cleanup. Treat `admin.html`, `api/**`, Firebase rules/configuration, deployment
configuration and automation workflows as high-impact surfaces requiring explicit
task scope and focused verification.
