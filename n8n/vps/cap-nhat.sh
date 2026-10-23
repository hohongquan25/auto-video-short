#!/bin/sh
# Cập nhật workflow trên VPS theo bản trong repo: sao lưu bản đang chạy, giữ khoá bí mật và credential của nó,
# nhập bản mới, bật trang quản lý Telegram (tắt workflow nút bấm cũ) rồi khởi động lại n8n.
# Trên máy Windows, ở thư mục gốc repo:
#   ssh root@<IP> mkdir -p /opt/n8n/cap-nhat
#   scp n8n/telegram-quan-ly.json n8n/tiktok-dang-video.json n8n/youtube-dang-video.json n8n/vps/ghep-workflow.mjs n8n/vps/cap-nhat.sh root@<IP>:/opt/n8n/cap-nhat/
#   ssh root@<IP> sh /opt/n8n/cap-nhat/cap-nhat.sh
set -eu
cd /opt/n8n
SRC=/opt/n8n/cap-nhat
WORK=/tmp/cap-nhat
BACKUP=/opt/n8n/backup-$(date +%Y%m%d-%H%M%S)

as_node() { docker compose exec -T -u node n8n "$@"; }
as_root() { docker compose exec -T -u root n8n "$@"; }
# Thư mục làm việc có khoá bí mật: xoá khi script kết thúc, kể cả khi dừng giữa chừng. Bản sao lưu ở $BACKUP.
trap 'as_root rm -rf "$WORK" >/dev/null 2>&1 || true' EXIT

echo "== Sao lưu bản đang chạy vào $BACKUP"
as_root rm -rf "$WORK"
as_node mkdir -p "$WORK/live" "$WORK/new" "$WORK/out"
as_node n8n export:workflow --all --separate --output="$WORK/live/" >/dev/null
as_node n8n export:credentials --all --output="$WORK/credentials.json" >/dev/null 2>&1 || true
mkdir -p "$BACKUP"
docker compose cp "n8n:$WORK/live" "$BACKUP/"

echo "== Ghép bản mới với khoá bí mật và credential đang dùng"
for f in "$SRC"/*.json; do docker compose cp "$f" "n8n:$WORK/new/"; done
docker compose cp "$SRC/ghep-workflow.mjs" "n8n:$WORK/"
as_root chown -R node:node "$WORK"
as_node node "$WORK/ghep-workflow.mjs" "$WORK"

echo "== Nhập vào n8n"
if as_node test -f "$WORK/out/telegram-credential.json"; then
  as_node n8n import:credentials --input="$WORK/out/telegram-credential.json"
fi
for f in $(as_node sh -c "ls $WORK/out/ss*.json"); do
  as_node n8n import:workflow --input="$f"
done
for id in $(as_node cat "$WORK/out/unpublish.txt"); do as_node n8n unpublish:workflow --id="$id"; done
for id in $(as_node cat "$WORK/out/publish.txt"); do as_node n8n publish:workflow --id="$id"; done

echo "== Khởi động lại n8n"
docker compose restart n8n
i=0
until as_node wget -qO- http://localhost:5678/healthz >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then echo "n8n chưa chạy lại sau 2 phút, xem: docker compose logs n8n"; break; fi
  sleep 2
done
# Trang quản lý đăng ký webhook với Telegram ngay khi n8n bật nó.
sleep 10
as_node node "$WORK/ghep-workflow.mjs" "$WORK" --webhook || true

rm -rf "$SRC"
echo "Xong. Bản trước khi cập nhật: $BACKUP"
