# 🧪 快速测试指南

## ✅ 日志功能已就绪

### 现在可以测试了！

访问：**http://localhost:8080**

## 📋 测试清单

### 1️⃣ 打开浏览器控制台
```
按 F12 或右键 -> 检查 -> Console标签
```

### 2️⃣ 测试上传文件
1. 在"合并"页面，点击上传区域
2. 选择一个音频文件（MP3/M4A等）
3. **观察控制台输出**：
   ```
   开始上传文件... FileList {0: File}
   FormData准备完成，文件数量: 1
   响应状态: 200
   响应数据: {...}
   ```

### 3️⃣ 查看详细日志
**方式1：** 点击页面顶部的 "📋 查看日志（调试用）"

**方式2：** 直接访问 http://localhost:8080/logs.html

在日志查看器中可以看到：
- ✅ 所有API请求
- ✅ 文件上传详情
- ✅ 错误信息（如果有）
- ✅ 统计信息

### 4️⃣ 常见日志输出示例

#### 成功上传：
```
[2025-01-22 XX:XX:XX] [INFO] === Request Start ===
[2025-01-22 XX:XX:XX] [INFO] Action: upload
[2025-01-22 XX:XX:XX] [INFO] 开始处理文件上传...
[2025-01-22 XX:XX:XX] [SUCCESS] 文件上传成功: test.mp3
[2025-01-22 XX:XX:XX] [INFO] 上传完成！成功上传 1 个文件
```

#### 文件太大：
```
[2025-01-22 XX:XX:XX] [ERROR] 上传失败：没有文件被上传
[2025-01-22 XX:XX:XX] [ERROR] 没有成功上传任何文件
```

#### 格式不支持：
```
[2025-01-22 XX:XX:XX] [WARNING] 文件格式不支持: xyz (文件: test.xyz)
```

## 🐛 如果上传失败

### 步骤1：查看浏览器错误
控制台会显示：
```javascript
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

### 步骤2：查看详细日志
访问 http://localhost:8080/logs.html

日志会显示：
- 具体哪一步失败了
- 错误的详细原因
- PHP配置信息
- 文件路径和权限信息

### 步骤3：检查服务器日志
```bash
# 查看PHP Web服务器日志
tail -f /tmp/m4b-web-server.log

# 查看API日志
tail -f web/logs/api_$(date +%Y-%m-%d).log
```

## 🔧 快速修复

### PHP上传限制太小
```bash
# 创建配置文件
cat > web/.user.ini << 'EOF'
upload_max_filesize=100M
post_max_size=100M
memory_limit=256M
max_execution_time=300
EOF

# 重启Web服务器
# 在运行start.sh的终端按 Ctrl+C，然后重新运行
cd /Users/wangdafeng/m4b-tool
./web/start.sh
```

### 目录权限问题
```bash
chmod 755 web/uploads web/output web/logs
```

## 📊 日志查看器功能

访问 http://localhost:8080/logs.html 可以：

1. **实时刷新**
   - 勾选"自动刷新 (3秒)"
   - 每次操作后自动显示最新日志

2. **过滤日志**
   - 按级别：ERROR/WARNING/SUCCESS/INFO
   - 按关键词：搜索"上传"、"错误"等

3. **查看统计**
   - 总行数
   - 错误数量
   - 警告数量
   - 成功操作数量

4. **下载日志**
   - 点击"💾 下载日志"按钮
   - 保存为本地文件分析

## 📝 测试时需要提供的信息

如果遇到问题，请提供：

1. **浏览器控制台截图**（F12 -> Console）
2. **日志内容**
   - 从日志查看器复制
   - 或下载日志文件
3. **具体操作步骤**
   - 做了什么操作
   - 期望的结果
   - 实际的结果

## 🚀 开始测试

一切就绪！现在可以：

1. 打开 http://localhost:8080
2. 按F12打开控制台
3. 尝试上传文件
4. 观察控制台和日志
5. 如果有错误，查看日志获取详细信息

祝测试顺利！ 🎉
