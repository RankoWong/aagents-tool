<?php
/**
 * aagents-tool Web API
 * 提供文件上传、合并、分割等功能的API接口
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// 禁止 PHP 错误直接输出到页面，防止破坏 JSON 结构
ini_set('display_errors', 0);
error_reporting(E_ALL);

// Restrict access to official AudioAgent app only
$userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';
if (strpos($userAgent, 'AudioAgent/') === false) {
    http_response_code(403);
    echo json_encode(['error' => 'Access Denied: Please use the official AudioAgent app.']);
    exit;
}

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
define('MERGED_DIR', __DIR__ . '/output/merged/');
define('BIN_DIR', __DIR__ . '/bin/');
define('MODELS_DIR', __DIR__ . '/models/');
define('AAGENTS_TOOL', file_exists(__DIR__ . '/../aagents-tool.sh') ? (__DIR__ . '/../aagents-tool.sh') : (__DIR__ . '/../m4b-tool.sh'));
define('GLM_API_KEY', ''); // TODO: Enter your Zhipu/GLM API Key here

// 确保目录存在
foreach ([UPLOAD_DIR, OUTPUT_DIR, LOG_DIR, MERGED_DIR, BIN_DIR, MODELS_DIR] as $dir) {
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
 * 获取音频文件时长（秒）
 */
function getAudioDuration($filePath) {
    writeLog("开始获取文件时长: $filePath", 'INFO');

    // 尝试常见的 ffprobe 路径
    $ffprobePaths = [
        '/opt/homebrew/bin/ffprobe',
        '/usr/local/bin/ffprobe',
        '/usr/bin/ffprobe',
        'ffprobe'  // 系统PATH
    ];

    foreach ($ffprobePaths as $ffprobe) {
        // 检查文件是否存在
        if ($ffprobe !== 'ffprobe' && !file_exists($ffprobe)) {
            continue;
        }

        $cmd = escapeshellcmd($ffprobe) . ' -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ' . escapeshellarg($filePath) . ' 2>&1';

        $output = shell_exec($cmd);
        $trimmedOutput = trim($output);
        writeLog("命令输出: [$trimmedOutput]", 'DEBUG');

        if ($output && is_numeric($trimmedOutput)) {
            $duration = floatval($trimmedOutput);
            if ($duration > 0) {
                writeLog("使用 $ffprobe 获取时长: $duration 秒", 'INFO');
                return $duration;
            }
        }
    }

    // 如果 ffprobe 不可用，尝试使用 ffmpeg
    $ffmpegPaths = [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        'ffmpeg'
    ];

    foreach ($ffmpegPaths as $ffmpeg) {
        if ($ffmpeg !== 'ffmpeg' && !file_exists($ffmpeg)) {
            continue;
        }

        $cmd = escapeshellcmd($ffmpeg) . ' -i ' . escapeshellarg($filePath) . ' 2>&1';
        $output = shell_exec($cmd);

        if ($output && preg_match('/Duration: (\d+):(\d+):(\d+\.\d+)/', $output, $matches)) {
            $hours = intval($matches[1]);
            $minutes = intval($matches[2]);
            $seconds = floatval($matches[3]);
            $duration = $hours * 3600 + $minutes * 60 + $seconds;
            if ($duration > 0) {
                writeLog("使用 $ffmpeg 获取时长: $duration 秒", 'INFO');
                return $duration;
            }
        }
    }

    writeLog("无法获取文件时长: $filePath", 'WARN');
    return 0;
}

/**
 * 判断是否为真实的视频文件（排除封面图）
 */
function isRealVideo($filePath) {
    $ffprobePaths = [
        '/opt/homebrew/bin/ffprobe',
        '/usr/local/bin/ffprobe',
        '/usr/bin/ffprobe',
        __DIR__ . '/bin/ffprobe',
        'ffprobe'
    ];

    foreach ($ffprobePaths as $ffprobe) {
        if ($ffprobe !== 'ffprobe' && !file_exists($ffprobe)) continue;
        
        $cmd = escapeshellarg($ffprobe) . " -v error -select_streams v -show_entries stream=codec_name -of csv=p=0 " . escapeshellarg($filePath);
        $output = shell_exec($cmd);
        if ($output) {
            $codecs = array_map('trim', explode("\n", trim($output)));
            foreach ($codecs as $codec) {
                // 如果包含非静态图片的视频流，则认为是真视频
                if (!empty($codec) && !in_array($codec, ['mjpeg', 'png', 'bmp', 'gif'])) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * 获取文件创建时间（在Mac上使用stat）
 */
function getFileBirthTime($path) {
    if (PHP_OS_FAMILY === 'Darwin') {
        $out = shell_exec("stat -f %B " . escapeshellarg($path));
        $val = trim($out);
        if (is_numeric($val) && $val > 0) return intval($val);
    }
    return filemtime($path); // 回退
}

/**
 * 格式化时长
 */
function formatDuration($seconds) {
    $hours = floor($seconds / 3600);
    $minutes = floor(($seconds % 3600) / 60);
    $secs = floor($seconds % 60);

    if ($hours > 0) {
        return sprintf('%d:%02d:%02d', $hours, $minutes, $secs);
    } else {
        return sprintf('%d:%02d', $minutes, $secs);
    }
}

/**
 * 执行 aagents-tool 命令
 */
function execM4bTool($command, &$output = null, &$returnVar = null) {
    $cmd = AAGENTS_TOOL . ' ' . $command . ' 2>&1';
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

// 列出目录中的音频文件
if ($action === 'list_directory' && $method === 'GET') {
    $directory = $_GET['path'] ?? '';
    writeLog("Scanning directory: $directory");
    
    if (!$directory || !is_dir($directory)) {
        writeLog("Directory invalid or protected: $directory", "ERROR");
        jsonResponse(['error' => '目录不存在或无效'], 400);
    }
    
    $allowedExts = ['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'flac', 'wav', 'wma', 'opus', 'aiff', 'aif', 'aifc', 'caf', 'pdf', 'docx', 'doc', 'txt', 'md', 'mp4'];
    $files = [];
    
    // 递归扫描目录
    try {
        $directoryIterator = new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS);
        $iterator = new RecursiveIteratorIterator($directoryIterator);
        
        foreach ($iterator as $fileInfo) {
            if (!$fileInfo->isFile()) continue;
            
            $item = $fileInfo->getFilename();
            $fullPath = $fileInfo->getPathname();
            
            $ext = strtolower(pathinfo($item, PATHINFO_EXTENSION));
            if (!in_array($ext, $allowedExts)) continue;
            
            $size = $fileInfo->getSize();
            $mtime = $fileInfo->getMTime();
            $birthtime = getFileBirthTime($fullPath);
            
            // 时长获取可能比较耗时，但为了展示是必须的
            $duration = getAudioDuration($fullPath);
            
            $aiFile = preg_replace('/\.[^.]+$/', '', $fullPath) . '.ai.md';
            $aiContent = null;
            if (file_exists($aiFile)) {
                $aiContent = mb_strimwidth(strip_tags(file_get_contents($aiFile)), 0, 300, "...");
            }

            $isVideo = ($ext === 'mp4' && isRealVideo($fullPath));
            $extractedAudioPath = null;
            $isExtracting = false;

            if ($isVideo) {
                $audioFile = preg_replace('/\.[^.]+$/', '', $fullPath) . '.extracted.m4a';
                $lockFile = $audioFile . '.extracting';
                
                if (file_exists($audioFile)) {
                    $extractedAudioPath = $audioFile;
                } elseif (file_exists($lockFile)) {
                    // Safety check: if lock file is older than 5 minutes, it likely crashed
                    if (time() - filemtime($lockFile) > 300) {
                        @unlink($lockFile);
                        writeLog("Removed stale lock file for: $fullPath", "WARN");
                    } else {
                        $isExtracting = true;
                    }
                } 
                
                // Re-check after potential clean up
                if (!$extractedAudioPath && !$isExtracting) {
                    // Trigger silent extraction in background
                    $ffmpeg = 'ffmpeg';
                    if (file_exists(__DIR__ . '/bin/ffmpeg')) $ffmpeg = __DIR__ . '/bin/ffmpeg';
                    
                    // Command to extract audio and create lock file, then remove lock file
                    $cmd = "touch " . escapeshellarg($lockFile) . "; " . 
                           escapeshellarg($ffmpeg) . " -i " . escapeshellarg($fullPath) . " -vn -acodec copy " . escapeshellarg($audioFile) . " -y > /dev/null 2>&1; " . 
                           "rm " . escapeshellarg($lockFile);
                    
                    shell_exec("nohup sh -c " . escapeshellarg($cmd) . " > /dev/null 2>&1 &");
                    $isExtracting = true;
                    writeLog("Triggered background extraction for: $fullPath");
                }
            }

            $files[] = [
                'name' => $item,
                'path' => $fullPath,
                'size' => $size,
                'mtime' => $mtime,
                'birthtime' => $birthtime,
                'duration' => $duration,
                'durationStr' => formatDuration($duration),
                'ai_summary' => $aiContent,
                'is_video' => $isVideo,
                'extracted_audio_path' => $extractedAudioPath,
                'is_extracting' => $isExtracting
            ];
        }
    } catch (Exception $e) {
        writeLog("Recursive scan error: " . $e->getMessage(), "ERROR");
        jsonResponse(['error' => '读取目录失败: ' . $e->getMessage()], 500);
    }
    
    // 按修改时间倒序排列 (最新的在前面)
    usort($files, function($a, $b) {
        return $b['mtime'] - $a['mtime'];
    });
    
    jsonResponse([
        'success' => true,
        'directory' => $directory,
        'files' => $files,
        'count' => count($files)
    ]);
}

// 处理文件路径上传（用于 WebView 原生文件选择）
if ($action === 'upload_paths' && $method === 'POST') {
    writeLog('开始处理文件路径上传...');

    // 获取文件路径 JSON
    $json = $_POST['file_paths'] ?? file_get_contents('php://input');

    if (!$json) {
        writeLog('上传失败：没有文件路径数据', 'ERROR');
        jsonResponse(['error' => '没有文件路径数据'], 400);
    }

    $filePaths = json_decode($json, true);

    if (!$filePaths || !is_array($filePaths)) {
        writeLog('上传失败：无效的文件路径格式', 'ERROR');
        jsonResponse(['error' => '无效的文件路径格式'], 400);
    }

    writeLog('收到的文件数量: ' . count($filePaths));

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
            jsonResponse(['error' => '创建任务目录失败'], 500);
        }
        writeLog('任务目录创建成功: ' . $taskDir);
    }

    $files = [];
    $allowedExts = ['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'flac', 'wav', 'wma', 'opus', 'aiff', 'aif', 'aifc', 'caf', 'pdf', 'docx', 'doc', 'txt', 'md'];

    foreach ($filePaths as $index => $fileInfo) {
        $sourcePath = $fileInfo['path'] ?? '';
        $fileName = basename($sourcePath);

        if (empty($sourcePath) || !file_exists($sourcePath)) {
            writeLog("文件不存在: $sourcePath", 'ERROR');
            continue;
        }

        $ext = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));

        if (!in_array($ext, $allowedExts)) {
            writeLog("不支持的文件格式: $fileName", 'WARN');
            continue;
        }

        $safeName = preg_replace('/[^a-zA-Z0-9._-]/', '_', $fileName);
        
        // Format: YYMMDD_Index_OriginalName
        // Index is global for the task, so we need existingFileCount + index + 1
        $datePrefix = date('ymd'); // e.g. 260123
        $fileIndex = $existingFileCount + $index + 1;
        
        // Remove old numbering if user re-uploads or just to be clean? 
        // User asked for "260123", then "1", then name. 
        // Example: 260123_1_filename.mp3
        $newFileName = sprintf('%s_%d_%s', $datePrefix, $fileIndex, $safeName);
        
        $destFile = $taskDir . $newFileName;

        // 复制文件
        if (copy($sourcePath, $destFile)) {
            $actualSize = filesize($destFile);
            writeLog("文件复制成功: $fileName -> $destFile (大小: $actualSize bytes)", 'SUCCESS');

            // 获取音频时长
            $duration = getAudioDuration($destFile);
            $durationStr = formatDuration($duration);
            writeLog("文件时长: $durationStr ($duration 秒)", 'INFO');

            $files[] = [
                'name' => $fileName,
                'file' => basename($destFile),
                'size' => $actualSize,
                'duration' => $duration,
                'durationStr' => $durationStr,
                'path' => $destFile
            ];
        } else {
            writeLog("文件复制失败: $sourcePath -> $destFile", 'ERROR');
        }
    }

    if (empty($files)) {
        writeLog('没有成功复制任何文件', 'ERROR');
        jsonResponse(['error' => '没有成功复制任何文件'], 400);
    }

    writeLog('文件路径上传完成: ' . count($files) . ' 个文件');

    jsonResponse([
        'success' => true,
        'taskId' => $taskId,
        'files' => $files,
        'fileCount' => count($files)
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

                        // 获取音频时长
                        $duration = getAudioDuration($destFile);
                        $durationStr = formatDuration($duration);
                        writeLog("文件时长: $durationStr ($duration 秒)", 'INFO');

                        $files[] = [
                            'name' => $fileName,
                            'file' => basename($destFile),
                            'size' => $actualSize,
                            'duration' => $duration,
                            'durationStr' => $durationStr,
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
            // Try to strip YYMMDD_Index_ prefix
            // Pattern: start with 6 digits, underscore, digits, underscore
            $origName = preg_replace('/^\d{6}_\d+_/', '', $fileName);
            // If it didn't match (old files?), try old pattern
            if ($origName === $fileName) {
                $origName = preg_replace('/^\d+_/', '', $fileName);
            }
            
            $datePrefix = date('ymd');
            $newName = sprintf('%s_%d_%s', $datePrefix, $index + 1, $origName);
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
    
    // Create output directory for this task (for logs, metadata)
    $outputDir = OUTPUT_DIR . $taskId . '/';
    if (!is_dir($outputDir)) mkdir($outputDir, 0755, true);
    
    // Determine output file path
    $destDir = $options['destinationDir'] ?? MERGED_DIR;
    // Ensure trailing slash
    if (!str_ends_with($destDir, '/')) $destDir .= '/';
    
    $outputFilename = $taskId . '_Merged.m4a';
    $outputFile = $destDir . $outputFilename;

    // Save the intended output path to metadata for status/download checking
    file_put_contents($outputDir . 'output_path.txt', $outputFile);

    // If output file exists (e.g. from previous run), delete it to ensure clean merge
    if (file_exists($outputFile)) {
        writeLog("Deleting existing output file: $outputFile");
        unlink($outputFile);
    }

    // 构建命令
    $cmd = AAGENTS_TOOL . ' merge "' . $taskDir . '" --output-file="' . $outputFile . '" --skip-cover';

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
    
    writeLog("Executing background merge: $backgroundCmd");

    exec($backgroundCmd, $output, $returnVar);

    jsonResponse([
        'success' => true,
        'message' => '合并任务已开始',
        'taskId' => $taskId,
        'outputFile' => basename($outputFile)
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
    $unifiedOutputFile = MERGED_DIR . $taskId . '_Merged.m4a';

    // Load path from metadata if exists
    if (file_exists($outputDir . 'output_path.txt')) {
        $unifiedOutputFile = trim(file_get_contents($outputDir . 'output_path.txt'));
    }

    $status = 'processing';
    $progress = 0;
    $log = [];

    // Check for merged file
    $hasFinalMerged = file_exists($unifiedOutputFile) && filesize($unifiedOutputFile) > 1024;
    
    // Fallback search for any _Merged files
    $mergedFiles = glob($outputDir . '*_Merged.m4a');
    $hasMergedInDir = !empty($mergedFiles) && filesize($mergedFiles[0]) > 1024;

    // 先检查是否完成
    if ($hasFinalMerged) {
        $status = 'completed';
        $progress = 100;
        $outputFile = $unifiedOutputFile;
    } elseif ($hasMergedInDir) {
        $status = 'completed';
        $progress = 100;
        $outputFile = $mergedFiles[0]; 
    } elseif (file_exists($outputFile) && filesize($outputFile) > 1024) {
        // 输出文件存在且大于1KB，认为完成
        $status = 'completed';
        $progress = 100;
    } elseif (file_exists($logFile) && filesize($logFile) > 0) {
        // 读取日志判断进度和是否完成
        $logLines = file($logFile);
        $logContent = implode('', $logLines);

        if ($status !== 'completed') {
            $log = array_slice($logLines, -50); // 获取最后50行
        }

        // 检查是否有错误
        if (preg_match('/could not convert|error|failed|fatal/i', $logContent)) {
            $status = 'failed';
            $progress = 0;
        } else {
            // 进度判断 - 根据日志内容判断进度
            if (preg_match('/Processing:.*\d+\/\d+/i', $logContent, $matches)) {
                // 尝试提取进度，如 "Processing: 2/10"
                if (preg_match('/(\d+)\/(\d+)/', $matches[0], $nums)) {
                    $progress = intval(($nums[1] / $nums[2]) * 80); // 最多80%
                }
            } elseif (preg_match('/Converting|Encoding|Processing/i', $logContent)) {
                $progress = 50;
            }

            // 检查是否完成（日志显示完成）
            if (preg_match('/finished|completed|done|successfully/i', $logContent)) {
                $progress = 95; // 即将完成，等待输出文件写入
            }

            // 如果输出文件存在但太小，可能还在写入
            if (file_exists($outputFile) && filesize($outputFile) > 0) {
                $progress = max($progress, 98); // 显示98%，表示正在最后写入
            }
        }
    } else {
        // 日志文件不存在或为空，可能是刚开始
        $progress = 5;
    }

    // 检查是否失败（超时）
    if ($status === 'processing' && file_exists($logFile) && (time() - filemtime($logFile) > 300)) {
        // 5分钟没有更新
        if ($progress < 100 && $progress > 5) {
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
    $folder = $_GET['folder'] ?? '';

    if ($folder === 'metadata' && file_exists($outputDir . 'output_path.txt')) {
        $filePath = trim(file_get_contents($outputDir . 'output_path.txt'));
    } elseif ($folder === 'merged' && $file) {
        $filePath = MERGED_DIR . $file;
    } elseif ($file && file_exists($outputDir . $file)) {
        $filePath = $outputDir . $file;
    } elseif (file_exists($outputFile)) {
        $filePath = $outputFile;
    } elseif (file_exists(MERGED_DIR . $taskId . '_Merged.m4a')) {
        $filePath = MERGED_DIR . $taskId . '_Merged.m4a';
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
    $unifiedOutputFile = MERGED_DIR . $taskId . '_Merged.m4a';
    $isCustomPath = false;

    if (file_exists($outputDir . 'output_path.txt')) {
        $unifiedOutputFile = trim(file_get_contents($outputDir . 'output_path.txt'));
        $isCustomPath = true;
    }

    writeLog("Listing output for task: $taskId");

    $files = [];

    // 1. Check for merged file
    if (file_exists($unifiedOutputFile)) {
        writeLog("Found merged file: $unifiedOutputFile");
        $files[] = [
            'name' => basename($unifiedOutputFile),
            'size' => filesize($unifiedOutputFile),
            'type' => 'merge',
            'path' => $unifiedOutputFile,
            'downloadUrl' => '?action=download&taskId=' . $taskId . '&file=' . basename($unifiedOutputFile) . '&folder=' . ($isCustomPath ? 'metadata' : 'merged')
        ];
    }

    // 2. Check task-specific output directory (for legacy merges)
    if (is_dir($outputDir)) {
        $outputFiles = glob($outputDir . '*');
        foreach ($outputFiles as $file) {
            if (is_file($file)) {
                $fileName = basename($file);
                // Avoid duplicates if already found in unified folder
                if ($fileName === $taskId . '_Merged.m4a' && !empty($files)) continue;

                if (str_ends_with($fileName, '_Merged.m4a')) {
                    $files[] = [
                        'name' => $fileName,
                        'size' => filesize($file),
                        'type' => 'merge',
                        'downloadUrl' => '?action=download&taskId=' . $taskId . '&file=' . $fileName
                    ];
                }
            }
        }
    } else {
        writeLog("Output directory does not exist: $outputDir");
    }

    writeLog("Returning success with " . count($files) . " files.");

    jsonResponse([
        'success' => true,
        'files' => $files
    ]);
}

// Local App Summary Action
if ($action === 'summarize' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $taskId = $input['taskId'] ?? '';

    if (!$taskId) {
        jsonResponse(['error' => '缺少任务ID'], 400);
    }

    $outputDir = OUTPUT_DIR . $taskId . '/';
    $unifiedOutputFile = MERGED_DIR . $taskId . '_Merged.m4a';
    $audioFile = '';

    // Load path from metadata if exists
    if (file_exists($outputDir . 'output_path.txt')) {
        $unifiedOutputFile = trim(file_get_contents($outputDir . 'output_path.txt'));
    }

    if (file_exists($unifiedOutputFile)) {
        $audioFile = $unifiedOutputFile;
    } else {
        $mergedFiles = glob($outputDir . '*_Merged.m4a');
        if (!empty($mergedFiles)) {
            $audioFile = $mergedFiles[0];
        }
    }
    
    if (!$audioFile || !file_exists($audioFile)) {
        $msg = "找不到合并后的音频文件";
        if ($audioFile) $msg .= " (路径: $audioFile)";
        writeLog("Merged file not found for taskId: $taskId. Attempted: " . ($audioFile ?: 'NONE'), 'ERROR');
        jsonResponse(['error' => $msg], 404);
    }
    
    $resolvedPath = realpath($audioFile) ?: $audioFile;
    writeLog("Starting summarize for task $taskId. File: $resolvedPath");
    
    // 1. Copy Prompt to Clipboard
    $prompt = "请详细分析该会议音频的信息，并按照将会议信息详细列出，包含总体会议目标，关键结论概括，按内容进行模块划分，并模块内注重关键结论的同步，最终附带后续的行动建议";
    
    $escapedPrompt = escapeshellarg($prompt);
    // Use LANG=en_US.UTF-8 to ensure pbcopy handles characters correctly
    $copyCmd = "export LANG=en_US.UTF-8; printf %s $escapedPrompt | pbcopy";
    shell_exec($copyCmd);
    writeLog("Prompt copied to clipboard");

    // 2. Open File in App
    $appName = "ima.copilot"; 
    $escapedFile = escapeshellarg($resolvedPath);
    
    // open -a "App Name" "File Path"
    $cmd = "open -a " . escapeshellarg($appName) . " $escapedFile 2>&1";
    writeLog("Executing: $cmd");
    
    $output = [];
    $returnVar = 0;
    exec($cmd, $output, $returnVar);
    
    if ($returnVar !== 0) {
        $errorMsg = implode("\n", $output);
        writeLog("Failed to open app. Return var: $returnVar. Error: $errorMsg", "ERROR");
        jsonResponse(['error' => '无法打开应用 (ima.copilot)。请确认应用已安装。' . ($errorMsg ? " 详情: $errorMsg" : "")], 500);
    }

    writeLog("Summarize success: opened $appName");

    jsonResponse([
        'success' => true,
        'message' => 'Opened in ima.copilot and prompt copied!',
        'prompt' => $prompt
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
    $unifiedOutputFile = MERGED_DIR . $taskId . '_Merged.m4a';

    // 删除文件
    foreach ([$taskDir, $outputDir, $outputFile, $logFile, $unifiedOutputFile] as $path) {
        if (is_dir($path)) {
            exec('rm -rf "' . $path . '"');
        } elseif (file_exists($path)) {
            @unlink($path);
        }
    }

    jsonResponse(['success' => true, 'message' => '任务已删除']);
}

// 重命名文件
if ($action === 'rename_file' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $oldPath = $input['oldPath'] ?? '';
    $newName = $input['newName'] ?? '';

    if (!$oldPath || !$newName) {
        jsonResponse(['error' => '缺少原始路径或新名称'], 400);
    }

    if (!file_exists($oldPath)) {
        jsonResponse(['error' => '原始文件不存在'], 404);
    }

    $dir = dirname($oldPath);
    $ext = pathinfo($oldPath, PATHINFO_EXTENSION);
    
    // 过滤新文件名，去掉扩展名。允许 Unicode 字符（如中文），只替换系统保留字符
    $cleanName = pathinfo($newName, PATHINFO_FILENAME);
    // 允许所有 Unicode 字母、数字、下划线、短横线、点、空格
    // macOS 文件系统通常允许绝大多数字符，除了冒号(在Finder中表现为/)和空字符。
    // 为了安全起见，我们替换掉明显的路径分隔符和控制字符。
    $safeNewName = str_replace(array('/', '\\', ':', '*', '?', '"', '<', '>', '|'), '', $cleanName);
    
    // 如果文件名变为空，使用原名或默认名
    if (empty(trim($safeNewName))) {
         jsonResponse(['error' => '无效的文件名'], 400);
    }
    
    $safeNewName = trim($safeNewName) . '.' . $ext;
    
    $newPath = $dir . '/' . $safeNewName;

    if (file_exists($newPath)) {
        jsonResponse(['error' => '目标文件名已存在'], 409);
    }

    if (rename($oldPath, $newPath)) {
        writeLog("Renamed file: $oldPath -> $newPath");
        jsonResponse(['success' => true, 'newPath' => $newPath, 'newName' => $safeNewName]);
    } else {
        jsonResponse(['error' => '重命名失败'], 500);
    }
}

// 删除录音文件
if ($action === 'delete_recordings' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $paths = $input['paths'] ?? [];

    if (empty($paths)) {
        jsonResponse(['error' => '未指定要删除的文件'], 400);
    }

    $deletedCount = 0;
    $errors = [];

    foreach ($paths as $path) {
        if (!file_exists($path)) {
            $errors[] = "文件不存在: $path";
            continue;
        }

        // 基本安全检查：确保不是删除敏感系统文件
        if (strpos($path, '..') !== false || strpos($path, '/') !== 0) {
             $errors[] = "非法路径: $path";
             continue;
        }

        if (@unlink($path)) {
            $deletedCount++;
            writeLog("Deleted physical recording: $path");
        } else {
            $errors[] = "无法删除: $path";
        }
    }

    jsonResponse([
        'success' => $deletedCount > 0,
        'deleted_count' => $deletedCount,
        'errors' => $errors
    ]);
}

// 持久化存储数据 (保存)
if ($action === 'persist_save' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $path = $input['userDataPath'] ?? '';
    $data = $input['data'] ?? [];

    if (!$path || !is_dir($path)) {
        jsonResponse(['error' => 'Invalid userDataPath: ' . $path], 400);
    }

    $file = $path . '/config.json';
    if (file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT))) {
        jsonResponse(['success' => true]);
    } else {
        jsonResponse(['error' => 'Failed to write config'], 500);
    }
}

// 持久化存储数据 (加载)
if ($action === 'persist_load' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $path = $input['userDataPath'] ?? '';

    if (!$path || !is_dir($path)) {
        jsonResponse(['error' => 'Invalid userDataPath'], 400);
    }

    $file = $path . '/config.json';
    if (file_exists($file)) {
        $content = file_get_contents($file);
        jsonResponse(['success' => true, 'data' => json_decode($content, true)]);
    } else {
        jsonResponse(['success' => true, 'data' => null]);
    }
}

// 查看文档
if ($action === 'view_doc' && $method === 'GET') {
    $path = $_GET['path'] ?? '';
    if (!$path || !file_exists($path)) {
        header("HTTP/1.1 404 Not Found");
        exit;
    }

    // 安全检查
    if (strpos($path, '..') !== false) {
        header("HTTP/1.1 403 Forbidden");
        exit;
    }

    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $allowed = ['pdf', 'md', 'txt'];
    if (!in_array($ext, $allowed)) {
        header("HTTP/1.1 403 Forbidden");
        exit;
    }

    $contentTypes = [
        'pdf' => 'application/pdf',
        'md' => 'text/markdown',
        'txt' => 'text/plain'
    ];

    header('Content-Type: ' . $contentTypes[$ext]);
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

// 默认响应
jsonResponse(['error' => '无效的操作'], 400);
