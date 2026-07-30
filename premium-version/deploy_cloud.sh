#!/bin/bash
# ============================================================
# 考试助手 Premium - 腾讯云 Ubuntu 一键部署脚本 (支持纯 IP & 域名双模式)
# 目标服务器: 175.178.78.88 (广州, Ubuntu)
# 使用方法: chmod +x deploy_cloud.sh && sudo ./deploy_cloud.sh
# ============================================================
set -e

DOMAIN=""          # 可留空自动使用公网 IP
APP_DIR="/opt/exam-assistant"
SERVICE_NAME="exam-assistant"
PORT=8000
SERVER_IP="175.178.78.88"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── 检查 root 权限 ───────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then log_error "请使用 sudo 运行此脚本"; fi

# ── 自动检测公网 IP ─────────────────────────────────────────────────────────
DETECTED_IP=$(curl -s --max-time 3 ifconfig.me || echo "$SERVER_IP")

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}    考试助手 Premium 一键部署工具 (IP / 域名双模式)   ${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""

if [ -z "$DOMAIN" ]; then
  echo -e "提示：如果你有域名（如 exam.abc.com），请输入域名。"
  echo -e "如果你 ${YELLOW}没有域名${NC}，请 ${GREEN}直接按回车${NC}，脚本将以【纯 IP 模式 (${DETECTED_IP})】部署！"
  echo ""
  read -p "请输入域名 (无域名请直接按 Enter 回车): " INPUT_DOMAIN
  DOMAIN=$INPUT_DOMAIN
fi

if [ -z "$DOMAIN" ]; then
  DOMAIN=$DETECTED_IP
  USE_IP_MODE=1
  log_info "已选择【纯 IP 模式】部署，服务绑定: http://$DOMAIN/"
else
  USE_IP_MODE=0
  log_info "已选择【域名模式】部署，绑定域名: https://$DOMAIN/"
fi

# ── 1. 更新系统依赖 ──────────────────────────────────────────────────────────
log_info "📦 更新系统软件包..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv nginx certbot python3-certbot-nginx git curl

# ── 2. 创建应用目录与复制文件 ───────────────────────────────────────────────
log_info "📁 准备应用目录: $APP_DIR"
mkdir -p $APP_DIR

# 如果当前脚本在 Git 目录中，复制 server 文件夹
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
if [ -d "$SCRIPT_DIR/server" ]; then
  cp -r "$SCRIPT_DIR/server/." "$APP_DIR/"
fi

# ── 3. 配置 Python 虚拟环境 ──────────────────────────────────────────────────
log_info "🐍 配置 Python 虚拟环境..."
python3 -m venv $APP_DIR/venv
source $APP_DIR/venv/bin/activate
pip install -q --upgrade pip
pip install -q -r $APP_DIR/requirements.txt

# ── 4. 配置 Nginx ────────────────────────────────────────────────────────────
log_info "🌐 配置 Nginx 反向代理..."

if [ "$USE_IP_MODE" -eq 1 ]; then
  # ── 纯 IP 模式 Nginx 配置 (HTTP 80) ──
  cat > /etc/nginx/sites-available/$SERVICE_NAME << NGINX_EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 50M;

    # HTTP API & 静态前端
    location / {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }

    # WebSocket (WS) 搜题长连接
    location /ws/ {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX_EOF

else
  # ── 域名模式 Nginx 配置 (HTTPS 443) ──
  cat > /etc/nginx/sites-available/$SERVICE_NAME << NGINX_EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    client_max_body_size 50M;

    location / {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }

    location /ws/ {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX_EOF
fi

# 启用站点配置
ln -sf /etc/nginx/sites-available/$SERVICE_NAME /etc/nginx/sites-enabled/$SERVICE_NAME
rm -f /etc/nginx/sites-enabled/default

nginx -t || log_error "Nginx 配置检测失败，请检查语法"

# ── 5. 申请 SSL 证书（仅域名模式）─────────────────────────────────────────
if [ "$USE_IP_MODE" -eq 0 ]; then
  log_info "🔒 正在为域名 $DOMAIN 申请 SSL 证书..."
  certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || \
    log_warn "SSL 证书申请未成功，请检查 DNS 是否正确指向本机"
fi

systemctl reload nginx
log_info "✅ Nginx 服务已成功重载"

# ── 6. 配置 Systemd 守护服务 ─────────────────────────────────────────────────
log_info "⚙️ 配置 Systemd 后台常驻守护..."
cat > /etc/systemd/system/$SERVICE_NAME.service << SERVICE_EOF
[Unit]
Description=考试助手 Premium FastAPI 服务
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/venv/bin/uvicorn main:app --host 127.0.0.1 --port $PORT --workers 2
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME

# ── 7. 输出完成面板 ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  🎉 考试助手 Premium 部署成功！${NC}"
echo -e "${GREEN}============================================================${NC}"

if [ "$USE_IP_MODE" -eq 1 ]; then
  echo -e "  🌐 购买页面:      ${YELLOW}http://$DOMAIN/${NC}"
  echo -e "  🛡️  管理员后台:   ${YELLOW}http://$DOMAIN/admin${NC}"
  echo -e "  🔗 WS 搜题接口:   ${YELLOW}ws://$DOMAIN/ws/search?token=XXX&device_id=YYY${NC}"
else
  echo -e "  🌐 购买页面:      ${YELLOW}https://$DOMAIN/${NC}"
  echo -e "  🛡️  管理员后台:   ${YELLOW}https://$DOMAIN/admin${NC}"
  echo -e "  🔗 WSS 搜题接口:  ${YELLOW}wss://$DOMAIN/ws/search?token=XXX&device_id=YYY${NC}"
fi

echo -e "  📋 服务运行状态:  ${YELLOW}systemctl status $SERVICE_NAME${NC}"
echo -e "  📜 查看运行日志:  ${YELLOW}journalctl -u $SERVICE_NAME -f${NC}"
echo ""
echo -e "${YELLOW}  🔑 首次启动的 ADMIN_KEY 请运行以下命令查看:${NC}"
echo -e "  ${YELLOW}journalctl -u $SERVICE_NAME -n 50 | grep ADMIN_KEY${NC}"
echo -e "${GREEN}============================================================${NC}"
