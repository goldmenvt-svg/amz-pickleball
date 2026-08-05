# TD-06 — Hồ sơ phạm vi và kế hoạch inventory G1

- **Trạng thái hồ sơ:** Accepted — Owner nghiệm thu G1-P0 ngày 2026-08-05
- **Trạng thái gate:** G1-P0 ACCEPTED; G1 vẫn NOT STARTED; G1-P1 đến G1-P6 chưa được phép
- **Ngày lập:** 2026-08-05
- **Baseline repository chính do Owner xác nhận:** `4740e3836eaec1a1198151c4606f7ee9b1d72996`
- **Baseline cục bộ tương ứng nội dung G0:** `aa11296d7ecc4a2b6df664d51a36fee02c260a3e`
- **Workspace/nhánh:** `g1-scope-isolated` / `audit/td-06-g1-scope-plan`
- **Liên quan:** ADR-0002, TD-06A, TD-06B, hồ sơ G0, TD-04, TD-09

## 1. Quyền hiện hành và giới hạn kết luận

Ngày 2026-08-05, Owner cho phép:

> “Cho phép chuẩn bị hồ sơ phạm vi G1 trong workspace cô lập, chỉ kiểm toán và lập kế hoạch cục bộ; chưa truy cập Firebase/Production, chưa tạo hoặc chạy inventory tool, chưa sửa code hay dữ liệu, chưa commit, push, deploy hoặc migration.”

Ngày 2026-08-05, Owner tiếp tục xác nhận:

> “Chấp nhận hồ sơ phạm vi G1 và cho phép chuẩn bị commit cục bộ duy nhất tệp tài liệu; chưa cho phép tạo hoặc chạy inventory tool, chưa truy cập Firebase/Production, chưa push, deploy hoặc migration.”

Quyết định thứ hai nghiệm thu hồ sơ G1-P0 và chỉ mở rộng quyền để cập nhật dấu vết nghiệm thu, kiểm toán và stage duy nhất tệp tài liệu này nhằm chuẩn bị commit cục bộ. Nó không cấp quyền:

- kết nối Firebase/Google Cloud/Production hoặc xác minh rules đang deploy;
- đọc document, count, metadata, PII, project configuration hoặc billing của Production;
- tạo, cài dependency, chạy hoặc thử inventory/migration tool;
- chạy `scripts/migrate-to-firestore.js` hoặc bất kỳ writer nào;
- sửa code, runtime, rules, snapshot, dữ liệu hoặc cấu hình;
- tạo commit, push, deploy, publish, backup, restore hoặc migration.

Hồ sơ này là **thiết kế kiểm soát cho một lần inventory tương lai**. Mọi số lượng dữ liệu Production vẫn là `unverified`.

## 2. Nguồn chuẩn và thứ tự ưu tiên

Khi phân loại trường, nguồn được ưu tiên theo thứ tự:

1. `docs/design/DESIGN-td-06-data-contract.md` — hợp đồng TD-06A đã được Owner chấp nhận.
2. `docs/design/DESIGN-td-06b-runtime-migration-plan.md` — gates, quarantine, dry-run và ranh giới TD-09.
3. `docs/adr/ADR-0002-firestore-single-source-of-truth.md` — quyết định nguồn sự thật.
4. `firestore-schema.md` và code runtime — bằng chứng hiện trạng/legacy, không được tự nâng thành hợp đồng chuẩn nếu khác TD-06A.

`firestore-schema.md` vẫn chứa quy tắc chung `createdAt`/`updatedAt` và một schema tournament cũ, trong khi TD-06A dùng `created_at`/`updated_at` và schema Tournament OS. Inventory phải ghi nhận các dạng cũ như tín hiệu legacy; không tự coi chúng là alias hợp lệ hoặc tự map dữ liệu.

## 3. Mục tiêu G1

G1 chỉ nhằm tạo ảnh chụp **tổng hợp, chỉ đọc, không PII** về mức sẵn sàng dữ liệu cho TD-06:

1. Tổng số document của từng collection trong phạm vi.
2. Độ phủ và tính hợp lệ về kiểu của các trường chuẩn.
3. Mức tồn tại alias/legacy và số xung đột canonical–alias.
4. Số document thuộc từng nhóm quarantine theo mã lý do cố định.
5. Số quan hệ `events.tournament_id` thiếu, sai kiểu hoặc không tìm thấy tournament.
6. Số dấu hiệu dữ liệu TEST theo quy tắc đã được dùng trong baseline code.
7. Bằng chứng lần chạy không ghi dữ liệu và báo cáo không chứa giá trị bản ghi.

G1 không quyết định giá trị đúng cho bất kỳ document nào, không tạo kế hoạch ghi, không sửa xung đột và không chứng minh dữ liệu nhất quán tuyệt đối tại một thời điểm.

## 4. Phạm vi dữ liệu đề xuất

### 4.1 Trong phạm vi TD-06 G1

| Collection | Mục đích kiểm kê | Nội dung được phép đưa vào báo cáo |
|---|---|---|
| `players` | Độ phủ schema v1, alias và xung đột | Chỉ count theo trường/mã lỗi |
| `tournaments` | Độ phủ schema Tournament OS và tín hiệu legacy | Chỉ count theo trường/mã lỗi |
| `events` | Độ phủ schema nội dung thi đấu và tính toàn vẹn tham chiếu | Chỉ count theo trường/mã lỗi |

Chỉ đọc document trực tiếp của ba collection trên. Không duyệt đệ quy subcollection.

### 4.2 Ngoài phạm vi

- `settings/adminData`, `localStorage.amz_admin` và mọi bản sao trên thiết bị quản trị: thuộc TD-09/phương án bảo toàn nguồn bóng riêng.
- `users`, `registrations`, `matches`, `groups`, `bookings`, `payments`, `members`, `elo_history` và các collection khác.
- `data/players.json` và `data/events.json`: G0 đã kiểm tra cấu trúc top-level cục bộ; G1 không đọc lại phần tử snapshot để thay thế Firestore inventory.
- Firebase Auth, Storage, Analytics, logs, backups, secret, billing và cấu hình deploy.
- So sánh với localStorage trên máy Owner, export dữ liệu hoặc lấy mẫu bản ghi.

Nếu cần mở rộng collection, subcollection hoặc nguồn bóng, phải tạo phạm vi và phê duyệt riêng; không sửa danh sách động trong lúc chạy.

## 5. Danh mục chỉ số cố định

### 5.1 Chỉ số chung cho mỗi collection

| Mã | Chỉ số |
|---|---|
| `DOC_TOTAL` | Tổng document quan sát được |
| `DOC_SCANNED` | Tổng document thực tế đã phân loại |
| `READ_ERROR_COUNT` | Số lỗi đọc đã được chuyển thành mã lỗi cố định |
| `FIELD_PRESENT` / `FIELD_MISSING` / `FIELD_NULL` | Count theo từng trường allowlist |
| `FIELD_TYPE_VALID` / `FIELD_TYPE_INVALID` | Count kiểu hợp đồng; không ghi giá trị |
| `UNKNOWN_FIELD_PRESENT_DOCS` | Số document có ít nhất một trường ngoài allowlist; không in tên trường lạ |
| `TEST_MARKER_COUNT` | Số document có tên bắt đầu bằng TEST theo quy tắc tại mục 5.5 |
| `QUARANTINE_ANY` | Số document có ít nhất một lý do quarantine |
| `QUARANTINE_REASON_COUNT` | Count theo mã lý do; các lý do có thể chồng lấp |

Không được cộng các `QUARANTINE_REASON_COUNT` để suy ra số document; dùng riêng `QUARANTINE_ANY`.

### 5.2 `players`

**Trường chuẩn bắt buộc để đo độ phủ:** `full_name`, `amz_rating`, `elo_score`, `elo_version`, `is_active`, `created_at`, `updated_at`.

**Trường chuẩn tùy chọn để đo hiện diện/kiểu:** `phone`, `email`, `gender`, `birth_year`, `club`, `location`, `self_rating`, `dominant_hand`, `note`, `categories`, `stats` và các trường khác chỉ khi đã nằm trong allowlist được Owner duyệt trước khi tạo tool.

**Cặp canonical–alias được phép so sánh:**

| Canonical | Alias | Trạng thái count bắt buộc |
|---|---|---|
| `full_name` | `name` | canonical-only, alias-only, both-exact, both-trim-equal, conflict, neither, invalid-type |
| `amz_rating` | `duprLevel` | như trên, nhưng so sánh number/null đúng kiểu; không ép kiểu |
| `elo_score` | `elo` | như trên; không dùng ELO để suy `amz_rating` |
| `is_active` | `isActive` | như trên; chỉ boolean đúng kiểu |
| `created_at` | `createdAt` | như trên; chỉ chuỗi hợp lệ theo validator được duyệt |
| `updated_at` | `updatedAt` | như trên; chỉ chuỗi hợp lệ theo validator được duyệt |

Đối với tên, `both-trim-equal` chỉ loại khoảng trắng đầu/cuối để phân loại quan sát. Không lower-case, bỏ dấu hoặc Unicode-normalize để tự kết luận hai người là một. Mọi trường hợp khác là `conflict` hoặc `invalid-type`; inventory không chọn giá trị thắng.

`elo_version` không có alias được TD-06A chấp nhận. Thiếu trường này chỉ được đếm; không tự tạo mặc định trong G1.

### 5.3 `tournaments`

Đo độ phủ/kiểu cho schema TD-06A: `name`, `start_date`, `end_date`, `venue`, `court_count`, `status`, `description`, `created_at`, `updated_at`; đồng thời đo trường public tùy chọn `levels`, `type`, `max_teams`, `image`.

Các tên cũ quan sát trong `firestore-schema.md` như `date`, `endDate`, `createdAt`, `updatedAt`, `maxTeamsPerCategory`, `entryFee`, `registrationDeadline` chỉ được đếm dưới nhóm `LEGACY_FIELD_PRESENT`. Chúng không phải alias migration đã được phê chuẩn và không được tự map.

TD-06A chưa chốt đầy đủ enum/range/requiredness cho mọi trường tournament. Vì vậy G1 chỉ được kết luận presence/type đối với những quy tắc chưa chốt; không gắn `OUTSIDE_APPROVED_VALIDATOR` nếu chưa có validator được Owner phê duyệt.

### 5.4 `events`

Đo độ phủ/kiểu cho: `tournament_id`, `name`, `event_type`, `status`, `rating_min`, `rating_max`, `max_players`, `entry_fee`, `created_at`, `updated_at`.

Chỉ số quan hệ bắt buộc:

- `EVENT_TOURNAMENT_ID_MISSING`;
- `EVENT_TOURNAMENT_ID_INVALID_TYPE`;
- `EVENT_TOURNAMENT_ORPHAN` — ID có kiểu hợp lệ nhưng không tồn tại trong tập tournament đã đọc;
- `EVENT_TOURNAMENT_VALID`.

Báo cáo không được chứa `eventId`, `tournamentId`, cặp ID, ID băm hoặc path document.

### 5.5 Dấu hiệu TEST

Đếm trên trường tên canonical, hoặc alias tên chỉ khi canonical thiếu. Quy tắc prefix:

```regex
/^test(?:$|[\s_\-–—])/i
```

Chỉ xuất count cho `players`, `tournaments`, `events`; không xuất chuỗi khớp.

### 5.6 Mã quarantine tối thiểu

| Mã | Điều kiện |
|---|---|
| `CANONICAL_ALIAS_CONFLICT` | Canonical và alias cùng có nhưng khác theo bộ so sánh đã duyệt |
| `MISSING_CREATED_AT` | Không có canonical hoặc alias thời điểm tạo dùng được |
| `INVALID_FIELD_TYPE` | Trường có mặt nhưng sai kiểu đã chốt |
| `OUTSIDE_APPROVED_VALIDATOR` | Vi phạm validator/range/enum đã được Owner phê duyệt; không dùng cho quy tắc chưa chốt |
| `EVENT_RELATION_MISSING` | Event thiếu `tournament_id` hợp lệ |
| `EVENT_RELATION_ORPHAN` | Event tham chiếu tournament không tồn tại trong phạm vi quan sát |
| `TEST_DATA_MARKER` | Tên khớp quy tắc TEST |

Thiếu canonical nhưng có alias hợp lệ là **migration candidate**, không tự động là conflict. G1 chỉ đếm; việc quarantine cuối cùng và cách reconcile cần quyết định riêng trước G4/G5.

## 6. Kiểm soát PII và đầu ra

### 6.1 Dữ liệu tuyệt đối không được ghi ra

- giá trị `full_name`/`name`, phone, email, birth year, location, note, club hoặc bất kỳ giá trị trường nào;
- document ID, path, reference ID, ID băm, initials, mẫu bản ghi hoặc danh sách lỗi theo record;
- raw document, JSON dump, CSV, screenshot, query response hoặc stack trace chứa dữ liệu;
- tên trường lạ do người dùng có thể kiểm soát;
- credential, token, service-account content, Firebase config đầy đủ hoặc secret-derived value.

### 6.2 Đầu ra duy nhất được phép

Một báo cáo aggregate có schema cố định, gồm:

- `runMetadata`: plan hash, tool commit/SHA, baseline SHA, environment label, hash project/database identifier, thời gian bắt đầu/kết thúc và operator đã được phê duyệt;
- `readBudget`: count sơ bộ, trần document/read/time/cost đã duyệt, số document thực đọc;
- `collections`: các count tại mục 5;
- `drift`: count trước/sau và cảnh báo cửa sổ đọc không nguyên tử;
- `controls`: read-only proof, emulator proof, report schema validation và PII-output scan;
- `result`: `COMPLETE`, `INCOMPLETE`, `STOPPED` hoặc `GATE_HOLD` cùng mã lý do cố định.

Mọi lỗi SDK phải được ánh xạ sang mã cố định như `AUTH_DENIED`, `PROJECT_MISMATCH`, `READ_LIMIT_EXCEEDED`, `TIMEOUT`, `QUERY_FAILED`; không ghi nguyên văn thông báo nếu chưa qua bộ khử dữ liệu.

Chỉ số field/PII là count đơn biến; cấm cross-tab, phân bố giá trị, min/max giá trị nghiệp vụ hoặc truy vấn nhóm nhỏ có thể tái nhận diện. Raw document chỉ tồn tại trong bộ nhớ đủ lâu để tăng counter và không được cache/serialize.

## 7. Thiết kế read-only bắt buộc cho tool tương lai

Chưa có quyền tạo tool. Khi được phê duyệt riêng, tool phải đáp ứng trước khi có quyền đọc Production:

1. Mặc định không có chế độ ghi; không cung cấp `--apply`, migration hoặc code path dùng chung với writer.
2. Allowlist cứng đúng ba collection; không nhận collection tùy ý từ CLI.
3. Xác minh chính xác project ID và database ID theo allowlist do Owner phê duyệt; mismatch thì fail closed.
4. Dùng danh tính/quyền chỉ đọc tối thiểu; không lưu credential trong repository hoặc báo cáo.
5. Cấm mọi API `create`, `set`, `update`, `delete`, transaction write, batch write, BulkWriter, import/export, deploy và mutation endpoint.
6. Kiểm toán tĩnh source + test synthetic/emulator phải chứng minh `0` write trước Production.
7. Query theo trang có giới hạn, không realtime listener, không recursive traversal và không retry vô hạn.
8. Bước đầu chỉ lấy count sơ bộ. Full scan chỉ tiếp tục khi cả ba collection nằm dưới trần đã duyệt.
9. Dừng khi số document/read, thời gian, lỗi hoặc chi phí ước tính vượt ngưỡng; không tự tăng ngưỡng.
10. Báo cáo phải qua schema validator và PII-output scanner bằng fixture tổng hợp trước khi được xem là bằng chứng.

Repository hiện hành có rules cục bộ `allow read: if true` cho `players`, `tournaments`, `events`. Đây chỉ là bằng chứng tĩnh; chưa xác minh rules đang deploy. Dù Production có cho đọc công khai, không được dùng điều đó để bỏ qua phê duyệt, project allowlist hoặc kiểm soát PII. Rủi ro rules/PII thuộc nhánh TD-04/security review riêng.

## 8. Chuỗi phê duyệt tách biệt

| Pha | Nội dung | Trạng thái hiện tại |
|---|---|---|
| G1-P0 | Lập và duyệt hồ sơ phạm vi cục bộ | ACCEPTED — Owner nghiệm thu ngày 2026-08-05; chỉ được chuẩn bị commit cục bộ của tệp tài liệu này |
| G1-P1 | Tạo tool chỉ đọc và fixtures tổng hợp trong workspace cô lập | Chưa được phép |
| G1-P2 | Kiểm toán source, unit test và emulator proof `0` write | Chưa được phép |
| G1-P3 | Count-only preflight trên đúng Production project | Chưa được phép |
| G1-P4 | Owner duyệt trần đọc/chi phí/thời gian dựa trên count | Chưa được phép |
| G1-P5 | Chạy full aggregate inventory một lần | Chưa được phép |
| G1-P6 | Kiểm toán báo cáo, xử lý gate hold và trình đóng G1 | Chưa được phép |

Không pha nào tự cấp quyền cho pha kế tiếp. Quyền tạo tool không phải quyền chạy tool; count-only không phải full scan; full scan không phải migration.

## 9. Stop conditions

Dừng ngay, không truy vấn tiếp và không tự khắc phục nếu có một trong các điều kiện:

- baseline repository chính không còn đúng SHA Owner đã phê duyệt hoặc working tree không sạch tại thời điểm lấy source;
- project ID/database ID/môi trường chưa được Owner xác nhận chính xác hoặc mismatch allowlist;
- tool/source hash khác bản đã kiểm toán;
- phát hiện write-capable API, đường code migration, dependency/script không rõ tác dụng hoặc quyền IAM vượt mức đã duyệt;
- cần in raw error, document, ID, PII hoặc giá trị để chẩn đoán;
- count sơ bộ hoặc ước tính chi phí vượt trần Owner duyệt;
- full scan vượt read/time/error budget, bị rate-limit kéo dài hoặc kết quả không đầy đủ;
- collection xuất hiện ngoài allowlist hoặc cần recursive/subcollection read;
- count trước/sau thay đổi ngoài ngưỡng Owner duyệt, khiến báo cáo không đủ tin cậy;
- report schema/PII scan thất bại;
- có yêu cầu chạy script migration cũ, backup/restore, deploy, sửa rules hoặc ghi dữ liệu;
- phát hiện canonical–alias conflict nhưng chưa có quyết định xử lý để chuyển gate sau.

Khi dừng, chỉ xuất trạng thái aggregate đã được khử dữ liệu và mã lý do; không tự retry bằng quyền rộng hơn.

## 10. Tiêu chí nghiệm thu G1 tương lai

Inventory chỉ được coi là hoàn tất về mặt thu thập khi:

- đúng project/database và đúng ba collection đã được chứng minh;
- `DOC_SCANNED == DOC_TOTAL` cho từng collection, hoặc báo cáo rõ `INCOMPLETE` và G1 không đạt;
- báo cáo có đủ field coverage, alias/conflict, quarantine, TEST và event relation counts;
- read budget không vượt ngưỡng;
- bằng chứng `0` write, schema validation và PII-output scan đều đạt;
- không có raw value, record ID hoặc dữ liệu cá nhân trong artifact/log;
- checksum của plan, tool và báo cáo được ghi nhận;
- hạn chế về cửa sổ đọc/concurrent update được nêu rõ.

Phân biệt hai trạng thái:

- `G1 INVENTORY COMPLETE`: thu thập hợp lệ nhưng có thể còn conflict/quarantine.
- `G1 GATE PASSED`: chỉ khi mọi canonical–alias conflict đã có quyết định được Owner phê duyệt và không còn stop condition mở.

Nếu conflict/quarantine lớn hơn 0, không tự sửa và không chuyển G2/G4/G5. G1 có thể ở `GATE_HOLD` sau khi inventory hoàn tất.

## 11. Quyết định Owner đã chốt và còn cần chốt trước G1-P1/P3

Qua nghiệm thu G1-P0 ngày 2026-08-05, Owner đã chấp nhận:

1. Chính xác ba collection `players`, `tournaments`, `events` trong phạm vi và danh sách ngoài phạm vi tại mục 4.
2. Bộ so sánh tên: exact, trim-equal, còn lại conflict; không fuzzy match.
3. Ranh giới đầu ra aggregate, kiểm soát PII, chuỗi phê duyệt tách biệt và stop conditions trong hồ sơ này.

Các tham số vận hành sau vẫn phải được chốt bằng phê duyệt riêng trước pha tương ứng:

1. Xác nhận project ID, database ID và environment bằng kênh kiểm soát phù hợp.
2. Chọn operator/cơ chế danh tính chỉ đọc và cách chứng minh quyền tối thiểu.
3. Chốt trần count/full-scan theo document, read, thời gian và chi phí; chưa tự đặt số.
4. Chốt validator còn thiếu, đặc biệt kiểu/requiredness/enum/range của tournament.
5. Chốt nơi lưu, thời hạn giữ và người được xem báo cáo aggregate.
6. Chốt ngưỡng drift/error được phép; nếu chưa chốt thì bất kỳ drift/error nào cũng là stop.

Giá và cách tính Firestore phải được đối chiếu tài liệu Google Cloud hiện hành ở thời điểm xin quyền chạy; hồ sơ này không ước lượng chi phí khi chưa có count và cấu hình Production.

## 12. Sổ bằng chứng của pha chuẩn bị hiện tại

| ID | Bằng chứng | Nguồn | Mức xác minh | Kết quả |
|---|---|---|---|---|
| G1P-E01 | G0 đã được Owner báo cáo áp dụng/push tại `4740e383...` | Kết quả Git do Owner cung cấp | Owner-reported | Đủ làm baseline quản trị; chưa fetch remote |
| G1P-E02 | Workspace kế hoạch bắt đầu từ nội dung G0 cục bộ `aa11296...` | Git cục bộ | Xác minh cục bộ | Đạt; SHA lịch sử khác Production đã ghi rõ |
| G1P-E03 | TD-06A xác định G1 là inventory chỉ đọc, count/field/xung đột, không PII | TD-06A | Xác minh cục bộ | Đạt |
| G1P-E04 | TD-06B yêu cầu aggregate counts, field coverage, conflict/quarantine counts | TD-06B | Xác minh cục bộ | Đạt |
| G1P-E05 | `settings/adminData`/localStorage thuộc ranh giới TD-09 | TD-06A/TD-06B/TECH_DEBT | Xác minh cục bộ | Loại khỏi phạm vi G1 này |
| G1P-E06 | Rules repository cho phép public read ba collection, nhưng trạng thái deploy chưa xác minh | `firestore.rules` | Xác minh tĩnh cục bộ | Rủi ro cần TD-04/security review; không suy ra Production |
| G1P-E07 | Không có Firebase/Production/tool/code/data/commit/push/deploy/migration trong pha chuẩn bị | Nhật ký phạm vi phiên | Bằng chứng âm tính theo quy trình | Đúng ranh giới hiện tại |
| G1P-E08 | Owner nghiệm thu hồ sơ G1-P0 và cho phép chuẩn bị commit cục bộ duy nhất tệp tài liệu ngày 2026-08-05 | Quyết định Owner | Owner-approved | Đạt; không cấp quyền G1-P1, Production hoặc tạo commit |

## 13. Kết luận hiện tại

Hồ sơ G1-P0 đã được Owner nghiệm thu ngày 2026-08-05. **G1 vẫn chưa khởi động**, chưa có tool và chưa có số liệu Production. Quyền hiện tại chỉ cho phép chuẩn bị commit cục bộ của duy nhất tệp tài liệu này; việc tạo commit vẫn cần Owner phê duyệt chính xác. Bước nghiệp vụ kế tiếp chỉ có thể là xin quyền riêng cho G1-P1 để tạo tool chỉ đọc với fixture tổng hợp trong workspace cô lập; không được suy diễn thành quyền chạy tool hoặc truy cập Firebase/Production.
