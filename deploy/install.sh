#!/usr/bin/env bash
# 抖音聚合服务器一键部署（Debian / Ubuntu，systemd）。
# 在仓库根目录执行：sudo bash deploy/install.sh
# 重复执行即为升级：代码和依赖会更新，配置文件与数据保留。
#
# 可用环境变量覆盖：
#   DOUYINJUHE_API_PORT  监听端口，默认 18182
#   DOUYINJUHE_API_HOST  监听地址，默认 0.0.0.0（前面有反向代理时改成 127.0.0.1）
set -euo pipefail

APP_DIR=/opt/douyinjuhe
DATA_DIR=/var/lib/douyinjuhe
ENV_FILE=/etc/douyinjuhe/douyinjuhe.env
SERVICE=douyinjuhe-api
RUN_USER=douyinjuhe
PORT="${DOUYINJUHE_API_PORT:-18182}"
HOST="${DOUYINJUHE_API_HOST:-0.0.0.0}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "请用 root 执行：sudo bash deploy/install.sh" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "本脚本需要 systemd" >&2; exit 1; }
[ -f "$SOURCE/services/api/src/index.js" ] || { echo "请在仓库内执行本脚本" >&2; exit 1; }

node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; }
if ! node_ok; then
  echo "==> 安装 Node.js 22"
  command -v apt-get >/dev/null || { echo "未找到 apt-get，请先手动安装 Node.js 22.5 或更高版本" >&2; exit 1; }
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
  node_ok || { echo "Node.js 版本仍低于 22.5" >&2; exit 1; }
fi
NODE_BIN="$(command -v node)"

echo "==> 创建用户与目录"
id "$RUN_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$RUN_USER"
mkdir -p "$APP_DIR" "$DATA_DIR" "$(dirname "$ENV_FILE")"

echo "==> 复制代码到 $APP_DIR"
if [ "$SOURCE" != "$APP_DIR" ]; then
  for item in apps packages services tools package.json package-lock.json; do
    rm -rf "${APP_DIR:?}/$item"
    cp -a "$SOURCE/$item" "$APP_DIR/"
  done
  rm -rf "$APP_DIR/apps/web/dist" "$APP_DIR/apps/web/node_modules"
  # 登录器是 Windows 构建产物，不随仓库分发。源目录里已构建则一并带上，
  # 否则网页上的“下载登录器”会返回 404。
  if [ -f "$SOURCE/build/launcher/DouyinJuheLauncher.exe" ]; then
    mkdir -p "$APP_DIR/build/launcher"
    cp -a "$SOURCE/build/launcher/DouyinJuheLauncher.exe" "$APP_DIR/build/launcher/"
  fi
fi

echo "==> 安装依赖并构建网页"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build:web

if [ ! -f "$ENV_FILE" ]; then
  echo "==> 生成配置 $ENV_FILE"
  ADMIN_ENTRY="$("$NODE_BIN" -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
  cat > "$ENV_FILE" <<EOF
DOUYINJUHE_API_PORT=$PORT
DOUYINJUHE_API_HOST=$HOST
DOUYINJUHE_DATA_DIR=$DATA_DIR
DOUYINJUHE_ADMIN_ENTRY=$ADMIN_ENTRY
EOF
else
  echo "==> 保留已有配置 $ENV_FILE"
fi
chmod 600 "$ENV_FILE"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" "$DATA_DIR"
chmod 700 "$DATA_DIR"

echo "==> 安装 systemd 服务"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Douyin Juhe API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN services/api/src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

# 以配置文件里的端口为准（升级时可能与本次环境变量不同）。
PORT="$(grep -E '^DOUYINJUHE_API_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2)"; PORT="${PORT:-18182}"
ENTRY="$(grep -E '^DOUYINJUHE_ADMIN_ENTRY=' "$ENV_FILE" | tail -1 | cut -d= -f2)"
echo "==> 等待服务就绪"
for _ in $(seq 1 20); do
  if "$NODE_BIN" -e "fetch('http://127.0.0.1:$PORT/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo
    echo "部署完成。"
    echo "  网页：      http://<服务器地址>:$PORT/"
    [ -n "$ENTRY" ] && echo "  管理后台：  http://<服务器地址>:$PORT/#admin-$ENTRY"
    echo "  配置：      $ENV_FILE"
    echo "  数据：      $DATA_DIR（请定期备份，内含数据库和材料私钥）"
    echo "  日志：      journalctl -u $SERVICE -f"
    echo
    if [ ! -f "$APP_DIR/build/launcher/DouyinJuheLauncher.exe" ]; then
      echo "注意：未找到登录器构建产物，网页上的“下载登录器”会返回 404。"
      echo "      登录器是 Windows 程序，需在 Windows 上执行 tools\build-launcher.ps1 构建，"
      echo "      再把生成的 build\launcher\DouyinJuheLauncher.exe 放到 $APP_DIR/build/launcher/。"
      echo
    fi
    echo "注意：当前是明文 HTTP。对外使用前请在前面加 HTTPS 反向代理，"
    echo "      并把 DOUYINJUHE_API_HOST 改为 127.0.0.1。"
    exit 0
  fi
  sleep 1
done
echo "服务未在 20 秒内就绪，请查看：journalctl -u $SERVICE -n 50" >&2
exit 1
