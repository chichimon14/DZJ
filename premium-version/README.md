# 考试助手 Premium v52 - 腾讯云商业化全自动搜题系统

> 本版本为商业化云端部署版，代码位于 `premium-version/` 目录，存储于本地 `premium-version` Git 分支。

---

## 📁 文件结构

```
premium-version/
├── server/                    # Python FastAPI 云端后端
│   ├── main.py                # 核心服务（WSS + HTTP 搜题 + 管理 API）
│   ├── auth.py                # 卡密鉴权与设备绑定
│   ├── pay.py                 # 支付网关与自动发卡
│   ├── models.py              # SQLite 数据库模型
│   ├── parser.py              # 标准 Excel 题库解析引擎
│   ├── requirements.txt       # Python 依赖包
│   └── static/
│       ├── admin.html         # 超级管理员 Web 控制台
│       └── buy.html           # 用户自助购买与自动发卡页
├── userscript/
│   └── exam_assistant.user.js # 油猴脚本 v52（全平台）
├── mobile-app/                # Android WebView 壳工程（待开发）
└── deploy_cloud.sh            # 腾讯云 Ubuntu 一键部署脚本
```

---

## 🚀 快速部署（腾讯云 175.178.78.88）

### 第一步：上传文件到服务器
```bash
scp -r premium-version/ root@175.178.78.88:/opt/exam-assistant-src/
```

### 第二步：SSH 登录服务器并一键部署
```bash
ssh root@175.178.78.88
cd /opt/exam-assistant-src/premium-version
chmod +x deploy_cloud.sh
sudo ./deploy_cloud.sh
```
> 脚本会自动：安装 Python 环境、配置 Nginx SSL 反代、申请 Let's Encrypt 证书、设置 Systemd 守护服务。

### 第三步：获取管理员密钥
```bash
journalctl -u exam-assistant -n 80 | grep -A2 "ADMIN_KEY"
```

---

## ⚙️ 支付配置

部署后访问 `https://你的域名/admin`，使用 ADMIN_KEY 登录，在**系统设置**中配置：
- 易支付 PID / KEY / API 地址
- 支付成功异步通知地址：`https://你的域名/api/pay/notify`
- 支付成功跳转地址：`https://你的域名/?order_id=xxx`

---

## 📋 Excel 题库标准格式

| 序号 | 题干 | 答案 | 详细答案 |
|------|------|------|----------|
| 1 | 消防栓的使用方法是... | AB | A. 打开阀门 B. 拉出水带 C. ... D. ... |
| 2 | 以下说法正确的是 | 正确 | （判断题，无选项）|

---

## 💳 卡密类型

| 类型 | 说明 | 默认价格 |
|------|------|----------|
| 周卡（7天）| TIME 类型 | ¥9.9 |
| 月卡（30天）| TIME 类型 | ¥29.9 |
| 年卡（365天）| TIME 类型 | ¥199 |
| 买断卡（永久）| LIFETIME 类型 | ¥399 |

---

## 🛡️ 安全说明

- 所有 Token 鉴权通过 WSS 握手参数传递，HTTPS 全程加密。
- 一机一码设备锁：单 Token 仅绑定 1 台设备，防共享防盗刷。
- 管理员 ADMIN_KEY 首次启动自动生成，仅在服务器日志中显示一次。

---

## 📱 全平台支持

| 平台 | 使用方式 |
|------|----------|
| PC Chrome/Edge | 安装 Tampermonkey，加载 `exam_assistant.user.js` |
| Android | Kiwi Browser + Tampermonkey |
| iOS | Safari + Stay 扩展 / Userscripts 扩展 |
| 小白手机用户 | 专属 Android APK（内置注入，无需安装插件）|
