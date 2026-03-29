<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

$logFile = 'access_logs.json';

// 处理 CORS 预检请求
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid data']);
        exit;
    }

    $email = $input['email'] ?? 'Anonymous';

    $clientTime = $input['client_time'] ?? null;
    $timezone = $input['timezone'] ?? 'UTC';

    // 如果客户端提供了 ISO 时间，我们将其转换为用户当地时区的易读格式
    $timestamp = date('Y-m-d H:i:s'); 
    if ($clientTime) {
        try {
            $date = new DateTime($clientTime);
            // 关键：将时间从 UTC 切换回用户上报的当地时区
            $date->setTimezone(new DateTimeZone($timezone));
            $timestamp = $date->format('Y-m-d H:i:s');
        } catch (Exception $e) {
            // 解析失败则维持服务器当前时间
        }
    }

    $entry = [
        'timestamp' => $timestamp,
        'client_iso' => $clientTime, // 原始 ISO 全格式
        'timezone' => $timezone,
        'version' => $input['version'] ?? 'Unknown',
        'email' => $email,
        'mac' => $input['mac'] ?? 'Unknown',
        'ip' => $_SERVER['REMOTE_ADDR'],
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown'
    ];

    $logs = [];
    if (file_exists($logFile)) {
        $logs = json_decode(file_get_contents($logFile), true) ?: [];
    }
    
    array_unshift($logs, $entry); // Newest first
    // Keep last 1000 entries
    $logs = array_slice($logs, 0, 1000);
    
    file_put_contents($logFile, json_encode($logs, JSON_PRETTY_PRINT));
    echo json_encode(['success' => true]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (file_exists($logFile)) {
        echo file_get_contents($logFile);
    } else {
        echo json_encode([]);
    }
    exit;
}
?>
