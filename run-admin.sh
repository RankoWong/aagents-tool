#!/bin/bash
# 启动 AudioAgent 管理后台服务器

PORT=8082
ADMIN_DIR="./web/admin"

# 自动清理旧进程
OLD_PID=$(lsof -ti:$PORT)
if [ ! -z "$OLD_PID" ]; then
    echo "🧹 Cleaning up existing process on port $PORT (PID: $OLD_PID)..."
    kill -9 $OLD_PID
fi

echo "🛡️ Starting AudioAgent Admin Backend..."
echo "📍 Dashboard: http://localhost:$PORT"
echo "📂 Data directory: $ADMIN_DIR"
echo "---------------------------------------"

if [ ! -d "$ADMIN_DIR" ]; then
    echo "❌ Error: Admin directory not found!"
    exit 1
fi

# 检查 PHP 是否安装
if ! command -v php &> /dev/null; then
    echo "❌ Error: PHP is not installed!"
    exit 1
fi

# 启动服务器 (增加上传限制至1G，并提高超时阈值)
php -d upload_max_filesize=1G \
    -d post_max_size=1G \
    -d memory_limit=1024M \
    -d max_execution_time=3600 \
    -d max_input_time=3600 \
    -S 0.0.0.0:$PORT -t "$ADMIN_DIR"
