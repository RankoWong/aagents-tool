#!/bin/bash
# m4b-tool 启动脚本

# PHP 8.2 路径
PHP="/opt/homebrew/Cellar/php@8.2/8.2.30/bin/php"
# 项目目录
PROJECT_DIR="/Users/wangdafeng/m4b-tool"

# 执行 m4b-tool
exec "$PHP" "$PROJECT_DIR/bin/m4b-tool.php" "$@"
