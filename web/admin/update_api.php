<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

$updateDir = 'updates';
$configFile = 'update_config.json';

if (!is_dir($updateDir)) {
    mkdir($updateDir, 0777, true);
}

// Handle CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Get current version info
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (file_exists($configFile)) {
        echo file_get_contents($configFile);
    } else {
        echo json_encode([
            'version' => '1.0.0',
            'url' => '',
            'release_date' => date('Y-m-d H:i:s')
        ]);
    }
    exit;
}

// Update version info and upload package
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Check if it's a file upload
    if (isset($_FILES['package'])) {
        $version = $_POST['version'] ?? '1.0.0';
        $fileName = "AudioAgent_" . str_replace('.', '_', $version) . ".zip";
        $targetPath = $updateDir . '/' . $fileName;
        
        if (move_uploaded_file($_FILES['package']['tmp_name'], $targetPath)) {
            // Update manifest
            $baseUrl = "http://" . $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['PHP_SELF']), '/\\');
            $config = [
                'version' => $version,
                'url' => $baseUrl . '/' . $targetPath,
                'release_date' => date('Y-m-d H:i:s')
            ];
            file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT));
            echo json_encode(['success' => true, 'config' => $config]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save upload']);
        }
    } else {
        // Just updating text config
        $input = json_decode(file_get_contents('php://input'), true);
        if ($input) {
            file_put_contents($configFile, json_encode($input, JSON_PRETTY_PRINT));
            echo json_encode(['success' => true]);
        }
    }
    exit;
}
?>
