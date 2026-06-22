# Hướng dẫn Setup YouTube API & Quản lý Video — AMZ Pickleball

Tài liệu này hướng dẫn chi tiết cách tạo YouTube API Key, cấu hình GitHub Secrets để tự động quét video và cách cập nhật ID video thật vào website để người dùng có thể phát trực tiếp trên giao diện.

---

## Bước 1: Tạo YouTube API Key tại Google Cloud Console

Để website hoặc các kịch bản quét tự động có thể tìm kiếm và lấy thông tin video từ YouTube, bạn cần tạo một API Key từ Google Cloud.

1. **Truy cập Google Cloud Console**:
   - Vào **[Google Cloud Console](https://console.cloud.google.com/)** và đăng nhập bằng tài khoản Google của bạn (nên dùng chung tài khoản quản trị `goldmenvt@gmail.com`).

2. **Tạo Project mới (nếu chưa có)**:
   - Click vào dropdown chọn project ở góc trên bên trái màn hình.
   - Chọn **"New Project"** (Dự án mới) -> Đặt tên: **"AMZ Pickleball"** -> Click **"Create"** (Tạo).

3. **Bật YouTube Data API v3**:
   - Sử dụng thanh tìm kiếm ở đầu trang, gõ **"YouTube Data API v3"** và chọn kết quả tương ứng.
   - Click vào nút **"Enable"** (Bật) để kích hoạt API cho project.

4. **Tạo API Key**:
   - Sau khi bật API, vào menu bên trái: **APIs & Services** (APIs & Dịch vụ) → **Credentials** (Thông tin xác thực).
   - Click **"+ Create Credentials"** (Tạo thông tin xác thực) ở menu trên cùng → Chọn **"API key"** (Khóa API).
   - Một cửa sổ pop-up hiện lên chứa mã khóa của bạn (ví dụ: `AIzaSyA1...`). Hãy **sao chép (Copy)** khóa này để sử dụng ở các bước sau.

5. **Bảo mật API Key (Khuyến nghị)**:
   - Tại trang Credentials, click vào tên khóa vừa tạo (hoặc click vào icon bút chì để Edit).
   - Tại phần **API restrictions** (Hạn chế API): Chọn **"Restrict key"** (Hạn chế khóa).
   - Trong danh sách dropdown, tick chọn **YouTube Data API v3**.
   - Click **"Save"** (Lưu). Việc này giúp ngăn chặn việc sử dụng khóa API này vào các mục đích khác ngoài YouTube.

---

## Bước 2: Thêm GitHub Secret trong Repository Settings

GitHub Action của dự án sử dụng API Key này để quét các video liên quan đến CLB hàng ngày và đề xuất vào website mà không làm lộ key ra mã nguồn công cộng.

1. **Truy cập Repository trên GitHub**:
   - Vào trang GitHub chứa dự án của bạn (ví dụ: `https://github.com/goldmenvt-svg/amz-pickleball`).

2. **Vào phần Cấu hình bảo mật**:
   - Click vào tab **"Settings"** (Cài đặt) ở menu ngang phía trên.
   - Ở cột menu bên trái, tìm mục **"Secrets and variables"** (Bảo mật và biến) → Chọn **"Actions"**.

3. **Thêm Secret mới**:
   - Click vào nút **"New repository secret"** (Khóa bảo mật kho lưu trữ mới).
   - Nhập các thông tin sau:
     * **Name**: `YOUTUBE_API_KEY` (Phải ghi chính xác chữ in hoa).
     * **Secret**: Dán (Paste) mã **API Key** đã copy ở Bước 1.
   - Click nút **"Add secret"** (Thêm khóa bảo mật).

> [!NOTE]
> File workflow định kỳ tại [.github/workflows/video-scan.yml](file:///d:/website%20test/.github/workflows/video-scan.yml) sẽ tự động chạy mỗi ngày lúc **03:00 UTC** (10:00 sáng giờ Việt Nam) để tìm kiếm các video mới khớp với từ khóa CLB, lưu vào hàng đợi của file `data/videos.json`.

---

## Bước 3: Thay thế Video thật vào Website

Hiện tại, các video hiển thị trên giao diện trang chủ đang sử dụng dữ liệu mẫu (mock data). Khi bạn có video thật, hãy thay thế ID để người dùng có thể click phát video ngay trên web.

### 1. Cách lấy YouTube Video ID thật:
YouTube ID là chuỗi ký tự dài 11 ký tự nằm sau phần `v=` trong đường dẫn video hoặc sau dấu gạch chéo cuối cùng:
- URL đầy đủ: `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → Video ID là: **`dQw4w9WgXcQ`**
- URL rút gọn: `https://youtu.be/dQw4w9WgXcQ` → Video ID là: **`dQw4w9WgXcQ`**

### 2. Sửa file `data/videos.json`:
Mở file [data/videos.json](file:///d:/website%20test/data/videos.json) và cập nhật thông tin của video bạn muốn đổi:

```json
{
  "id": "yt_dQw4w9WgXcQ", 
  "platform": "youtube",
  "platformId": "dQw4w9WgXcQ", 
  "title": "Tên video thực tế của bạn",
  "description": "Mô tả ngắn gọn về trận đấu hoặc nội dung video...",
  "channelTitle": "Tên kênh YouTube đăng tải",
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
  "duration": "10:15",
  "publishedAt": "2026-06-22",
  "viewCount": 5000,
  "priority": 1,
  "badge": "Thi đấu",
  "status": "approved",
  "addedAt": "2026-06-22T14:00:00Z",
  "approvedAt": "2026-06-22T14:30:00Z"
}
```

*Lưu ý các trường quan trọng:*
- `platformId`: Bắt buộc phải là **YouTube Video ID thật** (ví dụ: `dQw4w9WgXcQ`).
- `status`: Phải để là `"approved"` thì video mới được hiển thị lên trang chủ.
- `thumbnail`: Bạn có thể dùng ảnh tĩnh trên server hoặc đường dẫn ảnh trực tiếp từ YouTube: `https://i.ytimg.com/vi/<ID_VIDEO>/mqdefault.jpg`.

---

## Bước 4: Quy trình quét video tự động & Duyệt hiển thị

Hệ thống đã có sẵn script quét video tự động [scripts/video-discover.js](file:///d:/website%20test/scripts/video-discover.js). Bạn có thể kích hoạt quét thủ công bất cứ lúc nào thay vì đợi đến giờ chạy định kỳ.

### 1. Kích hoạt quét thủ công trên GitHub:
1. Vào tab **"Actions"** trên repository GitHub của bạn.
2. Tại cột bên trái, click chọn workflow **"Video Discovery Scan"**.
3. Ở phía bên phải, click vào dropdown **"Run workflow"** → Click nút **"Run workflow"** màu xanh.
4. Chờ 1-2 phút, GitHub Action sẽ tự động quét các từ khóa liên quan đến AMZ Pickleball, ghi các video tìm được vào [data/videos.json](file:///d:/website%20test/data/videos.json) và commit/push ngược lại mã nguồn.

### 2. Duyệt video để hiển thị lên Website:
Mặc định, các video mới do bot tự động quét sẽ được lưu ở trạng thái chờ duyệt để đảm bảo nội dung phù hợp:
```json
"status": "pending"
```
Để hiển thị video này lên website:
1. Mở file [data/videos.json](file:///d:/website%20test/data/videos.json).
2. Tìm video bạn muốn duyệt trong danh sách.
3. Đổi `"status": "pending"` thành `"status": "approved"`.
4. Bổ sung trường `"approvedAt": "2026-06-22T10:00:00Z"` (thời gian duyệt hiện tại).
5. Lưu file, commit và push lên GitHub. Website sẽ tự động cập nhật và phát được video mới.
