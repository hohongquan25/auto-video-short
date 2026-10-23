# Workflow n8n đăng video từ Google Sheet

Import trong n8n: menu **⋯ → Import from File**.

| File | Việc |
|---|---|
| `telegram-quan-ly.json` | **Trang quản lý Telegram theo bộ truyện** (xem mục bên dưới): node Telegram Trigger nhận ngay mọi tin nhắn và nút bấm gửi bot, thay cho workflow hỏi Telegram mỗi phút. Mỗi truyện một màn hình: đăng YouTube ngay, bắt đầu / dừng TikTok của truyện, gửi phần tiếp, bỏ cả truyện; thêm các màn hình video lỗi, lịch tự động, truyện đã xong. Cần credential **Telegram API** (bot token) và n8n có HTTPS |
| `youtube-dang-video.json` | **Không tự đăng.** 21h mỗi ngày nhắn Telegram video `format = youtube` kế tiếp đang `pending` (truyện cũ trước, các phần trước trọn bộ) kèm nút **✅ Đăng lên YouTube ngay**; bấm thì mới đăng, không bấm thì video vẫn chờ và tối hôm sau nhắc lại. Bấm **▶️ Đăng YouTube ngay** ở màn hình một truyện trong trang quản lý cũng đăng được lúc nào cũng được. Khi đăng: công khai, dùng tiêu đề, mô tả, thẻ, hashtag AI đã viết, đặt ảnh bìa, rồi nhắn Telegram link video (điền `telegram_bot_token`, `telegram_chat_id` ở node **Cấu hình YouTube**; đổi `privacy_status` thành `private` hoặc `unlisted` nếu muốn duyệt trước). Tạm dừng, bật lại lời nhắc 21h ở màn hình **⚙️ Lịch tự động**. Cần credential **YouTube OAuth2 API** của tài khoản giữ kênh, xem mục **Kết nối YouTube** bên dưới |
| `tiktok-ket-noi.json` | Chạy tay một lần để kết nối tài khoản TikTok (lưu token vào tab `TikTokAuth`) |
| `tiktok-dang-video.json` | 2 giờ một lần (7h, 9h … 23h, phút 5) gửi 1 video `format = tiktok` hoặc `original` chưa đăng vào hộp thư TikTok, **chỉ của các truyện đã bấm 🎵 Bắt đầu TikTok** trong trang quản lý (YouTube đăng trước, TikTok sau; truyện đã gửi TikTok dở từ trước vẫn tiếp tục), rồi nhắn Telegram tên ngắn của truyện kèm số phần và tối đa 5 hashtag để dán khi đăng, không có đoạn mô tả; video trọn bộ giữ tên Story Studio đặt, ví dụ `Lời khai của kẻ mù (Truyện Full) #gactro1 | Gác trọ Audio`, số của truyện tính là một trong 5 hashtag (điền `telegram_bot_token`, `telegram_chat_id` ở node **Cấu hình TikTok**; để trống thì không nhắn). Gửi theo thứ tự truyện cũ trước, từng phần một; đăng hết các phần của một truyện (✅ hoặc ⏭) thì gửi tiếp video trọn bộ (`kind = full`) của truyện đó, rồi mới sang truyện sau. Từ 0h đến 7h không gửi, không nhắc (sửa giờ ở node **Theo lịch**, nút ⏩ vẫn dùng được). Video chưa kịp đăng trong ngày được gửi tiếp vào hôm sau (truyện cũ trước). Còn video gửi hôm nay ở `inbox` chưa đăng thì không gửi thêm; quá 3 giờ thì nhắc 1 lần. Video vào hộp thư từ ngày trước không chặn nữa (tin Telegram của nó đã bị dọn lúc 0h) Mỗi tin bot gửi được ghi vào tab `TelegramLog`. Bấm **⏩ Gửi tiếp** trong Telegram thì workflow chạy ngay, không đợi lượt kế tiếp (xem bên dưới). Tạm dừng, bật lại lịch tự động trong trang quản lý |
| `telegram-don-tin.json` | 0h xoá mọi tin bot đã gửi trong các ngày trước (theo tab `TelegramLog`) và xoá các dòng đó khỏi tab |
| `telegram-nhac-dang-tiktok.json` | Cách dự phòng khi không dùng API TikTok: chỉ nhắn Telegram link video để tự đăng tay. Không bật cùng `tiktok-dang-video.json` |
| `vps/` | Bộ cài n8n lên VPS (Docker + HTTPS) và cách chuyển dữ liệu từ n8n trên máy, xem `vps/README.md` |
| `github-pages/` | `tiktok.html` (trang nhận mã khi kết nối TikTok) và `terms.html`, đưa lên GitHub Pages |

**Gửi tiếp ngay (không đợi lượt 2 giờ kế tiếp).** Tin của TikTok có thêm nút **⏩ Đã đăng, gửi tiếp**: ghi `posted` rồi gửi luôn video kế tiếp. Bấm ✅ hoặc ⏭ thì tin đổi thành nút **⏩ Gửi video tiếp ngay** để gửi tiếp lúc nào cũng được. Nút có tác dụng ngay (trang quản lý nhận nút bấm qua webhook), video vào hộp thư sau 1–5 phút. Vẫn giữ quy tắc mỗi lần một video: nếu còn video trong hộp thư chưa đăng, đang có video gửi dở, hoặc hết video, bot báo lý do thay vì gửi.

Trạng thái trong cột `status`: `pending` → `posting` → `posted` (YouTube) / `inbox` (TikTok) → `posted` hoặc `skipped` khi bấm nút trong Telegram, hoặc `error` kèm lý do ở `note`.
Đăng lại một video lỗi: bấm **🔁 Gửi lại** dưới tin báo lỗi hoặc trong màn hình **Video lỗi** của trang quản lý (hoặc sửa `status` về `pending` trong Sheet).

## Trang quản lý Telegram

Mỗi truyện đăng YouTube trước, TikTok sau để kéo người xem sang YouTube, nên trang quản lý chia theo bộ truyện. Gõ `/start` cho bot một lần để hiện bàn phím (📚 Bộ truyện, ⚠️ Video lỗi, ⚙️ Lịch tự động, 📦 Đã xong) và menu lệnh `/menu`, `/loi`, `/lich`, `/xong`, `/giup`. Bot chỉ trả lời trong cuộc trò chuyện có chat id ở node **Telegram** và **Cấu hình**.

| Màn hình | Có gì |
|---|---|
| 📚 Bộ truyện | Các truyện còn video chưa đăng, theo thứ tự đăng (truyện cũ trước), 8 truyện một trang. Mỗi truyện một dòng: YouTube (đã đăng ngày nào, chờ đăng, kế tiếp, lỗi) và TikTok (chưa bắt đầu, số phần đã đăng, phần đang trong hộp thư, đã dừng). Bấm tên truyện để mở |
| 📖 Một truyện | Video YouTube (độ dài, trạng thái, link) và từng phần TikTok. Nút **▶️ Đăng YouTube ngay** (hỏi lại), **🎵 Bắt đầu TikTok** (YouTube chưa đăng xong thì hỏi lại), **⏩ Gửi phần tiếp ngay**, **⏸ Dừng TikTok** / **▶️ Chạy tiếp TikTok**, ✅ / ⏭ cho phần đang nằm trong hộp thư, **🔁 Gửi lại** video lỗi của truyện, **⏭ Bỏ cả truyện** (hỏi lại; video trong hộp thư giữ nguyên) |
| ⚠️ Video lỗi | Video `error` và video kẹt ở `posting` (TikTok quá 30 phút, YouTube quá 3 giờ) của mọi truyện: 🔁 gửi lại (về `pending`; lượt tự động gửi khi lịch đang bật và TikTok của truyện đang chạy, không thì bot nói nút nào gửi được) hoặc ⏭ bỏ qua. Video kẹt có thể đã lên rồi, xem hộp thư TikTok hoặc kênh YouTube trước khi gửi lại |
| ⚙️ Lịch tự động | Lịch YouTube và TikTok đang bật hay tạm dừng, nút tạm dừng / bật lại từng lịch |
| 📦 Đã xong | 10 truyện đăng hết gần nhất, kèm link YouTube; bấm để mở màn hình truyện |

Bấm nút trên màn hình thì màn hình đó cập nhật tại chỗ; tin lệnh bạn gõ được xoá cho gọn. Tin bot gửi được ghi vào tab `TelegramLog` nên được dọn lúc 0h, trừ tin chào giữ bàn phím.

**TikTok theo truyện.** Workflow TikTok chỉ gửi phần của các truyện đã bấm **🎵 Bắt đầu TikTok**; bấm thì phần đầu được gửi luôn nếu không có gì chặn. Tin **✅ Đã đăng YouTube** của một truyện chưa bắt đầu TikTok có sẵn nút này. **⏸ Dừng TikTok** thì truyện đó thôi gửi tới khi bấm **▶️ Chạy tiếp TikTok**. Truyện đã có phần TikTok gửi đi từ trước khi có nút này được coi là đã bắt đầu. Vẫn mỗi lần một video: còn video gửi hôm nay nằm trong hộp thư chưa đăng thì chờ. Video trọn bộ gửi sau khi mọi phần đã đăng hoặc bỏ qua (phần đang lỗi thì gửi lại hoặc bỏ qua trước).

**Chống gửi trùng.** Bấm hai lần liền, hoặc bấm đúng lúc lịch chạy, có thể làm hai lượt cùng chọn một video. Mỗi lượt ghi giờ khoá vào `posted_at`, đợi 3 giây rồi đọc lại: chỉ lượt ghi sau cùng gửi tiếp, lượt kia dừng. Đọc tab `CaiDat` lỗi (không phải do chưa có tab) thì lượt theo lịch bỏ qua thay vì đoán lịch có đang tạm dừng không.

**Tab `CaiDat`** của Sheet giữ các lựa chọn này (tự tạo lần đầu bấm): mỗi lần bấm thêm một dòng `key | value | at`, dòng sau cùng của mỗi key được dùng. `tiktok:<job_id>` = `on` / `off` là bắt đầu / dừng TikTok của một truyện; `tiktok_auto`, `youtube_auto` = `on` / `off` là bật / tạm dừng lịch. Khi lịch tạm dừng, lượt theo lịch của workflow đó không gửi, không nhắc; nút ⏩ Gửi phần tiếp và ▶️ Đăng YouTube ngay vẫn dùng được.

Lưu ý:
- Bàn phím cũ (📊 Tổng quan, 🎵 TikTok, ▶️ YouTube) vẫn mở danh sách truyện; gõ `/start` để đổi sang bàn phím mới.
- Telegram chỉ cho mỗi bot một webhook. Không bật workflow nào khác dùng Telegram Trigger hoặc `getUpdates` với bot này (workflow cũ `Telegram - Nhận nút bấm` đã được thay, file của nó còn trong lịch sử git).
- Đang bật trang quản lý thì đừng bấm **Listen for test event** / **Execute workflow** trên node Telegram: n8n chuyển webhook sang địa chỉ thử và bot ngừng trả lời. Lỡ bấm thì Unpublish rồi Publish lại workflow.
- Lịch ghi trên màn hình lấy từ ô `lich_tiktok`, `lich_youtube` ở node **Cấu hình**: đổi giờ chạy của workflow TikTok/YouTube thì sửa cả hai ô này.
- Cập nhật các workflow này lên VPS: xem `vps/README.md`, mục **Cập nhật workflow**.

## Kết nối YouTube

1. Google Cloud Console, chọn project đang dùng cho Drive/Sheets:
   - **APIs & Services → Library**: bật **YouTube Data API v3**.
   - **OAuth consent screen** (Google Auth Platform → Audience): **Publishing status** phải là **In production**. Còn ở **Testing** thì token hết hạn sau 7 ngày và workflow ngừng đăng. App chưa xác minh vẫn dùng được cho tài khoản của mình, lúc đăng nhập bấm **Advanced → Go to … (unsafe)**.
   - **Credentials → OAuth client** đang dùng: thêm **Authorized redirect URI** `https://160-250-131-176.sslip.io/rest/oauth2-credential/callback` (địa chỉ n8n trên VPS).
2. Trong n8n: **Credentials → Add credential → YouTube OAuth2 API**, dán Client ID và Client Secret của OAuth client đó, bấm **Sign in with Google** và chọn **tài khoản giữ kênh YouTube** (kênh thương hiệu thì chọn đúng kênh ở bước chọn tài khoản).
3. Chạy lại bước **Cập nhật workflow** trong `vps/README.md`: script tự gắn credential YouTube (khi n8n có đúng một credential loại này) vào node **Đăng YouTube** và **Đặt ảnh bìa** rồi bật workflow. Hoặc làm tay: mở workflow **YouTube - Đăng video**, chọn credential ở hai node đó rồi bấm **Publish**. Workflow này không tự đăng: bật rồi thì 21h bot nhắc, bấm nút trong tin nhắc (hoặc **▶️ Đăng YouTube ngay** trong màn hình một truyện) mới đăng. Phải bật (Publish) thì nút đăng trong Telegram mới chạy.

Kênh nên **xác minh số điện thoại** tại youtube.com/verify: chưa xác minh thì YouTube chỉ nhận video tối đa 15 phút (bản YouTube cả truyện thường dài 30–45 phút) và không cho đặt ảnh bìa riêng. Đặt sẵn **đối tượng người xem** (có dành cho trẻ em hay không) trong YouTube Studio → Cài đặt → Kênh → Cài đặt nâng cao, video đăng qua API sẽ theo cài đặt đó.

Workflow trỏ tới bảng tính `Story Studio - Video`. Dùng bảng tính khác thì thay link trong các node Google Sheets.
Hướng dẫn cài đặt: docs/n8n.md, mục 4.
