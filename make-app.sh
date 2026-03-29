#!/bin/bash
# 创建 Mac 应用的脚本（Swift + WebView）

APP_NAME="AudioAgent"
APP_DIR="./build/$APP_NAME.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
WEB_DIR="./web"

echo "🚀 开始创建 Mac 应用 (Swift + WebView)..."

# 清理旧的构建
rm -rf "./build/$APP_NAME.app"

# 创建 .app 目录结构
mkdir -p "$MACOS"
mkdir -p "$RESOURCES"

# 复制 Web 文件到 Resources（排除vendor和临时文件）
echo "📁 复制 Web 文件..."
mkdir -p "$RESOURCES/web"
rsync -av --exclude='vendor' \
          --exclude='uploads/*' \
          --exclude='output/*' \
          --exclude='logs/*' \
          --exclude='admin/updates/*' \
          --exclude='admin/*.json' \
          --exclude='.DS_Store' \
          --exclude='*.log' \
          "$WEB_DIR/" "$RESOURCES/web/"

# 复制命令脚本
cp ./aagents-tool.sh "$RESOURCES/"
cp ./m4b-tool.sh "$RESOURCES/"
chmod +x "$RESOURCES/aagents-tool.sh"
chmod +x "$RESOURCES/m4b-tool.sh"

# 复制 AI 组件
mkdir -p "$RESOURCES/web/bin"
mkdir -p "$RESOURCES/web/models"
cp web/bin/ffmpeg "$RESOURCES/web/bin/" 2>/dev/null || echo "Warning: ffmpeg not found in web/bin"
cp web/bin/whisper-cli "$RESOURCES/web/bin/" 2>/dev/null || echo "Warning: whisper-cli not found in web/bin"
cp web/models.json "$RESOURCES/web/"
if [ -f "web/models/ggml-base.bin" ]; then
    cp web/models/ggml-base.bin "$RESOURCES/web/models/"
fi

# 复制图标文件
if [ -f "./build/AppIcon.icns" ]; then
    cp ./build/AppIcon.icns "$RESOURCES/"
    echo "🎨 图标已添加"
fi

# 编译 Swift 应用
echo "🔨 编译 Swift 应用..."
swiftc -o "$MACOS/$APP_NAME" \
        -O \
        -target x86_64-apple-macosx13.0 \
        -framework Cocoa \
        -framework WebKit \
        -framework AVFoundation \
        -framework ScreenCaptureKit \
        -framework CoreMedia \
        -framework Carbon \
        -framework Quartz \
        -framework QuickLook \
        M4BToolApp.swift

if [ $? -ne 0 ]; then
    echo "❌ Swift 编译失败！"
    exit 1
fi

# 创建 Info.plist
cat > "$CONTENTS/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>AudioAgent</string>
    <key>CFBundleIdentifier</key>
    <string>com.audioagent.webview</string>
    <key>CFBundleName</key>
    <string>AudioAgent</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>AudioAgent needs access to the microphone for recording audio.</string>
    <key>NSScreenCaptureUsageDescription</key>
    <string>AudioAgent needs screen/audio capture permission to record system sound alongside your microphone.</string>
    <key>NSCalendarsUsageDescription</key>
    <string>AudioAgent needs calendar access to schedule meeting events.</string>
    <key>CFBundleShortVersionString</key>
    <string>2.2.0</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
</dict>
</plist>
PLIST

# 获取应用大小
APP_SIZE=$(du -sh "$APP_DIR" | cut -f1)

# 创建并打包 ZIP (用于升级测试)
echo "📦 创建升级压缩包..."
cd ./build
rm -f AudioAgent.zip
zip -r AudioAgent.zip "$APP_NAME.app" > /dev/null
cd ..

echo "✅ 应用创建成功！"
echo "📍 位置: ./build/$APP_NAME.app"
echo "📊 大小: $APP_SIZE"
echo "🎁 升级包: ./build/AudioAgent.zip"
echo ""
echo "使用方法："
echo "1. 双击 ./build/$APP_NAME.app 启动应用"
echo "2. 或将 $APP_NAME.app 拖到 /Applications 目录"
echo ""
echo "注意事项："
echo "- 需要安装 PHP 8.2+: brew install php@8.2"
echo "- Web 界面直接在应用中打开，无需浏览器"
echo "- 关闭窗口会自动停止服务器"

# 打开构建目录
open "./build"
