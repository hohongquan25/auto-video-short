# Bản bán: build bộ cài và cấp khoá bản quyền

Bản bán là Story Studio đóng thành một bộ cài Windows (`StoryStudio-Setup-<phiên bản>.exe`). Khách cài bằng vài cú bấm, không phải cài Node, Python hay ffmpeg. Bản này khác bản bạn đang dùng ở chỗ:

| | Bản của bạn | Bản bán |
|---|---|---|
| AI viết lại, viết truyện, tóm tắt | Claude hoặc Gemini | Chỉ Gemini, khách dán khoá của họ ở trang Cài đặt |
| Nguồn truyện | File, link video, AI viết theo chủ đề | File, AI viết theo chủ đề (không có dán link) |
| Google Drive / Sheet, n8n, webhook, API token | Có | Không |
| Giọng đọc | OlvRoc, Edge TTS | OlvRoc (fp32), Edge TTS |
| Khoá bản quyền | Không cần | Bắt buộc, gắn với từng máy |

Cùng một mã nguồn: `server/edition.ts` và `client/src/edition.ts` có cờ `RETAIL`, script build đặt cờ này nên phần bị bỏ không nằm trong bản build.

## Chuẩn bị (làm một lần)

1. `pnpm setup:whisper` và `pnpm setup:olvroc`: bộ cài lấy thư viện Python đúng phiên bản trong `.venv` và model OlvRoc trong `models/`.
2. `pnpm license keygen`: tạo cặp khoá bản quyền.
   - Khoá bí mật nằm ở `%USERPROFILE%\.story-studio\license-private.pem`. **Sao lưu file này** (USB, ổ khác) và không đưa cho ai: ai có nó đều tạo được khoá. Mất nó thì phải tạo cặp khoá mới, build lại và cấp lại khoá cho mọi khách.
   - Khoá công khai được ghi vào `server/lib/license-key.ts` và commit cùng mã nguồn (không bí mật).
3. Cài Inno Setup 6: `winget install JRSoftware.InnoSetup`.

## Build bộ cài

```
pnpm build:retail
```

Kết quả nằm trong `release/` (không đưa lên git):

- `release/StoryStudio/`: ứng dụng đúng như khi cài. Chạy thử bằng `release\StoryStudio\Story Studio.cmd`.
- `release/StoryStudio-Setup-<phiên bản>.exe`: bộ cài gửi cho khách.

Lần đầu build sẽ tải Python embeddable, ffmpeg và bản dịch tiếng Việt của Inno Setup vào `build-cache/`. Các lần sau chỉ dựng lại phần ứng dụng. Muốn lấy ffmpeg mới hơn thì xoá `build-cache/ffmpeg*`. Ra bản mới thì tăng `version` trong `package.json`: khách chạy bộ cài mới đè lên bản cũ, dữ liệu vẫn giữ nguyên.

## Cấp khoá cho khách

1. Khách cài và mở Story Studio. Màn hình kích hoạt hiện **mã máy**, ví dụ `7F3A-91C2-04BE-D5E1`, và khách gửi mã này cho bạn.
2. Tạo khoá:

   ```
   pnpm license issue 7F3A-91C2-04BE-D5E1 --name "Nguyễn Văn A" --days 365
   ```

   - `--days 365`: dùng được 365 ngày tính từ hôm nay. Muốn chọn ngày cụ thể thì dùng `--until 2027-12-31`. Không ghi gì thì khoá không hết hạn.
   - Lệnh in ra khoá bắt đầu bằng `SS1-`. Gửi nguyên khoá đó cho khách, họ dán vào màn hình kích hoạt.
3. Mỗi khoá đã cấp được ghi thêm vào `%USERPROFILE%\.story-studio\licenses.csv` (mở được bằng Excel).

Khách gửi khoá lên hỏi thì đọc nội dung bằng: `pnpm license show <khoá>`.

**Đổi máy hoặc cài lại Windows** làm mã máy thay đổi: khách gửi mã mới và bạn cấp khoá mới.

**Gia hạn:** cấp khoá mới cho cùng mã máy. Khách mở Cài đặt, xem mục Bản quyền. Khi khoá hết hạn, Story Studio tự quay về màn hình kích hoạt để khách dán khoá mới.

## Giới hạn cần biết

- **Không thu hồi được khoá đã cấp.** Khoá được kiểm tra ngay trên máy khách, không cần mạng. Nếu muốn bán theo tháng hoặc năm thì cấp khoá có hạn (`--days`).
- **Chống bẻ khoá ở mức cơ bản.** Server đã được gộp và nén thành một file, nhưng người rành kỹ thuật vẫn có thể sửa để bỏ qua bước kiểm tra. Chỉnh đồng hồ máy lùi lại cũng không kéo dài được hạn khoá.
- **Bộ cài chưa ký số**, nên Windows hiện "Windows protected your PC" và khách phải bấm More info → Run anyway (đã ghi trong hướng dẫn cho khách). Muốn bỏ cảnh báo này thì mua chứng chỉ ký code (code signing certificate) rồi ký file `.exe`.
- **Edge TTS** gọi dịch vụ đọc của trình duyệt Microsoft Edge theo cách không chính thức. Microsoft không cấp phép dùng thương mại và có thể chặn bất cứ lúc nào. Lúc đóng gói bản đầu (26/10/2026), Edge TTS nhận kết nối nhưng không trả audio. Lỗi này xảy ra cả ở bản bạn đang dùng, và `edge-tts-universal` chưa có bản mới. Mỗi lần gọi Edge TTS giờ tự dừng sau 60 giây, thử lại vài lần rồi báo lỗi, thay vì treo mãi. Giọng mặc định là OlvRoc, chạy trên máy nên không bị ảnh hưởng.
- **Gemini:** khách dùng khoá và hạn mức miễn phí của chính họ, nên bạn không tốn phí AI. Hết lượt trong ngày thì job báo lỗi và khách chờ sang ngày sau.

## Giấy phép phần mềm đi kèm

Bộ cài có file `THIRD-PARTY-NOTICES.txt` liệt kê giấy phép của mọi phần đi kèm. Những phần cần lưu ý khi bán:

- **FFmpeg** là bản build GPL của gyan.dev: kèm theo `LICENSE.txt` và đường dẫn tới mã nguồn (đã có sẵn). Story Studio chỉ gọi ffmpeg như một chương trình riêng.
- **OlvRoc** (dựa trên VieNeu-TTS, Apache-2.0): giữ nguyên `python/olvroc/LICENSE` và `NOTICE` (đã có sẵn).
- **Font Be Vietnam Pro** (OFL): được phép đóng gói kèm phần mềm, kèm theo `OFL.txt`.

## Khách gặp lỗi

- Hướng dẫn cho khách nằm trong bộ cài (`installer/HUONG-DAN.txt`, có trong menu Start).
- Dữ liệu của khách nằm ở `%LOCALAPPDATA%\Story Studio`: các job, thư viện, `keys.json` (khoá Gemini) và `license.json`.
- Cửa sổ đen (Story Studio.cmd) ghi log của server. Khách chụp màn hình cửa sổ này gửi bạn khi có lỗi.
