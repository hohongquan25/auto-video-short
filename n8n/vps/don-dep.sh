#!/bin/sh
# Dọn ổ đĩa VPS: xoá các khúc video tạm n8n tải từ Drive khi gửi TikTok/YouTube (video gốc vẫn ở Drive)
# và thu gọn log hệ thống. Cron chạy lúc 3h sáng mỗi 3 ngày, giờ n8n không gửi video (xem README).
STORAGE=/var/lib/docker/volumes/n8n_n8n_data/_data/storage/workflows

# Chỉ xoá lượt chạy bắt đầu hơn 60 phút trước: lượt mới hơn có thể vẫn đang gửi.
find "$STORAGE"/*/executions -mindepth 1 -maxdepth 1 -type d -mmin +60 -exec rm -rf {} + 2>/dev/null
journalctl --vacuum-size=100M >/dev/null 2>&1

echo "$(date '+%F %T') còn trống $(df -h / | awk 'NR==2 {print $4}')"
