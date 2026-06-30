# Firestore Schema — AMZ Pickleball Ecosystem
# Cập nhật: 2026-06-28 | Phiên bản: 1.0

## Quy tắc thiết kế
- Mọi document đều có `createdAt` và `updatedAt` (ISO string)
- Firestore auto-ID trừ khi có lý do cụ thể
- Không embed array lớn vào document — dùng sub-collection hoặc collection riêng
- Audit trail (ELO, thanh toán) chỉ ghi thêm, KHÔNG sửa/xóa

---

## /users/{uid}
> Liên kết 1-1 với Firebase Auth UID

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| uid | string | = Firebase Auth UID (document ID) |
| role | string | "admin" / "staff" / "member" / "guest" |
| name | string | Họ tên |
| phone | string | 10 số, 0xxxxxxxxx |
| email | string | |
| avatar | string | URL hoặc "" |
| isActive | boolean | |
| createdAt | string | ISO 8601 |
| updatedAt | string | ISO 8601 |

---

## /players/{playerId}
> Hồ sơ thi đấu (tách khỏi /users để có VĐV chưa đăng ký)

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| userId | string\|null | ref /users/{uid} nếu có tài khoản |
| name | string | |
| phone | string | |
| email | string | |
| photo | string | URL |
| duprLevel | number | 2.0 – 5.5 |
| elo | number | Khởi tạo = 1000 |
| categories | string[] | ["Đơn nam", "Đôi nam", ...] |
| tier | string | "Mới" / "Khá" / "Giỏi" / "Chuyên" |
| stats.totalMatches | number | |
| stats.wins | number | |
| stats.losses | number | |
| stats.tournamentsPlayed | number | |
| stats.points | number | |
| isActive | boolean | |
| createdAt | string | |
| updatedAt | string | |

---

## /courts/{courtId}
> 8 sân AMZ Pickleball

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| name | string | "Sân 1" – "Sân 8" |
| type | string | "indoor" / "outdoor" |
| surface | string | "Pro Series", v.v. |
| pricePerHour | number | VND |
| amenities | string[] | ["Đèn", "Mái che", ...] |
| photos | string[] | URLs |
| status | string | "available" / "maintenance" / "closed" |
| position | number | Thứ tự hiển thị 1-8 |
| createdAt | string | |
| updatedAt | string | |

---

## /bookings/{bookingId}
> Đặt sân — dùng Firestore transaction để tránh double-booking

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| courtId | string | ref /courts |
| userId | string | ref /users |
| playerName | string | Denormalized |
| playerPhone | string | Denormalized |
| date | string | "YYYY-MM-DD" |
| startTime | string | "HH:MM" (24h) |
| endTime | string | "HH:MM" |
| durationHours | number | |
| amount | number | VND |
| status | string | "pending" / "confirmed" / "paid" / "cancelled" / "completed" |
| paymentId | string\|null | ref /payments |
| note | string | |
| cancelReason | string | |
| confirmedBy | string\|null | uid staff xác nhận |
| createdAt | string | |
| updatedAt | string | |

**Logic kiểm tra trống**: Dùng transaction, query bookings với:
`courtId == X AND date == D AND status != "cancelled"` rồi kiểm tra overlap thời gian.

---

## /payments/{paymentId}
> Lịch sử thanh toán — chỉ ghi thêm, KHÔNG sửa

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| bookingId | string | ref /bookings |
| userId | string | |
| amount | number | VND |
| method | string | "vnpay" / "momo" / "cash" / "transfer" |
| status | string | "pending" / "completed" / "failed" / "refunded" |
| gatewayRef | string | Mã giao dịch từ VNPay/MoMo |
| gatewayData | object | Raw response từ payment gateway |
| refundAmount | number | |
| refundReason | string | |
| processedBy | string | uid nếu thu tiền mặt |
| createdAt | string | |
| updatedAt | string | |

---

## /members/{uid}
> Gói hội viên — document ID = Firebase Auth UID

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| userId | string | = document ID |
| tier | string | "basic" / "standard" / "premium" |
| startDate | string | "YYYY-MM-DD" |
| endDate | string | "YYYY-MM-DD" |
| autoRenew | boolean | |
| price | number | VND đã thanh toán |
| paymentId | string | |
| benefits.freeHoursPerMonth | number | |
| benefits.discountPercent | number | |
| benefits.priorityBooking | boolean | |
| benefits.guestPasses | number | |
| usedHoursThisMonth | number | |
| renewalHistory | string[] | paymentId[] |
| createdAt | string | |
| updatedAt | string | |

---

## /tournaments/{tournamentId}
> Giải đấu

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| name | string | |
| description | string | |
| date | string | "YYYY-MM-DD" ngày bắt đầu |
| endDate | string | "YYYY-MM-DD" ngày kết thúc |
| type | string | "internal" / "inter-club" / "open" |
| format | string | "single_elimination" / "double_elimination" / "round_robin" |
| status | string | "upcoming" / "registration_open" / "in_progress" / "completed" / "cancelled" |
| categories | string[] | ["Đơn nam", "Đôi nam", ...] |
| maxTeamsPerCategory | number | |
| entryFee | number | VND, 0 = miễn phí |
| prize | string | |
| venue | string | |
| image | string | URL banner |
| registrationDeadline | string | ISO string |
| note | string | |
| organizer | string | uid |
| createdAt | string | |
| updatedAt | string | |

### Sub-collection: /tournaments/{id}/registrations/{regId}
| Trường | Kiểu | Mô tả |
|--------|------|-------|
| playerId | string | ref /players |
| playerName | string | Denormalized |
| partnerId | string\|null | ref /players nếu đánh đôi |
| partnerName | string | |
| category | string | |
| status | string | "pending" / "confirmed" / "withdrawn" |
| seed | number\|null | Hạt giống |
| paymentId | string\|null | |
| registeredAt | string | |
| updatedAt | string | |

---

## /matches/{matchId}
> Kết quả trận đấu — dùng để tính ELO

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| tournamentId | string | |
| round | string | "Vòng 1" / "Tứ kết" / "Bán kết" / "Chung kết" |
| category | string | |
| team1.player1Id | string | |
| team1.player2Id | string\|null | null nếu đơn |
| team1.score | number[] | [21, 18, 15] |
| team2.player1Id | string | |
| team2.player2Id | string\|null | |
| team2.score | number[] | |
| winnerId | string | playerId hoặc "team1"/"team2" |
| eloProcessed | boolean | Đã tính ELO chưa |
| playedAt | string | ISO string |
| note | string | |
| createdAt | string | |
| updatedAt | string | |

---

## /elo_history/{id}
> Nhật ký ELO — chỉ ghi thêm, KHÔNG SỬA, KHÔNG XÓA bao giờ

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| playerId | string | |
| matchId | string | |
| tournamentId | string | |
| eloBefore | number | |
| eloAfter | number | |
| delta | number | eloAfter - eloBefore |
| result | string | "win" / "loss" |
| opponent1Id | string | |
| opponent2Id | string\|null | |
| createdAt | string | Thời điểm tính ELO |

---

## /settings/{docId}

### settings/adminData — Tạm thời (sẽ migrate sang collections riêng)
Lưu players[], tournaments[], registrations[], history[] như hiện tại.

### settings/appConfig
| Trường | Kiểu | Mô tả |
|--------|------|-------|
| maintenanceMode | boolean | |
| bookingOpenHour | number | 5 (05:00) |
| bookingCloseHour | number | 23 (23:00) |
| priceWeekday | number | VND/giờ ngày thường |
| priceWeekend | number | VND/giờ cuối tuần |
| maxBookingDaysAhead | number | Đặt trước tối đa (ngày) |
| eloKFactor | number | K-factor ELO (thường 32) |
| updatedAt | string | |
| updatedBy | string | uid |

---

## Firestore Composite Indexes

```
bookings:    [courtId ASC, date ASC, status ASC, startTime ASC]
players:     [elo DESC, isActive ASC]
tournaments: [status ASC, date DESC]
elo_history: [playerId ASC, createdAt DESC]
payments:    [userId ASC, createdAt DESC]
```

---

## Thuật toán ELO (tính phía server — Cloud Function)

```javascript
function calculateElo(ratingA, ratingB, resultA, K = 32) {
  // resultA: 1 = thắng, 0 = thua, 0.5 = hòa
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const deltaA = Math.round(K * (resultA - expectedA));
  return {
    newRatingA: ratingA + deltaA,
    newRatingB: ratingB - deltaA,
    deltaA,
    deltaB: -deltaA
  };
}
```

Gọi sau khi nhập kết quả match → cập nhật /players/{id}.elo → ghi /elo_history.
