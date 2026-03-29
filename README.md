# aagents-tool（原 m4b-tool）中文说明

## 项目简介

aagents-tool 是一个面向有声书与音频整理场景的工具集合，核心能力包括：

- 音频合并（多文件合并为单一输出）
- 音频分割（CLI 可用，按章节拆分）
- 章节处理（章节修正、按静音调整）
- 标签与元数据处理（标题、作者、专辑、封面等）

项目同时提供：

- 命令行工具（CLI）
- Web API + Web 前端
- macOS 桌面应用封装（AudioAgent）



## 总体架构

项目结构可理解为 6 层：

1. **入口层**
   - CLI 入口：[bin/m4b-tool.php](bin/m4b-tool.php)
   - Shell 包装入口（新）：[aagents-tool.sh](aagents-tool.sh)
   - Shell 兼容入口（旧）：[m4b-tool.sh](m4b-tool.sh)

2. **命令层（Symfony Console）**
   - 命令基类：[AbstractCommand.php](src/library/Command/AbstractCommand.php)
   - 子命令：merge / split / chapters / meta

3. **音频执行层**
   - 对 ffmpeg、mp4v2、fdkaac、tone 的封装位于 `src/library/Executables/`
   - 负责真正的转码、探测、标签写入

4. **Web 服务层**
   - API： [web/api.php](web/api.php)
   - 前端：`web/index.html` + `web/assets/`

5. **桌面应用层（macOS）**
   - Swift 宿主： [M4BToolApp.swift](M4BToolApp.swift)
   - 通过 WebView 加载内置 Web 页面并调用 API

6. **打包发布层**
   - 构建 App： [make-app.sh](make-app.sh)
   - 可产出 `.app`、`.zip`，并可进一步生成 `.dmg`

## 功能概览

### CLI 功能

- `merge`：将目录中的多个音频按顺序合并
- `split`：将单一有声书按章节拆分
- `chapters`：章节生成与修正
- `meta`：读取/写入元数据

### Web / Desktop 功能

- 文件上传与排序
- 合并任务后台执行与状态查询
- 日志查看器
- 管理端页面（版本更新相关）
- 说明：当前 Web API 未提供 split 动作，分割请使用 CLI

## 下载后如何运行

## 方式 A：直接使用已构建包（推荐普通用户）

如果你拿到的是构建产物：

- `AudioAgent.app`：可直接双击运行
- `AudioAgent.dmg`：拖入 Applications 安装
- `AudioAgent.zip`：解压后运行 `.app`

构建产物通常位于 `build/` 目录。

## 方式 B：从源码运行（适合开发者）

### 1) 环境准备

- macOS（当前脚本与桌面封装优先面向 macOS）
- PHP 8.2+
- Composer
- ffmpeg（如需完整链路，建议安装）

### 2) 安装依赖

```bash
composer install
chmod +x aagents-tool.sh m4b-tool.sh web/start.sh
```

### 3) 验证 CLI

```bash
./aagents-tool.sh --version
./m4b-tool.sh --version
```

说明：`m4b-tool.sh` 仍保留为兼容入口，会转发到 `aagents-tool.sh`。

### 4) 常见 CLI 用法

```bash
# 合并
./aagents-tool.sh merge "input-folder/" --output-file "output.m4b"

# 分割
./aagents-tool.sh split "book.m4b" --audio-format mp3 --audio-bitrate 96k

# 章节按静音修正
./aagents-tool.sh chapters --adjust-by-silence "book.m4b" -o "book-fixed.m4b"
```

### 5) 运行 Web（开发调试）

```bash
./web/start.sh
```

默认地址：`http://localhost:8080`

注意：

- 当前 API 对调用方有 User-Agent 限制（默认仅允许 AudioAgent 客户端）
- 纯浏览器直接调用 API 可能被拒绝，这是安全策略的一部分

## 方式 C：从源码构建 macOS 应用

```bash
./make-app.sh
```

输出：

- `build/AudioAgent.app`
- `build/AudioAgent.zip`

如需 dmg，可使用：

```bash
./make-dmg.sh
```

## 当前兼容性说明

- 已完成命名迁移：`m4b-tool` -> `aagents-tool`（核心入口与文案）
- 已保留旧入口兼容：`m4b-tool.sh` 继续可用
- Docker 机制已移除（仓库不再维护 Docker 构建链路）

## 目录速览

```text
bin/                 CLI 入口
src/library/         核心业务代码（命令、执行器、标签、章节）
web/                 Web API 与前端
build/               构建产物（.app/.zip/.dmg）
make-app.sh          构建 macOS 应用
aagents-tool.sh      新命令入口
m4b-tool.sh          兼容入口（转发）
```




