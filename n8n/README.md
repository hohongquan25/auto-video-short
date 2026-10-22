# Workflow n8n đăng video từ Google Sheet

Import trong n8n: menu **⋯ → Import from File**.

| File | Việc |
|---|---|
| `youtube-dang-video.json` | Mỗi ngày 20h đăng công khai 1 video `format = youtube` đang `pending` lên YouTube (truyện cũ trước), dùng tiêu đề, mô tả, thẻ, hashtag AI đã viết, đặt ảnh bìa của video, rồi nhắn Telegram link video (điền `telegram_bot_token`, `telegram_chat_id` ở node **Cấu hình YouTube**; đổi `privacy_status` thành `private` hoặc `unlisted` nếu muốn duyệt trước). Cần credential **YouTube OAuth2 API** của tài khoản giữ kênh, xem mục **Kết nối YouTube** bên dưới |
| `tiktok-ket-noi.json` | Chạy tay một lần để kết nối tài khoản TikTok (lưu token vào tab `TikTokAuth`) |
| `tiktok-dang-video.json` | Mỗi giờ (phút 5) từ 7h đến 23h gửi 1 video `format = tiktok` hoặc `original` chưa đăng vào hộp thư TikTok, rồi nhắn Telegram tên, nội dung, hashtag để dán khi đăng (điền `telegram_bot_token`, `telegram_chat_id` ở node **Cấu hình TikTok**; để trống thì không nhắn). Gửi theo thứ tự truyện cũ trước, từng phần một; đăng hết các phần của một truyện (✅ hoặc ⏭) thì gửi tiếp video trọn bộ (`kind = full`) của truyện đó, rồi mới sang truyện sau. Từ 0h đến 7h không gửi, không nhắc (sửa giờ ở node **Theo lịch**, nút ⏩ vẫn dùng được). Video chưa kịp đăng trong ngày được gửi tiếp vào hôm sau (truyện cũ trước). Còn video gửi hôm nay ở `inbox` chưa đăng thì không gửi thêm; quá 3 giờ thì nhắc 1 lần. Video vào hộp thư từ ngày trước không chặn nữa (tin Telegram của nó đã bị dọn lúc 0h) Mỗi tin bot gửi được ghi vào tab `TelegramLog`. Bấm **⏩ Gửi tiếp** trong Telegram thì workflow chạy ngay, không đợi lượt mỗi giờ (xem bên dưới) |
| `telegram-don-tin.json` | 0h xoá mọi tin bot đã gửi trong các ngày trước (theo tab `TelegramLog`) và xoá các dòng đó khỏi tab |
| `telegram-nhan-nut-bam.json` | Mỗi phút nhận nút **✅ Đã đăng / ⏭ Bỏ qua** trong tin Telegram, ghi `posted` / `skipped` vào Sheet. Nút **⏩** gọi `tiktok-dang-video.json` (theo id `ssTikTokDangVid1`) để gửi video kế tiếp ngay |
| `telegram-nhac-dang-tiktok.json` | Cách dự phòng khi không dùng API TikTok: chỉ nhắn Telegram link video để tự đăng tay. Không bật cùng `tiktok-dang-video.json` |
| `vps/` | Bộ cài n8n lên VPS (Docker + HTTPS) và cách chuyển dữ liệu từ n8n trên máy, xem `vps/README.md` |
| `github-pages/` | `tiktok.html` (trang nhận mã khi kết nối TikTok) và `terms.html`, đưa lên GitHub Pages |

**Gửi tiếp ngay (không đợi 1 tiếng).** Tin của TikTok có thêm nút **⏩ Đã đăng, gửi tiếp**: ghi `posted` rồi gửi luôn video kế tiếp. Bấm ✅ hoặc ⏭ thì tin đổi thành nút **⏩ Gửi video tiếp ngay** để gửi tiếp lúc nào cũng được. Nút có tác dụng trong khoảng 1 phút (lượt đọc nút bấm kế tiếp), video vào hộp thư sau 1–5 phút. Vẫn giữ quy tắc mỗi lần một video: nếu còn video trong hộp thư chưa đăng, đang có video gửi dở, hoặc hết video, bot nhắn lý do thay vì gửi.

Trạng thái trong cột `status`: `pending` → `posting` → `posted` (YouTube) / `inbox` (TikTok) → `posted` hoặc `skipped` khi bấm nút trong Telegram, hoặc `error` kèm lý do ở `note`.
Đăng lại một video lỗi: sửa `status` về `pending`.

## Kết nối YouTube

1. Google Cloud Console, chọn project đang dùng cho Drive/Sheets:
   - **APIs & Services → Library**: bật **YouTube Data API v3**.
   - **OAuth consent screen** (Google Auth Platform → Audience): **Publishing status** phải là **In production**. Còn ở **Testing** thì token hết hạn sau 7 ngày và workflow ngừng đăng. App chưa xác minh vẫn dùng được cho tài khoản của mình, lúc đăng nhập bấm **Advanced → Go to … (unsafe)**.
   - **Credentials → OAuth client** đang dùng: thêm **Authorized redirect URI** `https://160-250-131-176.sslip.io/rest/oauth2-credential/callback` (địa chỉ n8n trên VPS).
2. Trong n8n: **Credentials → Add credential → YouTube OAuth2 API**, dán Client ID và Client Secret của OAuth client đó, bấm **Sign in with Google** và chọn **tài khoản giữ kênh YouTube** (kênh thương hiệu thì chọn đúng kênh ở bước chọn tài khoản).
3. Mở workflow **YouTube - Đăng video**, chọn credential đó ở node **Đăng YouTube** và **Đặt ảnh bìa**, rồi bật workflow.

Kênh nên **xác minh số điện thoại** tại youtube.com/verify: chưa xác minh thì YouTube chỉ nhận video tối đa 15 phút (bản YouTube cả truyện thường dài 30–45 phút) và không cho đặt ảnh bìa riêng. Đặt sẵn **đối tượng người xem** (có dành cho trẻ em hay không) trong YouTube Studio → Cài đặt → Kênh → Cài đặt nâng cao, video đăng qua API sẽ theo cài đặt đó.

Workflow trỏ tới bảng tính `Story Studio - Video`. Dùng bảng tính khác thì thay link trong các node Google Sheets.
Hướng dẫn cài đặt: docs/n8n.md, mục 4.
