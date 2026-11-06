<?php
declare(strict_types=1);
require dirname(__DIR__, 2) . '/xExtension-SwipyRSS/lib/Packages.php';
$root = dirname(__DIR__, 2) . '/.build/extension-package-tests';
SwipyRSS_Packages::removeTree($root); mkdir($root, 0755, true);
$source = dirname(__DIR__, 2) . '/release/stable/swipyrss.zip';
$packages = new SwipyRSS_Packages($root . '/extension');
$count = 0;
function check(bool $condition, string $message): void { global $count; if (!$condition) throw new RuntimeException($message); $count++; echo "PASS $message\n"; }
function rejects(callable $task, string $message): void { try { $task(); } catch (Throwable $error) { check(true, $message); return; } throw new RuntimeException("Expected rejection: $message"); }
function altered(string $name, callable $mutate): string {
	global $source, $root;
	$path = $root . '/' . $name . '.zip'; copy($source, $path);
	$zip = new ZipArchive(); $zip->open($path); $mutate($zip); $zip->close(); return $path;
}
$result = $packages->install($source);
check($result['retained'] && count($packages->all()) === 1, 'valid standalone package installs');
$index = file_get_contents($root . '/extension/storage/versions.json');
$packages->install($source);
check(file_get_contents($root . '/extension/storage/versions.json') === $index, 'identical build is idempotent');
rejects(fn() => $packages->install($source, str_repeat('0', 64)), 'wrong archive digest rejected');
$path = altered('traversal', fn(ZipArchive $zip) => $zip->addFromString('../outside.php', '<?php')); rejects(fn() => $packages->install($path), 'ZIP traversal rejected');
$path = altered('php', fn(ZipArchive $zip) => $zip->addFromString('payload.php', '<?php')); rejects(fn() => $packages->install($path), 'executable/extra file rejected');
$path = altered('symlink', function (ZipArchive $zip): void { $zip->addFromString('link.js', '/etc/passwd'); $zip->setExternalAttributesName('link.js', ZipArchive::OPSYS_UNIX, 0120777 << 16); }); rejects(fn() => $packages->install($path), 'symbolic link rejected');
$path = altered('digest', function (ZipArchive $zip): void { $m = json_decode($zip->getFromName('build-manifest.json'), true); $file = $m['files'][0]; $zip->addFromString($file['path'], str_repeat('x', $file['size'])); }); rejects(fn() => $packages->install($path), 'modified file bytes rejected');
$path = altered('incompatible', function (ZipArchive $zip): void { $m = json_decode($zip->getFromName('build-manifest.json'), true); $m['hostProtocol'] = 999; $zip->addFromString('build-manifest.json', json_encode($m)); }); rejects(fn() => $packages->install($path), 'incompatible host protocol rejected');
check(file_get_contents($root . '/extension/storage/versions.json') === $index, 'failed installations leave existing index unchanged');
foreach ([1, 2, 3, 4] as $n) {
	$path = altered('stable-' . $n, function (ZipArchive $zip) use ($n): void { $m = json_decode($zip->getFromName('build-manifest.json'), true); $m['buildId'] = 'retention-' . $n; $m['version'] = '0.3.' . $n; $zip->addFromString('build-manifest.json', json_encode($m)); }); $packages->install($path);
}
$builds = $packages->all();
check(count($builds) === 3 && array_column($builds, 'version') === ['0.3.4', '0.3.3', '0.3.2'], 'Stable retains three newest versions');
$path = altered('old-manual', function (ZipArchive $zip): void { $m = json_decode($zip->getFromName('build-manifest.json'), true); $m['buildId'] = 'old-manual'; $m['version'] = '0.1.0'; $zip->addFromString('build-manifest.json', json_encode($m)); });
check(!$packages->install($path)['retained'] && count($packages->all()) === 3, 'manual old package obeys retention');
$path = altered('conflict', function (ZipArchive $zip): void { $m = json_decode($zip->getFromName('build-manifest.json'), true); $m['buildId'] = 'retention-4'; $m['version'] = '0.4.0'; $zip->addFromString('build-manifest.json', json_encode($m)); }); rejects(fn() => $packages->install($path), 'same build ID cannot replace installed content');
foreach ([1, 2] as $n) {
	$path = altered('test-' . $n, function (ZipArchive $zip) use ($n): void { $m = json_decode($zip->getFromName('build-manifest.json'), true); $m['buildId'] = 'test-' . $n; $m['channel'] = 'test'; $m['version'] = '0.4.0-test.' . $n; $m['createdAt'] = '2026-10-2' . $n . 'T00:00:00.000Z'; $zip->addFromString('build-manifest.json', json_encode($m)); }); $packages->install($path);
}
check(count(array_filter($packages->all(), fn(array $b): bool => $b['channel'] === 'test')) === 1, 'Test retains one newest build');
$packages->initialize(); file_put_contents($root . '/extension/imports/invalid.zip', 'invalid'); $packages->import();
check(is_file($root . '/extension/imports/invalid.zip.failed'), 'failed import is marked without looping');
echo "$count package installation scenarios passed.\n";
