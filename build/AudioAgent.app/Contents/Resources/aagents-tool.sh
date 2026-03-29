#!/bin/bash

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"

PHP="$(command -v php)"
if [ -z "$PHP" ]; then
  PHP="/opt/homebrew/Cellar/php@8.2/8.2.30/bin/php"
fi
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$PROJECT_DIR/bin/m4b-tool.php"
if [ ! -f "$ENTRYPOINT" ]; then
  ENTRYPOINT="$(cd "$PROJECT_DIR/../../../../" 2>/dev/null && pwd)/bin/m4b-tool.php"
fi
if [ ! -f "$ENTRYPOINT" ]; then
  echo "m4b entrypoint not found"
  exit 1
fi

"$PHP" "$ENTRYPOINT" "$@"
