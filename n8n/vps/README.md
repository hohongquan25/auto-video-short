# Cài n8n lên VPS

n8n chạy trong Docker, Caddy lo HTTPS (tự xin chứng chỉ Let's Encrypt). Story Studio vẫn chạy trên máy bạn: nó đẩy video lên Drive và Sheet, n8n trên VPS chỉ đọc Sheet nên hai máy không cần gọi nhau.

## 1. Chuẩn bị

- **VPS**: Ubuntu 24.04 (không chọn Windows), tối thiểu 1 vCPU, 1 GB RAM (cần thêm swap, xem mục 2), 20 GB SSD. Nên chọn máy đặt ở Singapore hoặc Việt Nam cho nhanh.
- **Tên miền** trỏ về VPS: tạo bản ghi **A** `n8n.<tên miền>` → IP của VPS. Chưa có tên miền thì dùng tạm tên miền miễn phí của [DuckDNS](https://www.duckdns.org).
  Phải có tên miền và HTTPS thì mới dùng được kết nối Google (OAuth) và webhook Telegram.

### Không dùng tên miền

Các workflow hiện tại chỉ chạy theo lịch, không cần internet gọi vào n8n, nên có thể bỏ tên miền và Caddy:

- Dùng `docker-compose.no-domain.yml` thay cho `docker-compose.yml`: khi chép lên VPS, đổi tên nó thành `docker-compose.yml`. Không cần `Caddyfile`, `.env` chỉ cần `N8N_VERSION`, và ở tường lửa chỉ mở OpenSSH (bỏ 80, 443).
- n8n không mở ra internet. Muốn vào giao diện, mở đường hầm SSH từ máy Windows rồi vào `http://localhost:5678` như hiện nay:

  ```powershell
  ssh -N -L 5678:localhost:5678 root@<IP>
  ```

  Kết nối lại Google vẫn dùng được, vì địa chỉ nhận mã vẫn là `http://localhost:5678/rest/oauth2-credential/callback` như lúc chạy trên máy.
- Không dùng được: mở n8n từ điện thoại, Webhook / Telegram Trigger (nên không có trang quản lý Telegram), `WEBHOOK_URL` của Story Studio. Khi cần mấy thứ này thì chuyển sang bản có tên miền, dữ liệu giữ nguyên.
- Không có trang quản lý thì các nút dưới tin Telegram không làm gì, và TikTok không gửi truyện mới: chỉ trang quản lý ghi được dòng `tiktok:<job_id> | on` (Bắt đầu TikTok) vào tab `CaiDat`. Muốn chạy tay thì tự thêm dòng đó vào Sheet.

## 2. Cài trên VPS

```bash
ssh root@<IP>
# VPS 1 GB RAM: thêm 2 GB swap để n8n không bị tắt khi thiếu RAM
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
mkdir -p /opt/n8n
```

Chép `docker-compose.yml`, `Caddyfile`, `.env.example` lên `/opt/n8n` (chạy trên máy Windows, trong thư mục này):

```powershell
scp docker-compose.yml Caddyfile .env.example root@<IP>:/opt/n8n/
```

Trên VPS: `cd /opt/n8n && cp .env.example .env && nano .env`, điền `N8N_DOMAIN`.

**Cài mới hoàn toàn**: `docker compose up -d`, mở `https://<N8N_DOMAIN>` và tạo tài khoản chủ. Nếu muốn chuyển dữ liệu từ máy sang thì **đừng** chạy lệnh này, làm theo mục 3.

## 3. Chuyển dữ liệu từ n8n trên máy

Cách này chép nguyên thư mục dữ liệu, gồm tài khoản đăng nhập, workflow, credential (Google, ...) và khoá mã hoá đi kèm, nên không phải cấu hình lại.

1. Trên máy Windows, bật Docker Desktop, rồi trong PowerShell:

   ```powershell
   cd F:\n8n
   docker compose stop
   docker run --rm -v n8n_n8n_data:/data -v ${PWD}:/backup alpine tar czf /backup/n8n_data.tgz -C /data .
   scp n8n_data.tgz root@<IP>:/opt/n8n/
   ```

   Từ đây **để n8n trên máy tắt luôn**. Nếu chạy cả hai nơi, mỗi video sẽ bị gửi TikTok hai lần và nút Telegram bị tranh nhau. Để máy không tự bật lại n8n khi khởi động Docker: `docker compose down` (dữ liệu trong volume vẫn còn).

2. Trên VPS:

   ```bash
   cd /opt/n8n
   docker compose create
   docker run --rm -v n8n_n8n_data:/data -v /opt/n8n:/backup alpine \
     sh -c "tar xzf /backup/n8n_data.tgz -C /data && chown -R 1000:1000 /data"
   docker compose up -d
   docker compose logs -f n8n
   ```

   `N8N_VERSION` trong `.env` phải bằng hoặc mới hơn bản trên máy, vì n8n không chạy được dữ liệu của bản mới hơn nó.

3. Mở `https://<N8N_DOMAIN>`, đăng nhập bằng tài khoản cũ, kiểm tra các workflow đang bật (TikTok gửi video, Telegram trang quản lý, Telegram dọn tin).

4. Trong [Google Cloud Console](https://console.cloud.google.com/apis/credentials), mở OAuth client mà n8n dùng và thêm **Authorized redirect URI** `https://<N8N_DOMAIN>/rest/oauth2-credential/callback`. Kết nối hiện có vẫn chạy mà không cần bước này; chỉ khi bấm kết nối lại Google trong n8n thì mới cần.

Kết nối TikTok không đổi gì: token nằm trong tab `TikTokAuth` của Sheet, trang nhận mã vẫn ở GitHub Pages.

## 4. Vận hành

| Việc | Lệnh (trong `/opt/n8n`) |
|---|---|
| Xem nhật ký | `docker compose logs -f n8n` |
| Cập nhật n8n | sửa `N8N_VERSION` (hoặc để `latest`), rồi `docker compose pull && docker compose up -d` |
| Sao lưu | `docker run --rm -v n8n_n8n_data:/data -v /opt/n8n:/backup alpine tar czf /backup/n8n_data-$(date +%F).tgz -C /data .` rồi tải file về |
| Chạy workflow từ dòng lệnh | `docker compose exec n8n n8n execute --id <id>` |
| Xem ổ đĩa | `df -h /`. Đầy thì báo lỗi `ENOSPC`. Thủ phạm thường là các khúc video tạm n8n tải từ Drive khi gửi video, nằm ở `/var/lib/docker/volumes/n8n_n8n_data/_data/storage/workflows/<id>/executions/` |
| Dọn ổ đĩa | `/opt/n8n/don-dep.sh` (chép từ `don-dep.sh`): xoá khúc video tạm của các lượt đã chạy xong (video gốc vẫn ở Drive) và thu gọn log hệ thống. Cron `/etc/cron.d/n8n-don-dep` chạy nó lúc 3h sáng mỗi 3 ngày: `0 3 */3 * * root /opt/n8n/don-dep.sh >> /var/log/n8n-don-dep.log 2>&1` |

Workflow cũ `Video kể chuyện tự động` (trong `F:\n8n`) cần ffmpeg và node Execute Command. Story Studio đã thay nó nên bộ cài này không kèm ffmpeg. Nếu vẫn cần, dùng lại `F:\n8n\Dockerfile` và thêm `NODES_EXCLUDE=[]`.

## 5. Cập nhật workflow

File workflow trong repo để chữ `DAN_...` thay cho khoá bí mật (bot token, chat id, khoá TikTok) và không gắn credential. `cap-nhat.sh` lấy những thứ đó từ bản đang chạy trên VPS nên không phải điền tay:

1. Sao lưu mọi workflow đang chạy vào `/opt/n8n/backup-<ngày giờ>/`.
2. Ghép bản trong repo với khoá bí mật và credential đang dùng (`ghep-workflow.mjs`, chạy trong container n8n). Node mới được gắn credential cùng loại khi n8n chỉ có một cái; trang quản lý Telegram chưa có credential Telegram thì tạo từ bot token đang dùng.
3. Nhập vào n8n; bật trang quản lý và tắt workflow `Telegram - Nhận nút bấm` cũ; workflow YouTube được bật khi đủ credential; workflow khác giữ bật/tắt như trước.
4. Khởi động lại n8n và in webhook Telegram đang trỏ về đâu.

Chạy trên máy Windows, ở thư mục gốc repo:

```powershell
ssh root@<IP> mkdir -p /opt/n8n/cap-nhat
scp n8n/telegram-quan-ly.json n8n/tiktok-dang-video.json n8n/youtube-dang-video.json n8n/vps/ghep-workflow.mjs n8n/vps/cap-nhat.sh root@<IP>:/opt/n8n/cap-nhat/
ssh root@<IP> sh /opt/n8n/cap-nhat/cap-nhat.sh
```

Nếu bản đang chạy có hai giá trị khác nhau cho cùng một khoá (ví dụ hai bot token), script dừng trước khi nhập, không đổi gì.

**Quay lại bản cũ**: nhập lại các file trong thư mục sao lưu rồi bật lại như trước, ví dụ:

```bash
cd /opt/n8n
B=/opt/n8n/backup-<ngày giờ>/live
for f in $B/ss*.json; do docker compose cp "$f" n8n:/tmp/; docker compose exec -T -u node n8n n8n import:workflow --input=/tmp/$(basename $f); done
docker compose exec -T -u node n8n n8n unpublish:workflow --id=ssTeleQuanLy0001
docker compose exec -T -u node n8n n8n publish:workflow --id=ssTeleNutBam0001
docker compose exec -T -u node n8n n8n publish:workflow --id=ssTikTokDangVid1
docker compose restart n8n
```
