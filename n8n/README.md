# Workflow n8n đăng video từ Google Sheet

Import trong n8n: menu **⋯ → Import from File**.

| File | Việc |
|---|---|
| `youtube-dang-video.json` | Mỗi ngày 20h đăng 1 video `format = youtube` đang `pending` lên YouTube |
| `tiktok-ket-noi.json` | Chạy tay một lần để kết nối tài khoản TikTok (lưu token vào tab `TikTokAuth`) |
| `tiktok-dang-video.json` | Mỗi giờ (phút 5) từ 7h đến 23h gửi 1 video `format = tiktok` hoặc `original` chưa đăng vào hộp thư TikTok, rồi nhắn Telegram tên, nội dung, hashtag để dán khi đăng (điền `telegram_bot_token`, `telegram_chat_id` ở node **Cấu hình TikTok**; để trống thì không nhắn). Gửi theo thứ tự truyện cũ trước, từng phần một, bỏ qua video trọn bộ (`kind = full`). Từ 0h đến 7h không gửi, không nhắc (sửa giờ ở node **Theo lịch**, nút ⏩ vẫn dùng được). Video chưa kịp đăng trong ngày được gửi tiếp vào hôm sau (truyện cũ trước). Còn video gửi hôm nay ở `inbox` chưa đăng thì không gửi thêm; quá 3 giờ thì nhắc 1 lần. Video vào hộp thư từ ngày trước không chặn nữa (tin Telegram của nó đã bị dọn lúc 0h) Mỗi tin bot gửi được ghi vào tab `TelegramLog`. Bấm **⏩ Gửi tiếp** trong Telegram thì workflow chạy ngay, không đợi lượt mỗi giờ (xem bên dưới) |
| `telegram-don-tin.json` | 0h xoá mọi tin bot đã gửi trong các ngày trước (theo tab `TelegramLog`) và xoá các dòng đó khỏi tab |
| `telegram-nhan-nut-bam.json` | Mỗi phút nhận nút **✅ Đã đăng / ⏭ Bỏ qua** trong tin Telegram, ghi `posted` / `skipped` vào Sheet. Nút **⏩** gọi `tiktok-dang-video.json` (theo id `ssTikTokDangVid1`) để gửi video kế tiếp ngay |
| `telegram-nhac-dang-tiktok.json` | Cách dự phòng khi không dùng API TikTok: chỉ nhắn Telegram link video để tự đăng tay. Không bật cùng `tiktok-dang-video.json` |
| `vps/` | Bộ cài n8n lên VPS (Docker + HTTPS) và cách chuyển dữ liệu từ n8n trên máy, xem `vps/README.md` |
| `github-pages/` | `tiktok.html` (trang nhận mã khi kết nối TikTok) và `terms.html`, đưa lên GitHub Pages |

**Gửi tiếp ngay (không đợi 1 tiếng).** Tin của TikTok có thêm nút **⏩ Đã đăng, gửi tiếp**: ghi `posted` rồi gửi luôn video kế tiếp. Bấm ✅ hoặc ⏭ thì tin đổi thành nút **⏩ Gửi video tiếp ngay** để gửi tiếp lúc nào cũng được. Nút có tác dụng trong khoảng 1 phút (lượt đọc nút bấm kế tiếp), video vào hộp thư sau 1–5 phút. Vẫn giữ quy tắc mỗi lần một video: nếu còn video trong hộp thư chưa đăng, đang có video gửi dở, hoặc hết video, bot nhắn lý do thay vì gửi.

Trạng thái trong cột `status`: `pending` → `posting` → `posted` (YouTube) / `inbox` (TikTok) → `posted` hoặc `skipped` khi bấm nút trong Telegram, hoặc `error` kèm lý do ở `note`.
Đăng lại một video lỗi: sửa `status` về `pending`.

Workflow trỏ tới bảng tính `Story Studio - Video`. Dùng bảng tính khác thì thay link trong các node Google Sheets.
Hướng dẫn cài đặt: docs/n8n.md, mục 4.
