#!/bin/bash
# aagents-tool Web界面启动脚本

PHP="$(command -v php)"
if [ -z "$PHP" ]; then
  PHP="/opt/homebrew/Cellar/php@8.2/8.2.30/bin/php"
fi
WEB_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8080

echo "🚀 正在启动 aagents-tool Web 界面..."
echo ""
echo "📍 访问地址: http://localhost:$PORT"
echo "📁 工作目录: $WEB_DIR"
echo ""
echo "📋 PHP配置:"
echo "   - upload_max_filesize: 100M"
echo "   - post_max_size: 100M"
echo "   - memory_limit: 256M"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""

# 确保目录存在
mkdir -p "$WEB_DIR/uploads" "$WEB_DIR/output" "$WEB_DIR/logs"

# 启动PHP内置服务器，增加上传限制
cd "$WEB_DIR"
exec "$PHP" -d upload_max_filesize=100M \
              -d post_max_size=100M \
              -d memory_limit=256M \
              -d max_execution_time=300 \
              -d max_input_time=300 \
              -S localhost:$PORT -t .
