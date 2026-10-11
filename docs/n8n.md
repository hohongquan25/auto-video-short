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
 "backgroundId":"<id video nền>","reviewBeforeTts":false,"minPartSec":120,"maxPartSec":300}
```

Lấy `styleId` từ `GET /api/styles` và `backgroundId` từ `GET /api/backgrounds`. Giọng đọc: `vi-VN-HoaiMyNeural` (nữ) hoặc `vi-VN-NamMinhNeural` (nam). `aiProvider` là `claude` hoặc `gemini`.

**Tạo job từ link video** (YouTube, TikTok, Facebook…) thay vì tải file: gửi Body **JSON**, Story Studio tự tải phần âm thanh về:

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "title": "",
  "callbackUrl": "{{ $execution.resumeUrl }}",
  "settings": { "styleId": "ke-chuyen-cuon-hut", "aiProvider": "claude", "voice": "vbee:hn_female_ngochuyen_full_48k-fhg",
                "rate": "+0%", "backgroundId": "<id>", "reviewBeforeTts": false, "minPartSec": 120, "maxPartSec": 300 }
}
```

`title` để trống thì tự lấy tiêu đề video. Link sai, video riêng tư hoặc trang đòi đăng nhập sẽ bị từ chối ngay (HTTP 400, kèm lý do). Muốn kiểm tra link trước khi tạo job thì gọi `POST /api/sources/probe` với `{"url": "..."}`.

**Chờ.** Wait node, Resume = **On Webhook Call**, HTTP Method = POST. Story Studio gọi `callbackUrl` khi job xong, lỗi hoặc chờ duyệt, và workflow chạy tiếp với dữ liệu:

```json
{
  "event": "job.done",            // hoặc "job.failed", "job.waiting_review"
  "job": { "id": "...", "title": "...", "status": "done", "error": null, "parts": [...] },
  "links": {
    "page": "http://host.docker.internal:5178/jobs/<id>",
    "parts": [
      { "index": 1, "durationSec": 111.1,
        "video": "http://host.docker.internal:5178/files/jobs/<id>/parts/part-01.mp4",
        "text":  "http://host.docker.internal:5178/files/jobs/<id>/parts/part-01.txt" }
    ]
  }
}
```

**Tải video.** Dùng Split Out trên `body.links.parts`, rồi HTTP Request `GET {{ $json.video }}` (có Header Auth, Response Format = File). Sau đó đưa file sang YouTube, Drive, Telegram…

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
