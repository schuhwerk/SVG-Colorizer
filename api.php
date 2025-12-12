<?php
// Prevent PHP warnings from breaking JSON
error_reporting(E_ERROR | E_PARSE);
header('Content-Type: application/json');

$svgDirectory = __DIR__ . '/svgs';

// Ensure directory exists
if (!is_dir($svgDirectory)) {
    if (!mkdir($svgDirectory)) {
        echo json_encode(['error' => 'Could not create svgs directory']);
        exit;
    }
}

function getSafePath($dir, $filename)
{
    // Basic sanitization
    $name = basename($filename);
    if (!$name || $name === '.' || $name === '..') { return false;
    }
    return $dir . '/' . $name;
}

if (isset($_GET['action'])) {
    $action = $_GET['action'];

    if ($action === 'list' || $action === 'load_all') {
        $files = glob($svgDirectory . '/*.svg');
        if ($files === false) { $files = [];
        }
        
        $result = array_map(
            function ($path) {
                return [
                'name' => basename($path),
                'content' => file_get_contents($path),
                'mtime' => filemtime($path)
                ];
            }, $files
        );
        
        echo json_encode($result);
        exit;
    }

    if ($action === 'save') {
        $raw = file_get_contents('php://input');
        $input = json_decode($raw, true);
        
        if ($input && isset($input['file']) && isset($input['content'])) {
            $path = getSafePath($svgDirectory, $input['file']);
            if ($path && strpos($input['content'], '<svg') !== false) {
                file_put_contents($path, $input['content']);
                echo json_encode(['success' => true, 'mtime' => filemtime($path)]);
            } else {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid SVG content or filename']);
            }
        } else {
             http_response_code(400);
             echo json_encode(['error' => 'Missing data']);
        }
        exit;
    }

    if ($action === 'poll_all') {
        $files = glob($svgDirectory . '/*.svg');
        if ($files === false) $files = [];
        
        $result = [];
        foreach ($files as $path) {
            $result[basename($path)] = filemtime($path);
        }
        echo json_encode($result);
        exit;
    }
}
?>
