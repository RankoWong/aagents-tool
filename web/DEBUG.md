# m4b-tool Web 界面 - 调试指南

## 📋 已添加的日志功能

### 1. 详细日志记录
所有API操作都会被记录到 `web/logs/api_YYYY-MM-DD.log` 文件中。

日志格式：
```
[2025-01-22 20:00:00] [INFO] === Request Start ===
[2025-01-22 20:00:00] [INFO] Action: upload
[2025-01-22 20:00:00] [INFO] Method: POST
[2025-01-22 20:00:00] [INFO] URI: /api.php?action=upload
[2025-01-22 20:00:00] [INFO] IP: 127.0.0.1
[2025-01-22 20:00:00] [INFO] 开始处理文件上传...
[2025-01-22 20:00:00] [INFO] 任务目录创建成功: /path/to/uploads/task_xxx
[2025-01-22 20:00:00] [INFO] 上传的文件数量: 3
[2025-01-22 20:00:00] [INFO] PHP配置 - upload_max_filesize: 2M, post_max_size: 8M, memory_limit: 128M
[2025-01-22 20:00:01] [INFO] 处理文件 [0]: test.mp3 (大小: 1024000 bytes, 错误代码: 0)
[2025-01-22 20:00:01] [SUCCESS] 文件上传成功: test.mp3 -> /path/to/file (实际大小: 1024000 bytes)
```

### 2. 日志级别
- **INFO** - 一般信息
- **SUCCESS** - 操作成功
- **WARNING** - 警告信息
- **ERROR** - 错误信息

## 🔍 如何调试上传问题

### 步骤1：打开浏览器控制台

1. 打开 http://localhost:8080
2. 按 F12 打开开发者工具
3. 切换到 "Console" 标签

### 步骤2：尝试上传文件

1. 选择一个音频文件上传
2. 观察控制台输出：
   ```
   开始上传文件... FileList {0: File}
   FormData准备完成，文件数量: 1
   响应状态: 200
   响应数据: {success: true, taskId: "task_xxx", ...}
   ```

### 步骤3：检查错误信息

如果上传失败，控制台会显示：
```
❌ 上传失败：错误信息

调试信息:
{
  "uploaded_count": 0,
  "php_config": {
    "upload_max_filesize": "2M",
    "post_max_size": "8M",
    "memory_limit": "128M"
  }
}
```

### 步骤4：查看详细日志

点击页面顶部的 **"📋 查看日志（调试用）"** 链接，或直接访问：
```
http://localhost:8080/logs.html
```

日志查看器功能：
- ✅ 实时刷新日志（可开启3秒自动刷新）
- ✅ 按级别过滤（ERROR/WARNING/SUCCESS/INFO）
- ✅ 搜索日志内容
- ✅ 查看统计信息（总行数、错误数等）
- ✅ 下载日志文件

## 🛠️ 常见问题排查

### 问题1：文件无法上传

#### 检查项：
1. **PHP上传限制**
   ```bash
   # 查看当前PHP配置
   php -i | grep upload
   php -i | grep post_max_size
   php -i | grep memory_limit
   ```

   解决方案：
   ```bash
   # 编辑php.ini或创建.user.ini
   echo "upload_max_filesize=100M" > web/.user.ini
   echo "post_max_size=100M" >> web/.user.ini
   echo "memory_limit=256M" >> web/.user.ini
   ```

2. **目录权限**
   ```bash
   ls -la web/uploads
   ls -la web/output
   ls -la web/logs
   ```

   应该显示 `drwxr-xr-x` 或 `drwxrwxrwx`

   解决方案：
   ```bash
   chmod 755 web/uploads web/output web/logs
   ```

3. **磁盘空间**
   ```bash
   df -h /Users/wangdafeng/m4b-tool
   ```

### 问题2：日志显示"文件格式不支持"

日志会显示：
```
[2025-01-22 20:00:00] [WARNING] 文件格式不支持: xyz (文件: test.xyz)
```

解决方案：
- 确认文件扩展名是：mp3, m4a, m4b, aac, ogg, flac, wav, wma
- 检查文件是否真实为音频文件

### 问题3：日志显示"文件移动失败"

日志会显示：
```
[2025-01-22 20:00:00] [ERROR] 文件移动失败: /tmp/phpXXX -> /path/to/file
[2025-01-22 20:00:00] [ERROR] 检查源文件是否存在: NO
```

这通常表示：
- PHP临时目录配置错误
- 文件上传中途被中断
- 文件大小超过限制

### 问题4：响应超时

如果处理大文件时超时：

1. 增加PHP执行时间限制：
   ```bash
   echo "max_execution_time=300" > web/.user.ini
   echo "max_input_time=300" >> web/.user.ini
   ```

2. 检查m4b-tool是否正常运行：
   ```bash
   /Users/wangdafeng/m4b-tool/m4b-tool.sh --version
   ```

## 📊 日志分析示例

### 成功的上传日志
```
[2025-01-22 20:00:00] [INFO] === Request Start ===
[2025-01-22 20:00:00] [INFO] Action: upload
[2025-01-22 20:00:00] [INFO] Method: POST
[2025-01-22 20:00:00] [INFO] 开始处理文件上传...
[2025-01-22 20:00:00] [INFO] 任务目录创建成功
[2025-01-22 20:00:00] [INFO] 上传的文件数量: 1
[2025-01-22 20:00:00] [INFO] PHP配置 - upload_max_filesize: 2M, post_max_size: 8M
[2025-01-22 20:00:01] [INFO] 处理文件 [0]: test.mp3 (大小: 1024000 bytes)
[2025-01-22 20:00:02] [SUCCESS] 文件上传成功
[2025-01-22 20:00:02] [INFO] 上传完成！成功上传 1 个文件
[2025-01-22 20:00:02] [INFO] Response Status: 200
[2025-01-22 20:00:02] [INFO] === Request End ===
```

### 失败的上传日志（文件太大）
```
[2025-01-22 20:00:00] [ERROR] 上传失败：没有文件被上传
[2025-01-22 20:00:00] [ERROR] 没有成功上传任何文件
[2025-01-22 20:00:00] [INFO] Response Status: 400
```

然后在浏览器控制台会看到：
```json
{
  "error": "没有成功上传任何文件",
  "debug": {
    "uploaded_count": 0,
    "php_config": {
      "upload_max_filesize": "2M",
      "post_max_size": "8M"
    }
  }
}
```

## 🧪 测试步骤

### 基本功能测试

1. **测试小文件上传**（< 1MB）
   - 上传一个小的MP3文件
   - 查看日志是否显示 SUCCESS
   - 检查文件是否出现在文件列表中

2. **测试多文件上传**
   - 同时选择2-3个文件
   - 检查日志中是否显示所有文件
   - 验证文件顺序是否正确

3. **测试拖拽排序**
   - 上传多个文件
   - 拖动文件调整顺序
   - 查看日志中是否记录了reorder操作

4. **测试合并功能**
   - 上传几个测试文件
   - 点击"开始合并"
   - 实时查看进度和日志

### 日志查看器测试

1. **基本查看**
   - 访问 http://localhost:8080/logs.html
   - 查看是否有日志显示
   - 检查统计信息是否正确

2. **过滤功能**
   - 选择"只看错误"级别
   - 输入搜索关键词（如"上传"）
   - 验证过滤结果

3. **自动刷新**
   - 勾选"自动刷新 (3秒)"
   - 在主页面执行操作
   - 观察日志是否自动更新

## 💡 调试技巧

### 1. 使用curl测试API
```bash
# 测试日志查看
curl "http://localhost:8080/api.php?action=view_logs&lines=10"

# 测试上传（需要文件）
curl -X POST -F "files=@test.mp3" "http://localhost:8080/api.php?action=upload"
```

### 2. 直接查看日志文件
```bash
# 查看今天的日志
tail -f web/logs/api_$(date +%Y-%m-%d).log

# 查看最后100行
tail -n 100 web/logs/api_$(date +%Y-%m-%d).log

# 搜索错误
grep ERROR web/logs/api_$(date +%Y-%m-%d).log
```

### 3. 监控PHP错误日志
```bash
# 查看PHP错误日志
tail -f /tmp/m4b-web-server.log
```

### 4. 检查目录结构
```bash
# 查看uploads目录
ls -lhR web/uploads/

# 查看output目录
ls -lhR web/output/

# 查看日志目录
ls -lh web/logs/
```

## 📝 收集诊断信息

如果需要报告问题，请提供以下信息：

1. **浏览器控制台输出**
   - 打开开发者工具（F12）
   - 复制所有红色错误信息
   - 截图网络请求信息

2. **日志文件**
   - 访问 http://localhost:8080/logs.html
   - 点击"下载日志"
   - 附上日志文件

3. **系统信息**
   ```bash
   # PHP版本
   php -v

   # PHP配置
   php -i | grep -E "upload|max_filesize|memory"

   # 磁盘空间
   df -h

   # m4b-tool版本
   ./m4b-tool.sh --version

   # ffmpeg版本
   ffmpeg -version
   ```

## 🚨 紧急恢复

如果Web界面完全无法使用，可以：

1. **停止Web服务器**
   ```bash
   # 找到并杀掉PHP进程
   ps aux | grep "php.*8080"
   kill -9 <PID>
   ```

2. **清理临时文件**
   ```bash
   rm -rf web/uploads/*
   rm -rf web/output/*
   ```

3. **重置日志**
   ```bash
   rm -f web/logs/*.log
   ```

4. **重启服务**
   ```bash
   cd /Users/wangdafeng/m4b-tool
   ./web/start.sh
   ```

---

**准备好测试了吗？** 🚀

访问 http://localhost:8080 开始测试！
