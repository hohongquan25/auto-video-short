# Dùng Story Studio từ n8n (Docker trên cùng máy)

## 1. Cấu hình Story Studio

Thêm vào `.env.local` rồi khởi động lại server:

```env
# Tạo token: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
API_TOKEN=<chuỗi ngẫu nhiên>
# Link video trong webhook/API sẽ dùng địa chỉ này, để n8n trong container tải được
PUBLIC_URL=http://host.docker.internal:5178
```

Trong container, n8n gọi Story Studio qua `http://host.docker.internal:5178`. Luôn dùng cổng **5178** (server API), không dùng 5179 (giao diện dev).

Nếu n8n báo `ECONNREFUSED`, nghĩa là Docker không vào được server đang chỉ mở cho máy này. Khi đó thêm `HOST=0.0.0.0`. Server sẽ nhận kết nối từ mạng ngoài nên bắt buộc phải có `API_TOKEN`, và server sẽ từ chối khởi động nếu thiếu. Windows có thể hỏi quyền tường lửa cho node.exe: chỉ cho phép mạng **Private**.

Quy tắc xác thực:
- Request từ chính máy này (trình duyệt) không cần token.
- Mọi request khác phải gửi `Authorization: Bearer <API_TOKEN>` (hoặc `X-API-Key: <API_TOKEN>`).

Trong n8n, tạo credential **Header Auth** với Name `Authorization` và Value `Bearer <API_TOKEN>`, rồi dùng cho mọi node HTTP Request bên dưới.

## 2. Workflow mẫu

```
[Trigger] → [HTTP Request: tạo job] → [Wait: On Webhook Call] → [IF event = job.done] → [HTTP Request: tải video] → ...
```

**Tạo job.** HTTP Request, `POST http://host.docker.internal:5178/api/jobs`, Body Content Type **Form-Data**:

| Tên | Kiểu | Giá trị |
|---|---|---|
| `media` | n8n Binary File | file video/audio truyện |
| `title` | Text | tên truyện |
| `callbackUrl` | Text | `{{ $execution.resumeUrl }}` |
| `settings` | Text | JSON bên dưới |

```json
{"styleId":"ke-chuyen-cuon-hut","aiProvider":"claude","voice":"vi-VN-HoaiMyNeural","rate":"+0%",
 "backgroundIds":["<id video nền>"],"reviewBeforeTts":false,"subtitles":true,"fullVideo":true,"formats":["tiktok","youtube"],"fit":"blur","minPartSec":120,"maxPartSec":300}
```

Lấy `styleId` từ `GET /api/styles` và id video nền từ `GET /api/backgrounds`. `backgroundIds` là danh sách video nền được ghép ngẫu nhiên (chỉ lặp lại khi đã dùng hết); bỏ trường này thì dùng cả thư viện. Workflow cũ gửi `"backgroundId"` (một id) vẫn chạy được. Giọng đọc: `vi-VN-HoaiMyNeural` (nữ) hoặc `vi-VN-NamMinhNeural` (nam), hoặc giọng OlvRoc miễn phí dạng `olvroc:<tên giọng>` (ví dụ `olvroc:Hải Đăng`, danh sách đầy đủ trong `voices` của `GET /api/meta`). `aiProvider` là `claude` hoặc `gemini`. `formats` là danh sách một hoặc nhiều định dạng: `tiktok` (dọc 1080×1920), `youtube` (ngang 1920×1080), `original` (giữ khung video nền, mặc định). Mỗi định dạng ra một bộ video riêng; khi có cả `tiktok` và `youtube` thì YouTube chỉ ra một video dài cả truyện, không chia phần. Workflow cũ gửi `"format": "tiktok"` (một giá trị) vẫn chạy được; `fit` là `blur` (nền mờ, mặc định) hoặc `crop` (cắt cho đầy khung).

**Tạo job từ link video** (YouTube, TikTok, Facebook…) thay vì tải file: gửi Body **JSON**, Story Studio tự tải phần âm thanh về:

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "title": "",
  "callbackUrl": "{{ $execution.resumeUrl }}",
  "settings": { "styleId": "ke-chuyen-cuon-hut", "aiProvider": "claude", "voice": "olvroc:Hải Đăng",
                "rate": "+0%", "backgroundIds": ["<id>"], "reviewBeforeTts": false, "subtitles": true, "fullVideo": true, "formats": ["tiktok", "youtube"], "fit": "blur", "minPartSec": 120, "maxPartSec": 300 }
}
```

`title` để trống thì tự lấy tiêu đề video. Link sai, video riêng tư hoặc trang đòi đăng nhập sẽ bị từ chối ngay (HTTP 400, kèm lý do). Muốn kiểm tra link trước khi tạo job thì gọi `POST /api/sources/probe` với `{"url": "..."}`.

**Để AI tự viết truyện theo chủ đề**: gửi Body **JSON** có `topic` thay cho `url`. AI lập dàn ý theo chương rồi viết từng chương. `minMinutes`–`maxMinutes` là độ dài giọng đọc mong muốn (3–120 phút):

```json
{
  "topic": { "prompt": "Truyện ma làng quê miền Tây, một cô giáo trẻ về dạy ở ngôi trường cũ bên sông…", "minMinutes": 30, "maxMinutes": 45 },
  "title": "",
  "callbackUrl": "{{ $execution.resumeUrl }}",
  "settings": { "styleId": "ke-chuyen-cuon-hut", "aiProvider": "claude", "voice": "vi-VN-HoaiMyNeural",
                "rate": "+0%", "backgroundIds": ["<id>"], "reviewBeforeTts": false, "subtitles": true, "fullVideo": true, "formats": ["tiktok", "youtube"], "fit": "blur", "minPartSec": 120, "maxPartSec": 300 }
}
```

`title` để trống thì dùng tên truyện do AI đặt.

**Chờ.** Wait node, Resume = **On Webhook Call**, HTTP Method = POST. Story Studio gọi `callbackUrl` khi job xong, lỗi hoặc chờ duyệt, và workflow chạy tiếp với dữ liệu:

```json
{
  "event": "job.done",            // hoặc "job.failed", "job.waiting_review"
  "job": { "id": "...", "title": "...", "status": "done", "error": null, "outputs": [...] },
  "links": {
    "page": "http://host.docker.internal:5178/jobs/<id>",
    "outputs": [
      { "format": "tiktok",
        "parts": [
          { "index": 1, "durationSec": 111.1,
            "video": "http://host.docker.internal:5178/files/jobs/<id>/parts/tiktok/part-01.mp4",
            "text":  "http://host.docker.internal:5178/files/jobs/<id>/parts/tiktok/part-01.txt",
            "cover": "http://host.docker.internal:5178/files/jobs/<id>/parts/tiktok/part-01.jpg",
            "post":  { "title": null, "description": "Tiêu đề | Phần 1/5\n\nCâu nhử…\n\n#truyenaudio #fyp", "tags": [] } }
        ],
        "full": { "durationSec": 560.4, "video": ".../parts/tiktok/full.mp4", "text": ".../parts/tiktok/full.txt" } },
      { "format": "youtube", "parts": [],
        "full": { "durationSec": 560.4, "video": ".../parts/youtube/full.mp4", "text": ".../parts/youtube/full.txt" } }
    ],
    "parts": [...],   // bằng outputs[0].parts
    "full": {...}     // bằng outputs[0].full
  }
}
```

Mỗi định dạng đã chọn là một phần tử trong `links.outputs`. `full` là video cả truyện: bản ghép các phần (khi bật `fullVideo`), hoặc video duy nhất của YouTube khi chọn cùng TikTok. `links.parts` và `links.full` giữ lại cho workflow cũ, trỏ tới định dạng đầu tiên.

**Gợi ý đăng bài.** Sau khi dựng xong, bước "Gợi ý đăng bài" cho AI của job đọc cả truyện, xác định ngách truyện và tìm trên web các truyện, kênh cùng ngách (kết quả ở `job.publish.niche`), rồi viết tiêu đề, mô tả, hashtag (và tiêu đề, mô tả, thẻ YouTube nếu có định dạng YouTube), rồi vẽ ảnh bìa JPG cho từng video. Mỗi video trong `links` có:

- `cover`: link ảnh bìa.
- `post`: nội dung để dán khi đăng. Với TikTok, `title` là `null` và `description` đã gồm tiêu đề, câu nhử của phần đó và hashtag. Với YouTube, `title`, `description`, `tags` tách riêng.

Bộ gợi ý đầy đủ (nhiều tiêu đề, mô tả, hashtag…) nằm ở `job.publish`. AI lỗi thì job vẫn xong, gợi ý được lấy từ tên truyện (`job.publish.by` là `null`). Tạo lại gợi ý: `POST /api/jobs/{id}/rerun` với `{"fromStep": "publish"}`.

**Tải video.** Dùng Split Out trên `body.links.parts` (hoặc `body.links.outputs[1].full` cho bản YouTube), rồi HTTP Request `GET {{ $json.video }}` (có Header Auth, Response Format = File). Sau đó đưa file sang YouTube, Drive, Telegram…

Muốn mọi job (kể cả job tạo từ giao diện) đều báo về một workflow cố định, đặt `WEBHOOK_URL` trong `.env.local` trỏ tới một Webhook node của n8n, ví dụ `http://localhost:5678/webhook/story-studio`. Story Studio chạy trên máy chủ nên gọi n8n qua cổng đã publish của container.

## 3. Các API khác

| Việc | Request |
|---|---|
| Xem job (kèm `links`) | `GET /api/jobs/{id}` |
| Danh sách job | `GET /api/jobs` |
| Sửa kịch bản khi chờ duyệt | `PUT /api/jobs/{id}/script` với `{"script": "..."}` |
| Duyệt và chạy tiếp | `POST /api/jobs/{id}/continue` |
| Chạy lại (từ bước lỗi hoặc một bước) | `POST /api/jobs/{id}/rerun` với `{}` hoặc `{"fromStep": "tts"}` |
| Dừng / xoá | `POST /api/jobs/{id}/stop` / `DELETE /api/jobs/{id}` |
| Đổi tên | `PATCH /api/jobs/{id}` với `{"title": "..."}` |
| Tóm tắt video | `POST /api/summaries`: file video ở trường `media` (kèm phụ đề `.srt`/`.vtt` ở `captions` nếu có) hoặc link ở `url`, cài đặt ở `settings` (xem dưới) |

Cài đặt tóm tắt, trường nào bỏ trống thì lấy mặc định:

```json
{"targetSec": 300, "language": "", "useCaptions": true, "subtitles": "none", "summaryLanguage": "vi", "format": "original", "fit": "blur", "aiProvider": "claude"}
```

`language` là ngôn ngữ video nói (`""` để tự nhận), `subtitles` là `none`, `source` (theo lời nói) hoặc mã ngôn ngữ để dịch phụ đề sang (`vi`, `en`…). Job tóm tắt dùng chung các API xem, chạy lại, dừng, xoá ở trên. Khi xong, `links.summary` có link video rút gọn và bản tóm tắt; chạy lại với cài đặt mới: `POST /api/jobs/{id}/rerun` với `{"fromStep": "summarize", "summary": {...}}`.

Webhook bị lỗi (n8n tắt…) được thử lại 3 lần rồi ghi cảnh báo vào nhật ký job. Job vẫn hoàn thành bình thường.

## 4. Tự lưu video lên Google Drive và Google Sheet

Khi đã cấu hình Google, mỗi job chạy thêm bước cuối **"Lưu lên Drive"** sau bước gợi ý đăng bài:

1. Tạo một thư mục con `<tên truyện> · <id job>` trong thư mục Drive gốc, tải lên mọi video và ảnh bìa (`tiktok-part-01.mp4`, `tiktok-part-01.jpg`, `youtube-full.mp4`…).
2. Ghi **mỗi video một dòng** vào Google Sheet với `status = pending`.

n8n không cần gọi vào Story Studio nữa: chỉ cần đọc Sheet theo lịch, đăng những dòng `pending` rồi đổi trạng thái. Máy chạy n8n cũng không cần thấy máy chạy Story Studio.

### Cấu hình

**Cách 1: tài khoản Google của bạn (OAuth, dùng được với Gmail thường)**

1. Vào [Google Cloud Console](https://console.cloud.google.com/), tạo (hoặc chọn) một project.
2. **APIs & Services → Library**: bật **Google Drive API** và **Google Sheets API**.
3. **OAuth consent screen**: User type **External**, điền tên app và email. Ở mục Audience/Publishing status bấm **Publish app** (chuyển sang *In production*). Nếu để *Testing*, Google sẽ huỷ kết nối sau 7 ngày. App chưa xác minh vẫn dùng bình thường, Google chỉ hiện cảnh báo "Google hasn't verified this app": bấm **Advanced → Go to … (unsafe)**.
4. **Credentials → Create credentials → OAuth client ID**, loại **Desktop app**. Chép Client ID và Client secret vào `.env.local`:

   ```env
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
   # Tuỳ chọn: dán link/id thư mục và bảng tính có sẵn. Để trống thì tự tạo.
   GOOGLE_DRIVE_FOLDER_ID=
   GOOGLE_SHEET_ID=
   ```

5. Khởi động lại server, mở giao diện **trên chính máy chạy server**, bấm **Google Drive & Sheet** ở khung Hệ thống (hoặc nút **Kết nối Google**) rồi đăng nhập tài khoản sẽ chứa video. Đổi tài khoản: bấm lại, chọn tài khoản khác.

**Cách 2: service account (Google Workspace có Shared Drive)**

Service account không có dung lượng Drive riêng nên chỉ tải lên được **Shared Drive**.

1. Bật Drive API và Sheets API như trên, tạo **Service account**, tạo khoá **JSON** và lưu file vào máy (ví dụ `secrets/google-sa.json`, đừng commit).
2. Thêm email service account (`...@...iam.gserviceaccount.com`) làm thành viên quyền **Content manager** của Shared Drive, và chia sẻ quyền **Editor** của bảng tính cho email đó.
3. Trong `.env.local`:

   ```env
   GOOGLE_SERVICE_ACCOUNT_FILE=secrets/google-sa.json
   GOOGLE_DRIVE_FOLDER_ID=https://drive.google.com/drive/folders/<id thư mục trong Shared Drive>
   GOOGLE_SHEET_ID=https://docs.google.com/spreadsheets/d/<id bảng tính>/edit
   ```

Khung Hệ thống báo xanh ở **Google Drive & Sheet** là đã sẵn sàng; nếu đỏ thì di chuột vào để xem lỗi (sai id, chưa chia sẻ quyền…).

### Các cột trong Sheet

Mỗi dòng là một video. Dòng tiêu đề được tạo tự động ở tab `GOOGLE_SHEET_TAB` (mặc định `Videos`).

| Cột | Ý nghĩa |
|---|---|
| `id` | Mã duy nhất của video, ví dụ `20261015-101010-abcdef-tiktok-p01`. Dùng làm khoá khi n8n cập nhật dòng |
| `uploaded_at` | Thời điểm tải lên (ISO, giờ UTC) |
| `job_id`, `title` | Job và tên truyện |
| `format` | `tiktok`, `youtube` hoặc `original` |
| `kind` | `part` (một phần) hoặc `full` (cả truyện) |
| `part`, `total_parts` | Phần thứ mấy trên tổng số phần (trống với `full`) |
| `duration_sec` | Độ dài video (giây) |
| `video_file_id`, `video_url` | Id và link Drive của video. n8n tải file bằng id này |
| `cover_file_id`, `cover_url` | Ảnh bìa |
| `post_title` | Tiêu đề khi đăng (YouTube). TikTok để trống vì tiêu đề nằm trong mô tả |
| `post_description` | Mô tả để dán khi đăng. Với TikTok đã gồm tiêu đề, câu nhử và hashtag |
| `tags` | Thẻ YouTube, cách nhau bằng dấu phẩy |
| `hashtags` | Hashtag của truyện |
| `folder_url` | Thư mục Drive của job |
| `status` | `pending` khi mới thêm. **n8n quản lý** từ cột này trở đi |
| `scheduled_at` | Để trống; bạn hoặc n8n điền giờ muốn đăng |
| `posted_at`, `post_url`, `note` | Để n8n ghi lại sau khi đăng |

Story Studio **không bao giờ ghi đè** các cột từ `status` trở đi của một dòng đã có. Chạy lại job (ví dụ "Tạo lại gợi ý") chỉ cập nhật các cột phía trước và thay nội dung file trên Drive (giữ nguyên id và link). Nếu dựng lại khiến số phần thay đổi, video thừa được chuyển vào thùng rác Drive và dòng của nó (nếu còn `pending`) đổi thành `removed`.

Job cũ (làm trước khi cấu hình Google) có thể đẩy lên bằng cách chạy lại từ bước **Lưu lên Drive** ở tab Cài đặt của job, hoặc `POST /api/jobs/{id}/rerun` với `{"fromStep": "upload"}`.

Webhook `job.done` cũng có thêm thông tin Drive: `job.drive`, `links.driveFolder`, `links.sheet`, và mỗi video trong `links.outputs` có `drive: { video, videoId, cover }`.

### Workflow n8n mẫu: đăng video theo lịch

```
[Schedule Trigger] → [Google Sheets: Get row(s)] → [Limit 1] → [Google Drive: Download] → [Đăng lên nền tảng] → [Google Sheets: Update row]
```

1. **Schedule Trigger**: ví dụ mỗi 3 giờ.
2. **Google Sheets → Get row(s) in sheet**: chọn bảng tính và tab `Videos`, Filters: `status` = `pending` (thêm `format` = `tiktok` nếu workflow này chỉ đăng TikTok). Nếu dùng `scheduled_at`, thêm node **Filter** giữ dòng có `scheduled_at` trống hoặc `{{ DateTime.fromISO($json.scheduled_at) <= $now }}`.
3. **Limit**: Max Items = 1 (mỗi lần chạy đăng một video). Muốn đăng đúng thứ tự phần, đặt node **Sort** theo `job_id`, `part` trước Limit.
4. **Google Drive → Download file**: File = By ID `{{ $json.video_file_id }}`. Ra dữ liệu nhị phân `data`.
5. **Đăng**: node YouTube (**Upload a video**: Title `{{ $('Limit').item.json.post_title }}`, Description `post_description`, Tags `tags`), hoặc HTTP Request tới API của TikTok/Facebook với file nhị phân và `post_description` làm caption.
6. **Google Sheets → Update row in sheet**: Column to match on = `id`, giá trị `{{ $('Limit').item.json.id }}`; đặt `status` = `posted`, `posted_at` = `{{ $now.toISO() }}`, `post_url` = link bài vừa đăng. Nên thêm nhánh lỗi (Settings → On Error → Continue (using error output)) ghi `status` = `error` và `note` = thông báo lỗi để lần sau không đăng lại mãi.

Credential **Google Sheets OAuth2** và **Google Drive OAuth2** của n8n cần dùng tài khoản có quyền xem thư mục và sửa bảng tính (cách 1: chính tài khoản đã kết nối; cách 2: tài khoản là thành viên Shared Drive).
