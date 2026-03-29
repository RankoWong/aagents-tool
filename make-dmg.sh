#!/bin/bash

# Configuration
APP_NAME="AudioAgent"
APP_PATH="build/${APP_NAME}.app"
DMG_NAME="build/${APP_NAME}.dmg"
VOL_NAME="${APP_NAME} Installer"
TMP_DIR="build/dmg_tmp"

echo "🚀 Starting Premium DMG creation for ${APP_NAME}..."

# 1. Check if App exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: ${APP_PATH} not found. Run ./make-app.sh first."
    exit 1
fi

# 2. Cleanup previous
rm -f "$DMG_NAME"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

# 3. Copy App to source folder
echo "📁 Copying App to staging area..."
cp -R "$APP_PATH" "$TMP_DIR/"

# 4. Create symlink to Applications
echo "🔗 Creating Applications shortcut..."
ln -s /Applications "$TMP_DIR/Applications"

# 5. Create raw DMG
echo "💿 Creating raw DMG..."
rm -f "build/pack.temp.dmg"
hdiutil create -volname "${VOL_NAME}" -srcfolder "$TMP_DIR" -ov -format UDRW "build/pack.temp.dmg"

# 6. Mount DMG to set layout
echo "🗺️ Mounting DMG to set layout..."
device=$(hdiutil attach -readwrite -noverify "build/pack.temp.dmg" | egrep '^/dev/' | sed 1q | awk '{print $1}')
sleep 2 # wait for mount

# 7. Use AppleScript to prettify
echo "🎨 Prettifying DMG layout..."
# Setting icon positions and window size
osascript <<EOT
tell application "Finder"
    tell disk "${VOL_NAME}"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {400, 100, 900, 400}
        set theViewOptions to the icon view options of container window
        set icon size of theViewOptions to 100
        set arrangement of theViewOptions to not arranged
        set background picture of theViewOptions to null
        set position of item "${APP_NAME}.app" of container window to {120, 130}
        set position of item "Applications" of container window to {380, 130}
        close
        open
        update without registering applications
        delay 2
    end tell
end tell
EOT

# 8. Unmount and Finalize
sync
hdiutil detach "$device"
sleep 2

echo "📦 Converting to compressed read-only DMG..."
hdiutil convert "build/pack.temp.dmg" -format UDZO -imagekey zlib-level=9 -o "$DMG_NAME"
rm -f "build/pack.temp.dmg"
rm -rf "$TMP_DIR"

echo "✅ Premium DMG Created successfully!"
echo "📍 Location: ${DMG_NAME}"
echo "📊 Size: $(du -sh "$DMG_NAME" | cut -f1)"
