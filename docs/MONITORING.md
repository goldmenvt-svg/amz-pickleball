# Monitoring & Observability — AMZ Pickleball

> Kế hoạch giám sát hệ thống. Cập nhật: 2026-06-30.
> Hiện trạng: gần như chưa có observability chủ động (chỉ `console.error` trong `api/*`). Đây là kế hoạch đề xuất.

---

## 1. Hiện trạng
- Serverless `api/push-*`: chỉ `console.error('[push-*] Error: ...')` → xem qua Vercel logs thủ công.
- Không có uptime check, không alert, không dashboard, không error tracking client.
- Không theo dõi Firestore usage/cost, không theo dõi rules-denied.

---

## 2. Bốn trụ cột cần thiết lập

### 2.1 Uptime / Availability
| Mục tiêu | Công cụ gợi ý |
|---|---|
| Ping `https://amzpickleball.vn` (200, < 2s) | UptimeRobot / Better Stack / Vercel monitoring |
| Ping `/admin.html` trả 401 (Basic auth còn sống) | cùng công cụ, kỳ vọng 401 |
| (Nếu deploy app) ping `app.amzpickleball.vn` | — |
| Cảnh báo | Email/Telegram khi down 2 lần liên tiếp |

### 2.2 Logs
- **Vercel:** bật log drains hoặc xem Functions logs cho `api/push-*`. Chuẩn hoá log JSON: `{level, route, requestId, msg}`. KHÔNG log token/secret.
- **Firebase:** Firestore audit qua Google Cloud Logging.
- **GitHub Actions:** theo dõi `sync-youtube.yml`/`video-scan.yml` fail (bật email notification).

### 2.3 Metrics
| Metric | Vì sao |
|---|---|
| Vercel: invocations, error rate, duration của `api/push-*` | phát hiện lạm dụng/lỗi |
| Firebase: reads/writes/deletes per day, lưu lượng theo collection | chi phí + bất thường |
| Firestore: số lần **rules denied** | dấu hiệu tấn công/đặt rule sai |
| Web: Core Web Vitals (LCP/CLS/INP) | hiệu năng (mục tiêu tech-stack) |
| Firebase Auth: số đăng nhập, đăng ký mới | phát hiện self-signup ngoài ý muốn (SECURITY #1) |

### 2.4 Alerting
- Ngưỡng: error rate `api/*` > 5% / 5 phút; reads Firestore tăng đột biến > Nx baseline; site down.
- Kênh: email + Telegram/Slack.
- Báo cáo định kỳ: digest hằng ngày (có thể tạo scheduled task tóm tắt).

---

## 3. Bảo mật quan sát (security observability)
- Theo dõi **đăng ký tài khoản mới** trên Firebase Auth (liên quan lỗ hổng API push-*).
- Theo dõi commit bất thường vào `data/*.json` (không từ admin/cron) → cảnh báo qua GitHub.
- Theo dõi 401/403 tăng đột biến ở `/admin.html` và `/api/*`.

---

## 4. Lộ trình triển khai (nhẹ, không tốn kém)
1. **P0 đi kèm bảo mật:** bật alert Firebase Auth signup + GitHub Actions fail email.
2. **P2:** uptime check 3 endpoint + chuẩn hoá log JSON trong `api/*`.
3. **P2:** dashboard Firebase usage + ngưỡng cảnh báo chi phí.
4. **P3:** Core Web Vitals (Vercel Analytics hoặc tự đo), error tracking client (Sentry free tier) nếu deploy app-nextjs.

---

## 5. SLO khởi điểm (đề xuất)
| Chỉ số | Mục tiêu |
|---|---|
| Uptime site công khai | ≥ 99.5% / tháng |
| `api/push-*` success rate | ≥ 99% |
| LCP (mobile) | < 2.5s |
| Thời gian phát hiện sự cố (MTTD) | < 15 phút (nhờ alert) |

## 6. Tham chiếu
- `SECURITY.md` (signup/abuse), `DEPLOYMENT.md` (Vercel/Actions), `TECH_DEBT.md` (TD-07/08).
