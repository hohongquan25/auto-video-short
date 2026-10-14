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

Webhook bị lỗi (n8n tắt…) được thử lại 3 lần rồi ghi cảnh báo vào nhật ký job. Job vẫn hoàn thành bình thường.
