#!/bin/bash
# ============================================================
# 考试助手 Premium - 腾讯云 Ubuntu 一键部署脚本
# 目标服务器: 175.178.78.88 (广州, Ubuntu)
# 使用方法: chmod +x deploy_cloud.sh && sudo ./deploy_cloud.sh
# ============================================================
set -e

DOMAIN=""          # 请填写你的域名，如: exam.yourdomain.com
APP_DIR="/opt/exam-assistant"
SERVICE_NAME="exam-assistant"
PORT=8000

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── 检查 root 权限 ───────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then log_error "请使用 sudo 运行此脚本"; fi

# ── 提示输入域名 ─────────────────────────────────────────────────────────────
if [ -z "$DOMAIN" ]; then
  read -p "请输入你的域名 (如 exam.yourdomain.com): " DOMAIN
  [ -z "$DOMAIN" ] && log_error "域名不能为空"
fi

log_info "🚀 开始部署考试助手 Premium 到 $DOMAIN ..."

# ── 1. 更新系统依赖 ──────────────────────────────────────────────────────────
log_info "📦 更新系统软件包..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv nginx certbot python3-certbot-nginx git

# ── 2. 创建应用目录 ──────────────────────────────────────────────────────────
log_info "📁 创建应用目录: $APP_DIR"
mkdir -p $APP_DIR
cp -r server/. $APP_DIR/

# ── 3. 配置 Python 虚拟环境 ──────────────────────────────────────────────────
log_info "🐍 配置 Python 虚拟环境..."
python3 -m venv $APP_DIR/venv
source $APP_DIR/venv/bin/activate
pip install -q --upgrade pip
pip install -q -r $APP_DIR/requirements.txt

# ── 4. 配置 Nginx ────────────────────────────────────────────────────────────
log_info "🌐 配置 Nginx 反向代理..."
cat > /etc/nginx/sites-available/$SERVICE_NAME << NGINX_EOF
# HTTP -> HTTPS 重定向
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

# HTTPS + WSS 主配置
server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    # SSL 证书（certbot 自动填充）
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;

    # 安全头
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    # HTTP API & 静态文件
    location / {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }

    # WebSocket (WSS) 搜题长连接
    location /ws/ {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;   # WSS 长连接保持 1 小时
        proxy_send_timeout 3600s;
    }

    # 上传文件大小限制（题库 Excel）
    client_max_body_size 50M;
}
NGINX_EOF

# 启用站点配置
ln -sf /etc/nginx/sites-available/$SERVICE_NAME /etc/nginx/sites-enabled/$SERVICE_NAME
rm -f /etc/nginx/sites-enabled/default

# 测试 Nginx 配置
nginx -t || log_error "Nginx 配置有误，请检查"

# ── 5. 申请 Let's Encrypt SSL 证书 ──────────────────────────────────────────
log_info "🔒 申请 SSL 证书 (Let's Encrypt)..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || \
  log_warn "SSL 证书申请失败，请确认域名 DNS 已解析到本服务器后重新运行"

# 重启 Nginx
systemctl reload nginx
log_info "✅ Nginx 配置完成"

# ── 6. 配置 Systemd 守护服务 ─────────────────────────────────────────────────
log_info "⚙️ 配置 Systemd 服务守护..."
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

# 启动并设置开机自启
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME

# ── 7. 配置 SSL 自动续期 ─────────────────────────────────────────────────────
log_info "🔁 配置 SSL 证书自动续期..."
(crontab -l 2>/dev/null; echo "0 3 * * 1 certbot renew --quiet && systemctl reload nginx") | crontab -

# ── 8. 完成提示 ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  ✅ 考试助手 Premium 部署完成！${NC}"
echo -e "${GREEN}============================================================${NC}"
echo -e "  🌐 购买页面:      ${YELLOW}https://$DOMAIN/${NC}"
echo -e "  🛡️  管理员后台:   ${YELLOW}https://$DOMAIN/admin${NC}"
echo -e "  🔗 WSS 搜题接口:  ${YELLOW}wss://$DOMAIN/ws/search?token=XXX&device_id=YYY${NC}"
echo -e "  📋 查看服务日志:  ${YELLOW}journalctl -u $SERVICE_NAME -f${NC}"
echo -e "  🔄 重启服务:      ${YELLOW}systemctl restart $SERVICE_NAME${NC}"
echo ""
echo -e "${YELLOW}  ⚠️  首次启动后请查看日志获取 ADMIN_KEY:${NC}"
echo -e "  ${YELLOW}journalctl -u $SERVICE_NAME -n 50 | grep ADMIN_KEY${NC}"
echo -e "${GREEN}============================================================${NC}"
