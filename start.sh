#!/bin/bash

echo "========================================="
echo "   网页考试助手 - 后端守护启动脚本      "
echo "========================================="

# 检查当前目录
CDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$CDIR/server"

# 清理 8000 端口旧进程
PID=$(lsof -ti:8000)
if [ -n "$PID" ]; then
    echo "🧹 清理释放旧的 8000 端口进程 ($PID)..."
    kill -9 $PID 2>/dev/null
    sleep 1
fi

# 检查 python3
if ! command -v python3 &> /dev/null
then
    echo "❌ [错误] 未找到 python3！"
    exit 1
fi

if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate

echo "🚀 以无限守护模式启动 Python 后端..."
echo "📍 对应 Excel 路径: ~/Downloads/final.xlsx"
echo "-----------------------------------------"

# 无限守护循环，防止程序因任何意外挂掉
while true
do
    python3 main.py
    echo "⚠️ Python 服务离线，1秒后自动守护重启..."
    sleep 1
done
