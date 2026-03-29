# AudioAgent Mac 应用

## 📱 应用位置

```
build/AudioAgent.app
```

## 🚀 使用方法

### 方式1：直接运行
双击 `build/AudioAgent.app`

### 方式2：安装到Applications
```bash
# 将应用复制到Applications目录
cp -R "build/AudioAgent.app" /Applications/
```

然后在Launchpad中找到"AudioAgent"并启动

## ✨ 功能特点

- ✅ 双击即可启动，无需手动运行命令
- ✅ **原生 WebView 界面** - Web界面直接在应用窗口中打开，无需浏览器
- ✅ 自动启动PHP服务器
- ✅ 自动选择可用端口（8080-8084），避免冲突
- ✅ 关闭窗口自动停止服务器
- ✅ 支持多文件上传和合并
- ✅ 支持中英文界面切换
- ✅ 应用体积小（仅208KB）

## 📋 系统要求

- macOS 10.13 (High Sierra) 或更高版本
- PHP 8.2+（如果没有安装，应用会提示您安装）

### 安装PHP
```bash
brew install php@8.2
```

## 🏗️ 技术架构

### 原生 Swift + WebView 实现
应用使用 **Swift** 和 **WKWebView** 构建，提供原生 macOS 体验：

- **M4BToolApp.swift** - 主应用程序代码
  - 使用 WKWebView 加载本地 web 界面
  - 自动启动和管理 PHP 服务器进程
  - 动态端口检测（8080-8084）
  - 窗口大小自动保存
  - 关闭窗口时自动清理服务器进程

### 编译和构建
```bash
# 构建应用
./make-app.sh
```

构建脚本会：
1. 编译 Swift 代码为原生可执行文件
2. 复制 web 资源到应用包内
3. 配置 Info.plist（允许本地网络访问）
4. 创建标准的 .app 捆绑包

## 📂 应用结构

```
AudioAgent.app/
├── Contents/
│   ├── Info.plist              # 应用配置文件（含网络安全设置）
│   ├── MacOS/
│   │   └── AudioAgent            # Swift 编译的原生可执行文件
│   └── Resources/
│       ├── web/                # Web界面文件
│       └── aagents-tool.sh     # aagents-tool脚本
```

## 🔧 重新构建应用

如果修改了Web界面或Swift代码，重新构建应用：

```bash
# 如果修改了 Swift 代码
./make-app.sh

# 如果只修改了 web 界面，可以直接刷新应用
# 或重新运行 ./make-app.sh
```

## ⚠️ 注意事项

1. **PHP依赖**：应用依赖系统安装的PHP，不会自带PHP
2. **端口自动选择**：应用会自动尝试8080-8084端口，避免冲突
3. **自动停止服务器**：关闭应用窗口会自动停止PHP服务器，无需手动结束进程
4. **窗口状态保存**：应用会记住窗口的大小和位置

## 🐛 故障排查

### 应用无法启动
1. 检查是否安装了PHP 8.2+
2. 运行 `php -v` 确认PHP版本
3. 检查系统日志：Console.app → 搜索"AudioAgent"

### WebView 无法加载
1. 检查 PHP 服务器是否启动：`ps aux | grep php`
2. 检查端口是否正确：`curl http://localhost:8080`
3. 查看应用控制台输出（如果从终端启动）

### 合并功能不工作
1. 检查aagents-tool脚本权限
2. 查看应用日志：`tail -f build/M4B\ Tool.app/Contents/Resources/web/logs/*.log`

## 📝 开发者信息

- **主应用**：`M4BToolApp.swift` - Swift + WKWebView
- **构建脚本**：`make-app.sh`
- **Web源码**：`web/` 目录
- **aagents-tool脚本**：`aagents-tool.sh`

## 🎯 优势对比

### 与浏览器版本相比
- ✅ 无需手动打开浏览器
- ✅ 更整洁的用户体验
- ✅ 自动进程管理
- ✅ 原生 macOS 窗口行为

### 与纯 bash 版本相比
- ✅ 集成 WebView，无需外部浏览器
- ✅ 更好的进程管理
- ✅ 自动窗口大小保存
- ✅ 原生应用体验
