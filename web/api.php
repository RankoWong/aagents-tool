<?php
/**
 * m4b-tool Web API
 * 提供文件上传、合并、分割等功能的API接口
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// 处理 OPTIONS 请求
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// 设置时区
date_default_timezone_set('Asia/Shanghai');

// 配置
define('UPLOAD_DIR', __DIR__ . '/uploads/');
define('OUTPUT_DIR', __DIR__ . '/output/');
define('LOG_DIR', __DIR__ . '/logs/');
define('M4B_TOOL', __DIR__ . '/../m4b-tool.sh');
define('PHP_BIN', '/opt/homebrew/Cellar/php@8.2/8.2.30/bin/php');

// 确保目录存在
foreach ([UPLOAD_DIR, OUTPUT_DIR, LOG_DIR] as $dir) {
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
}

/**
 * 日志记录函数
 */
function writeLog($message, $level = 'INFO') {
    $logFile = LOG_DIR . 'api_' . date('Y-m-d') . '.log';
    $timestamp = date('Y-m-d H:i:s');
    $logMessage = "[$timestamp] [$level] $message" . PHP_EOL;

    // 写入日志文件
    file_put_contents($logFile, $logMessage, FILE_APPEND | LOCK_EX);

    // 同时输出到错误日志（PHP错误日志）
    error_log($logMessage);
}

/**
 * 记录请求信息
 */
function logRequest($action, $data = []) {
    writeLog("=== Request Start ===");
    writeLog("Action: $action");
    writeLog("Method: " . $_SERVER['REQUEST_METHOD']);
    writeLog("URI: " . $_SERVER['REQUEST_URI']);
    writeLog("IP: " . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));

    if (!empty($data)) {
        writeLog("Data: " . json_encode($data, JSON_UNESCAPED_UNICODE));
    }

    // 记录上传文件信息
    if (!empty($_FILES)) {
        writeLog("Files: " . json_encode($_FILES, JSON_UNESCAPED_UNICODE));
    }
}

/**
 * 记录响应信息
 */
function logResponse($data, $statusCode = 200) {
    writeLog("Response Status: $statusCode");
    writeLog("Response Data: " . json_encode($data, JSON_UNESCAPED_UNICODE));
    writeLog("=== Request End ===\n");
}

/**
 * 获取上传错误信息
 */
function getUploadErrorMessage($errorCode) {
    $errors = [
        UPLOAD_ERR_INI_SIZE => '文件超过 php.ini 中 upload_max_filesize 设置',
        UPLOAD_ERR_FORM_SIZE => '文件超过表单中 MAX_FILE_SIZE 设置',
        UPLOAD_ERR_PARTIAL => '文件只有部分被上传',
        UPLOAD_ERR_NO_FILE => '没有文件被上传',
        UPLOAD_ERR_NO_TMP_DIR => '找不到临时文件夹',
        UPLOAD_ERR_CANT_WRITE => '文件写入失败',
        UPLOAD_ERR_EXTENSION => 'PHP扩展停止了文件上传'
    ];

    return $errors[$errorCode] ?? "未知上传错误 (错误码: $errorCode)";
}

/**
 * 返回JSON响应
 */
function jsonResponse($data, $statusCode = 200) {
    logResponse($data, $statusCode);
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * 执行 m4b-tool 命令
 */
function execM4bTool($command, &$output = null, &$returnVar = null) {
    $cmd = M4B_TOOL . ' ' . $command . ' 2>&1';
    exec($cmd, $output, $returnVar);
    return $returnVar === 0;
}

/**
 * 生成任务ID
 */
function generateTaskId() {
    return uniqid('task_', true);
}

/**
 * 清理过期文件
 */
function cleanOldFiles($dir, $maxAge = 3600) {
    $files = glob($dir . '*');
    $now = time();
    foreach ($files as $file) {
        if (is_file($file) && ($now - filemtime($file) > $maxAge)) {
            @unlink($file);
        }
    }
}

// 清理旧文件
cleanOldFiles(UPLOAD_DIR);
cleanOldFiles(OUTPUT_DIR);

// 获取请求
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// 记录所有请求（除了日志查看本身）
if ($action !== 'view_logs') {
    logRequest($action, $_REQUEST);
}

// 查看日志（管理员功能）
if ($action === 'view_logs' && $method === 'GET') {
    $logFile = LOG_DIR . 'api_' . date('Y-m-d') . '.log';

    if (!file_exists($logFile)) {
        jsonResponse([
            'success' => true,
            'logs' => '暂无日志'
        ]);
    }

    $lines = $_GET['lines'] ?? 100; // 默认显示最后100行
    $logContent = file_get_contents($logFile);

    if ($lines > 0) {
        $logArray = explode("\n", $logContent);
        $logArray = array_slice($logArray, -$lines);
        $logContent = implode("\n", $logArray);
    }

    jsonResponse([
        'success' => true,
        'logFile' => basename($logFile),
        'logs' => $logContent,
        'totalLines' => count(explode("\n", file_get_contents($logFile)))
    ]);
}

// 处理文件上传
if ($action === 'upload' && $method === 'POST') {
    logRequest('upload', $_POST);

    if (!isset($_FILES['files'])) {
        writeLog('上传失败：没有文件被上传', 'ERROR');
        jsonResponse(['error' => '没有上传文件', 'debug' => '$_FILES["files"] not set'], 400);
    }

    writeLog('开始处理文件上传...');

    // 检查是否指定了任务ID（追加模式）
    $taskId = $_POST['taskId'] ?? null;
    $taskDir = '';
    $existingFileCount = 0;

    if ($taskId && is_dir(UPLOAD_DIR . $taskId)) {
        // 追加到现有任务
        $taskDir = UPLOAD_DIR . $taskId . '/';
        $existingFiles = glob($taskDir . '*');
        $existingFileCount = count($existingFiles);
        writeLog("追加到现有任务: $taskId (已有 $existingFileCount 个文件)");
    } else {
        // 创建新任务
        $taskId = generateTaskId();
        $taskDir = UPLOAD_DIR . $taskId . '/';

        if (!mkdir($taskDir, 0755, true)) {
            writeLog('创建任务目录失败: ' . $taskDir, 'ERROR');
            jsonResponse(['error' => '创建任务目录失败', 'debug' => $taskDir], 500);
        }
        writeLog('任务目录创建成功: ' . $taskDir);
    }

    $files = [];
    $uploadedFiles = $_FILES['files'];

    // 确保文件数据是数组格式
    if (!isset($uploadedFiles['name'])) {
        writeLog('上传失败：没有找到文件数据', 'ERROR');
        jsonResponse(['error' => '没有文件数据', 'debug' => '$_FILES["files"]["name"] not set'], 400);
    }

    // 统一转换为多文件格式
    if (!is_array($uploadedFiles['name'])) {
        $uploadedFiles = [
            'name' => [$uploadedFiles['name']],
            'tmp_name' => [$uploadedFiles['tmp_name']],
            'error' => [$uploadedFiles['error']],
            'size' => [$uploadedFiles['size']],
            'type' => [$uploadedFiles['type']],
            'full_path' => [$uploadedFiles['full_path'] ?? '']
        ];
        writeLog('转换单文件格式为多文件格式');
    }

    writeLog('上传的文件数量: ' . count($uploadedFiles['name']));

    // 检查PHP上传配置
    $maxUpload = ini_get('upload_max_filesize');
    $maxPost = ini_get('post_max_size');
    $memoryLimit = ini_get('memory_limit');
    writeLog("PHP配置 - upload_max_filesize: $maxUpload, post_max_size: $maxPost, memory_limit: $memoryLimit");

    // 处理多个文件
    if (is_array($uploadedFiles['name'])) {
        $fileCount = count($uploadedFiles['name']);
        writeLog("开始处理 $fileCount 个文件");

        for ($i = 0; $i < $fileCount; $i++) {
            $fileName = $uploadedFiles['name'][$i];
            $tmpName = $uploadedFiles['tmp_name'][$i];
            $error = $uploadedFiles['error'][$i];
            $fileSize = $uploadedFiles['size'][$i];

            writeLog("处理文件 [$i]: $fileName (大小: $fileSize bytes, 错误代码: $error)");

            if ($error === UPLOAD_ERR_OK) {
                $ext = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));
                $allowedExts = ['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'flac', 'wav', 'wma'];

                if (in_array($ext, $allowedExts)) {
                    $safeName = preg_replace('/[^a-zA-Z0-9._-]/', '_', $fileName);
                    $destFile = $taskDir . sprintf('%03d_', $existingFileCount + $i + 1) . $safeName;

                    writeLog("目标文件: $destFile");

                    if (move_uploaded_file($tmpName, $destFile)) {
                        $actualSize = filesize($destFile);
                        writeLog("文件上传成功: $fileName -> $destFile (实际大小: $actualSize bytes)", 'SUCCESS');

                        $files[] = [
                            'name' => $fileName,
                            'file' => basename($destFile),
                            'size' => $actualSize,
                            'path' => $destFile
                        ];
                    } else {
                        writeLog("文件移动失败: $tmpName -> $destFile", 'ERROR');
                        writeLog("检查源文件是否存在: " . (file_exists($tmpName) ? 'YES' : 'NO'), 'ERROR');
                    }
                } else {
                    writeLog("文件格式不支持: $ext (文件: $fileName)", 'WARNING');
                }
            } else {
                $errorMsg = getUploadErrorMessage($error);
                writeLog("文件上传错误 [$i]: $errorMsg (错误码: $error)", 'ERROR');
            }
        }
    } else {
        writeLog('$_FILES["files"] 不是数组', 'ERROR');
    }

    if (empty($files)) {
        writeLog('没有成功上传任何文件', 'ERROR');
        jsonResponse([
            'error' => '没有成功上传任何文件',
            'debug' => [
                'uploaded_count' => $fileCount ?? 0,
                'php_config' => [
                    'upload_max_filesize' => $maxUpload,
                    'post_max_size' => $maxPost,
                    'memory_limit' => $memoryLimit
                ]
            ]
        ], 400);
    }

    writeLog("上传完成！成功上传 " . count($files) . " 个文件", 'SUCCESS');

    jsonResponse([
        'success' => true,
        'taskId' => $taskId,
        'files' => $files,
        'fileCount' => count($files)
    ]);
}

// 获取任务信息
if ($action === 'task_info' && $method === 'GET') {
    $taskId = $_GET['taskId'] ?? '';
    if (!$taskId || !is_dir(UPLOAD_DIR . $taskId)) {
        jsonResponse(['error' => '任务不存在'], 404);
    }

    $taskDir = UPLOAD_DIR . $taskId . '/';
    $files = glob($taskDir . '*');
    $fileList = [];

    foreach ($files as $file) {
        if (is_file($file)) {
            $fileList[] = [
                'name' => basename($file),
                'size' => filesize($file)
            ];
        }
    }

    // 按文件名排序（因为文件名包含序号前缀）
    usort($fileList, function($a, $b) {
        return strcmp($a['name'], $b['name']);
    });

    jsonResponse([
        'success' => true,
        'taskId' => $taskId,
        'files' => $fileList
    ]);
}

// 调整文件顺序
if ($action === 'reorder' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $taskId = $input['taskId'] ?? '';
    $order = $input['order'] ?? [];

    if (!$taskId || !is_dir(UPLOAD_DIR . $taskId)) {
        jsonResponse(['error' => '任务不存在'], 404);
    }

    if (empty($order)) {
        jsonResponse(['error' => '顺序为空'], 400);
    }

    $taskDir = UPLOAD_DIR . $taskId . '/';

    // 重命名文件以调整顺序
    foreach ($order as $index => $fileName) {
        $oldPath = $taskDir . $fileName;
        if (file_exists($oldPath)) {
            $ext = pathinfo($fileName, PATHINFO_EXTENSION);
            $origName = preg_replace('/^\d+_/', '', $fileName);
            $newName = sprintf('%03d_', $index + 1) . $origName;
            $newPath = $taskDir . $newName;

            if ($oldPath !== $newPath) {
                rename($oldPath, $newPath);
            }
        }
    }

    jsonResponse(['success' => true, 'message' => '顺序已更新']);
}

// 执行合并
if ($action === 'merge' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $taskId = $input['taskId'] ?? '';
    $options = $input['options'] ?? [];

    if (!$taskId || !is_dir(UPLOAD_DIR . $taskId)) {
        jsonResponse(['error' => '任务不存在'], 404);
    }

    $taskDir = UPLOAD_DIR . $taskId . '/';
    $outputFile = OUTPUT_DIR . $taskId . '.m4a';

    // 构建命令
    $cmd = M4B_TOOL . ' merge "' . $taskDir . '" --output-file="' . $outputFile . '" --skip-cover';

    // 添加选项
    if (!empty($options['name'])) {
        $cmd .= ' --name="' . escapeshellarg($options['name']) . '"';
    }
    if (!empty($options['artist'])) {
        $cmd .= ' --artist="' . escapeshellarg($options['artist']) . '"';
    }
    if (!empty($options['album'])) {
        $cmd .= ' --album="' . escapeshellarg($options['album']) . '"';
    }
    if (!empty($options['genre'])) {
        $cmd .= ' --genre="' . escapeshellarg($options['genre']) . '"';
    }
    if (!empty($options['audioBitrate'])) {
        $cmd .= ' --audio-bitrate=' . escapeshellarg($options['audioBitrate']);
    }

    // 执行合并
    $output = [];
    $returnVar = 0;

    // 使用后台进程执行
    $logFile = OUTPUT_DIR . $taskId . '.log';
    $backgroundCmd = 'nohup sh -c "' . str_replace('"', '\\"', $cmd) . '" > "' . $logFile . '" 2>&1 &';

    exec($backgroundCmd, $output, $returnVar);

    jsonResponse([
        'success' => true,
        'message' => '合并任务已开始',
        'taskId' => $taskId,
        'outputFile' => basename($outputFile)
    ]);
}

// 执行分割
if ($action === 'split' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $taskId = $_POST['taskId'] ?? '';
    $options = $_POST['options'] ?? json_decode($_POST['options'] ?? '{}', true);

    if (!$taskId) {
        jsonResponse(['error' => '缺少任务ID'], 400);
    }

    // 检查上传的文件
    if (!isset($_FILES['file'])) {
        jsonResponse(['error' => '没有上传文件'], 400);
    }

    $taskDir = UPLOAD_DIR . $taskId . '/';
    mkdir($taskDir, 0755, true);

    $uploadedFile = $_FILES['file'];
    $fileName = $uploadedFile['name'];
    $tmpName = $uploadedFile['tmp_name'];

    $destFile = $taskDir . $fileName;
    if (!move_uploaded_file($tmpName, $destFile)) {
        jsonResponse(['error' => '文件上传失败'], 500);
    }

    $outputDir = OUTPUT_DIR . $taskId . '/';
    mkdir($outputDir, 0755, true);

    // 构建命令
    $cmd = M4B_TOOL . ' split "' . $destFile . '" --output-dir="' . $outputDir . '"';

    // 添加选项
    if (!empty($options['audioFormat'])) {
        $cmd .= ' --audio-format=' . escapeshellarg($options['audioFormat']);
    }
    if (!empty($options['audioBitrate'])) {
        $cmd .= ' --audio-bitrate=' . escapeshellarg($options['audioBitrate']);
    }
    if (!empty($options['audioChannels'])) {
        $cmd .= ' --audio-channels=' . escapeshellarg($options['audioChannels']);
    }

    // 执行分割
    $output = [];
    $returnVar = 0;

    $logFile = OUTPUT_DIR . $taskId . '.log';
    $backgroundCmd = 'nohup sh -c "' . str_replace('"', '\\"', $cmd) . '" > "' . $logFile . '" 2>&1 &';

    exec($backgroundCmd, $output, $returnVar);

    jsonResponse([
        'success' => true,
        'message' => '分割任务已开始',
        'taskId' => $taskId
    ]);
}

// 获取任务状态
if ($action === 'status' && $method === 'GET') {
    $taskId = $_GET['taskId'] ?? '';

    if (!$taskId) {
        jsonResponse(['error' => '缺少任务ID'], 400);
    }

    $logFile = OUTPUT_DIR . $taskId . '.log';
    $outputFile = OUTPUT_DIR . $taskId . '.m4a';
    $outputDir = OUTPUT_DIR . $taskId . '/';

    $status = 'processing';
    $progress = 0;
    $log = [];

    if (file_exists($logFile)) {
        $log = array_slice(file($logFile), -50); // 获取最后50行
        $logContent = implode('', $log);

        // 简单的进度判断
        if (preg_match('/Processing|Encoding|Converting/i', $logContent)) {
            $progress = 50;
        }
        if (preg_match('/finished|completed|done/i', $logContent)) {
            $progress = 100;
        }
    }

    // 检查是否完成
    if (file_exists($outputFile) && filesize($outputFile) > 0) {
        $status = 'completed';
        $progress = 100;
    } elseif (is_dir($outputDir) && count(glob($outputDir . '*')) > 0) {
        // 分割任务：检查输出目录
        $status = 'completed';
        $progress = 100;
    }

    // 检查是否失败（超时或错误）
    if (file_exists($logFile) && (time() - filemtime($logFile) > 300)) {
        // 5分钟没有更新
        if ($progress < 100) {
            $status = 'timeout';
        }
    }

    jsonResponse([
        'success' => true,
        'status' => $status,
        'progress' => $progress,
        'log' => array_map('trim', $log),
        'outputExists' => file_exists($outputFile),
        'outputSize' => file_exists($outputFile) ? filesize($outputFile) : 0
    ]);
}

// 下载文件
if ($action === 'download' && $method === 'GET') {
    $taskId = $_GET['taskId'] ?? '';
    $file = $_GET['file'] ?? '';

    if (!$taskId) {
        jsonResponse(['error' => '缺少任务ID'], 400);
    }

    $outputDir = OUTPUT_DIR . $taskId . '/';
    $outputFile = OUTPUT_DIR . $taskId . '.m4a';

    if ($file && file_exists($outputDir . $file)) {
        $filePath = $outputDir . $file;
    } elseif (file_exists($outputFile)) {
        $filePath = $outputFile;
    } else {
        jsonResponse(['error' => '文件不存在'], 404);
    }

    // 设置下载头
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . basename($filePath) . '"');
    header('Content-Length: ' . filesize($filePath));
    header('Pragma: no-cache');
    header('Expires: 0');

    readfile($filePath);
    exit;
}

// 获取输出文件列表
if ($action === 'list_output' && $method === 'GET') {
    $taskId = $_GET['taskId'] ?? '';

    if (!$taskId) {
        jsonResponse(['error' => '缺少任务ID'], 400);
    }

    $outputDir = OUTPUT_DIR . $taskId . '/';
    $outputFile = OUTPUT_DIR . $taskId . '.m4a';

    $files = [];

    if (file_exists($outputFile)) {
        $files[] = [
            'name' => basename($outputFile),
            'size' => filesize($outputFile),
            'type' => 'merge',
            'downloadUrl' => '?action=download&taskId=' . $taskId
        ];
    }

    if (is_dir($outputDir)) {
        $outputFiles = glob($outputDir . '*');
        foreach ($outputFiles as $file) {
            if (is_file($file)) {
                $files[] = [
                    'name' => basename($file),
                    'size' => filesize($file),
                    'type' => 'split',
                    'downloadUrl' => '?action=download&taskId=' . $taskId . '&file=' . basename($file)
                ];
            }
        }
    }

    jsonResponse([
        'success' => true,
        'files' => $files
    ]);
}

// 删除任务
if ($action === 'delete' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $taskId = $input['taskId'] ?? '';

    if (!$taskId) {
        jsonResponse(['error' => '缺少任务ID'], 400);
    }

    $taskDir = UPLOAD_DIR . $taskId . '/';
    $outputFile = OUTPUT_DIR . $taskId . '.m4a';
    $outputDir = OUTPUT_DIR . $taskId . '/';
    $logFile = OUTPUT_DIR . $taskId . '.log';

    // 删除文件
    foreach ([$taskDir, $outputDir, $outputFile, $logFile] as $path) {
        if (is_dir($path)) {
            exec('rm -rf "' . $path . '"');
        } elseif (file_exists($path)) {
            @unlink($path);
        }
    }

    jsonResponse(['success' => true, 'message' => '任务已删除']);
}

// 默认响应
jsonResponse(['error' => '无效的操作'], 400);
