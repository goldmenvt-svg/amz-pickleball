# DESIGN — TD-06A: Hợp đồng dữ liệu `players` / `tournaments` / `events`

- **Trạng thái:** Owner Accepted — design only; chưa cho phép migration/runtime/cutover
- **Ngày:** 2026-08-05
- **Phạm vi:** hợp đồng dữ liệu và kế hoạch chuyển đổi; chưa thay đổi runtime hay dữ liệu Production
- **Liên quan:** TD-06, ADR-0002, `docs/DATABASE_VERSIONING.md`, `firestore-schema.md`

## 1. Mục tiêu và nguyên tắc

1. Firestore là nguồn ghi chuẩn duy nhất cho dữ liệu vận hành.
2. `data/players.json` và `data/events.json` là snapshot công khai chỉ đọc, sinh một chiều từ Firestore.
3. Một khái niệm chỉ có một tên chuẩn; tên cũ chỉ được đọc trong giai đoạn chuyển tiếp và không được ghi mới.
4. Hai snapshot public phải thuộc cùng một phiên bản xuất và cùng một commit Git.
5. Dữ liệu cá nhân (`phone`, `email`, `birth_year`, `note`) không được xuất vào snapshot công khai.

## 2. Ranh giới thực thể chuẩn

| Thực thể | Nguồn chuẩn | Ý nghĩa | Không được dùng để |
|---|---|---|---|
| `players/{playerId}` | Firestore | Hồ sơ VĐV và trạng thái xếp hạng | Lưu bản sao public độc lập |
| `tournaments/{tournamentId}` | Firestore | Một giải đấu, địa điểm, thời gian và trạng thái | Đại diện cho từng nội dung thi đấu |
| `events/{eventId}` | Firestore | Một nội dung thi đấu thuộc đúng một tournament | Đại diện cho sự kiện marketing/public độc lập |
| `data/players.json` | Snapshot | Danh sách VĐV công khai đã khử PII | Nhận ghi trực tiếp từ UI khác |
| `data/events.json` | Snapshot | Danh sách **tournament công khai** | Ánh xạ collection Firestore `events` |

Tên `data/events.json` và khóa `events` được giữ trong `schemaVersion: 1` để không làm hỏng site tĩnh. Ý nghĩa chuẩn của payload là `publicTournamentSnapshot`. Việc đổi tên vật lý chỉ được xem xét ở schema version lớn hơn và phải có kế hoạch tương thích riêng.

## 3. Hợp đồng Firestore version 1

### 3.1 `players/{playerId}`

| Trường chuẩn | Kiểu | Bắt buộc | Quy tắc |
|---|---|---:|---|
| `full_name` | string | Có | trim, không rỗng |
| `amz_rating` | number\|null | Có | Điểm trình độ AMZ; `null` nếu chưa xếp |
| `elo_score` | number | Có | Mặc định 1000; nguồn duy nhất cho ELO |
| `elo_version` | integer | Có | Số phiên bản chuỗi cập nhật ELO, mặc định 0 |
| `is_active` | boolean | Có | Mặc định `true`; dùng ngừng hoạt động thay vì xóa hồ sơ đã có tham chiếu |
| `phone` | string | Không | Dữ liệu riêng tư, không xuất public |
| `email` | string | Không | Dữ liệu riêng tư, không xuất public |
| `gender` | string | Không | Giá trị nghiệp vụ phải được validator giới hạn trước khi cưỡng chế |
| `birth_year` | integer\|null | Không | Không xuất public |
| `club` | string | Không | Có thể xuất public nếu chính sách công khai cho phép |
| `location` | string | Không | Không xuất mặc định |
| `self_rating` | number\|null | Không | Không thay thế `amz_rating` |
| `dominant_hand` | string | Không | `left` hoặc `right` khi có |
| `note` | string | Không | Dữ liệu nội bộ, không xuất public |
| `categories` | string[] | Không | Danh mục thi đấu công khai nếu có |
| `stats` | object | Không | Thống kê dẫn xuất; không phải nguồn ELO |
| `created_at` | ISO-8601 string | Có | Ghi khi tạo, không thay đổi |
| `updated_at` | ISO-8601 string | Có | Cập nhật khi ghi nghiệp vụ |

Các alias cũ `name`, `duprLevel`, `elo`, `isActive`, `createdAt`, `updatedAt` chỉ được **đọc tương thích** trong thời gian migration. Code ghi mới sau cutover không được tạo hoặc cập nhật các alias này.

Quy tắc ánh xạ migration:

| Trường chuẩn | Nguồn ưu tiên | Fallback có kiểm soát |
|---|---|---|
| `full_name` | `full_name` | `name` |
| `amz_rating` | `amz_rating` | `duprLevel`; không suy từ ELO |
| `elo_score` | `elo_score` | `elo`, rồi 1000 nếu cả hai thiếu |
| `is_active` | `is_active` | `isActive`, rồi `true` |
| `created_at` | `created_at` | `createdAt`; nếu thiếu phải ghi nhận trong báo cáo migration |
| `updated_at` | `updated_at` | `updatedAt`, rồi thời điểm migration |

Nếu trường chuẩn và alias cùng tồn tại nhưng khác nhau, migration phải dừng document đó và đưa vào báo cáo xung đột; không tự chọn giá trị.

### 3.2 `tournaments/{tournamentId}`

Các trường version 1 dùng theo runtime admin hiện hành: `name`, `start_date`, `end_date`, `venue`, `court_count`, `status`, `description`, `created_at`, `updated_at`. Trường public tùy chọn gồm `levels`, `type`, `max_teams`, `image`. Mọi `event` nghiệp vụ tham chiếu tournament bằng `tournament_id`.

### 3.3 `events/{eventId}`

`events` được định nghĩa là **nội dung thi đấu**. Version 1 gồm: `tournament_id`, `name`, `event_type`, `status`, `rating_min`, `rating_max`, `max_players`, `entry_fee`, `created_at`, `updated_at`.

`tournament_id` bắt buộc và phải trỏ tới document `tournaments` tồn tại. `registrations`, `groups` và `matches` tham chiếu nội dung thi đấu bằng `event_id`.

## 4. Hợp đồng snapshot công khai version 1

Cả hai file phải có metadata giống nhau:

```json
{
  "schemaVersion": 1,
  "snapshotId": "<UUID hoặc ULID dùng chung>",
  "generatedAt": "<ISO-8601 UTC>",
  "sourceRevision": "<mã phiên bản nguồn nếu xác minh được>"
}
```

- `schemaVersion` là số nguyên.
- `snapshotId` và `generatedAt` phải giống nhau trong hai file.
- `sourceRevision` không được giả mạo Firestore revision; nếu chưa có cơ chế xác minh thì dùng giá trị rõ nghĩa như `unverified`.
- `lastUpdated` được giữ tạm trong version 1 như alias của `generatedAt` để tương thích site hiện hành.

### 4.1 `data/players.json`

Payload `players[]` chỉ gồm: `id`, `name`, `initials`, `level`, `categories`, `stats`, `elo`, `amz_rating`, `club`. `elo` được dẫn xuất duy nhất từ `elo_score`; `level` được dẫn xuất từ `amz_rating` và không được fallback sang ELO.

Không cho phép các trường `phone`, `email`, `birth_year`, `location`, `note`, `self_rating` trong snapshot.

### 4.2 `data/events.json`

Payload `events[]` được dẫn xuất từ `tournaments`, gồm: `id`, `name`, `date`, `status`, `venue`, `court_count`, `description`, `note`, `levels`, `type`, `maxTeams`, `image`. Đây là mapping tương thích cho site tĩnh, không phải schema của collection Firestore `events`.

## 5. Giao dịch xuất snapshot

Exporter version 1 phải:

1. Đọc `players` và `tournaments` từ cùng một lần chạy.
2. Validate schema, ID trùng, dữ liệu TEST và danh sách trường PII bị cấm ở server.
3. Tạo hai file với cùng metadata.
4. Ghi cả hai file trong **một commit Git duy nhất** qua Git Data API hoặc cơ chế tương đương.
5. Chỉ trả thành công sau khi xác minh commit chứa đúng cả hai file.

Không được ghi tuần tự thành hai commit. Nếu bất kỳ validation hoặc thao tác ghi nào lỗi, không file nào được công bố.

## 6. Kế hoạch cutover (chưa được phép chạy Production)

| Gate | Nội dung | Điều kiện đạt |
|---|---|---|
| G0 | Owner chấp nhận ADR/hợp đồng | Quyết định được ghi chính thức |
| G1 | Inventory chỉ đọc | Báo cáo count/field/xung đột, không in PII |
| G2 | Migration idempotent + unit test | Chạy lần hai tạo 0 thay đổi |
| G3 | Emulator/staging | Admin và app đọc schema chuẩn; alias chỉ đọc |
| G4 | Backup + dry-run Production | Có phương án rollback và báo cáo trước/sau |
| G5 | Cutover writer | Chỉ ghi trường chuẩn; chưa xóa alias |
| G6 | Export nguyên tử | Hai snapshot cùng commit và metadata |
| G7 | Quan sát ổn định | Đối chiếu số lượng/hash logic đạt trước khi dọn alias |

`settings/adminData` và fallback `localStorage.amz_admin` thuộc TD-09/nhánh dọn nguồn bóng. Chúng không được coi là nguồn chuẩn; việc vô hiệu hóa chỉ thực hiện sau inventory và phương án bảo toàn dữ liệu riêng.

## 7. Tiêu chí đóng TD-06

- ADR-0002 được Owner chuyển `Accepted`.
- Schema chuẩn được thực thi ở mọi writer và reader chính.
- Migration idempotent đã qua emulator/staging, backup và verify.
- Hai snapshot được tạo nguyên tử với `schemaVersion`/`snapshotId` chung.
- Site tĩnh và app cho kết quả xếp hạng/tournament khớp theo phép kiểm tự động.
- Không còn writer độc lập vào snapshot; alias cũ chỉ được xóa sau thời gian quan sát được Owner phê duyệt.
