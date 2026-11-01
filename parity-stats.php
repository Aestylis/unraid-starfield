<?PHP
/* Live array stats for the Parity theme background (polled by parity.js every ~2 s while the tab is visible).
 * Read-only: disks.ini (emhttp state), diskload.ini (written every 2 s by webGui/nchan/disk_load) and network
 * counters. Pool members (cache2, cache3, ...) are folded into their pool. Served behind the normal webGui login. */
header('Content-Type: application/json');
header('Cache-Control: no-store');

$disks = @parse_ini_file('/var/local/emhttp/disks.ini', true) ?: [];
$load  = @parse_ini_file('/var/local/emhttp/diskload.ini') ?: [];

$out = [];
$pools = [];
foreach ($disks as $d) {
  $type = $d['type'] ?? '';
  $dev  = $d['device'] ?? '';
  if ($dev === '' || !in_array($type, ['Parity', 'Data', 'Cache'], true)) continue;
  $l = explode(' ', $load[$dev] ?? '0 0');
  $r = (int)($l[0] ?? 0);
  $w = (int)($l[1] ?? 0);
  $name = $d['name'] ?? $dev;
  $spun = ($d['spundown'] ?? '0') === '1';
  if ($type === 'Cache' && preg_match('/^(.*?)(\d+)$/', $name, $m) && isset($pools[$m[1]])) {
    $i = $pools[$m[1]];
    $out[$i]['read'] += $r;
    $out[$i]['write'] += $w;
    $out[$i]['spundown'] = $out[$i]['spundown'] && $spun;
    $out[$i]['members']++;
    continue;
  }
  $size = (float)($d['fsSize'] ?? 0);
  $used = (float)($d['fsUsed'] ?? 0);
  $e = [
    'name'     => $name,
    'type'     => strtolower($type),
    'read'     => $r,
    'write'    => $w,
    'used'     => $size > 0 ? round($used / $size, 4) : null,
    'size'     => ($size > 0 ? $size : (float)($d['size'] ?? 0)) * 1024,
    'spundown' => $spun,
    'temp'     => is_numeric($d['temp'] ?? '') ? (int)$d['temp'] : null,
    'ok'       => ($d['status'] ?? '') === 'DISK_OK',
    'members'  => 1,
  ];
  if ($type === 'Cache') $pools[$name] = count($out);
  $out[] = $e;
}

// network: physical uplink counters, rate from the previous sample (shared across tabs via a tmp file)
$if = 'eth0';
if (!is_dir("/sys/class/net/$if")) {
  foreach (glob('/sys/class/net/*') as $p) {
    $n = basename($p);
    if (!preg_match('/^(lo|docker|veth|br-|tunl|virbr|wg|shim|vhost)/', $n)) { $if = $n; break; }
  }
}
$rx = (float)@file_get_contents("/sys/class/net/$if/statistics/rx_bytes");
$tx = (float)@file_get_contents("/sys/class/net/$if/statistics/tx_bytes");
$now = microtime(true);
$state = '/tmp/parity-theme-net.json';
$prev = @json_decode(@file_get_contents($state), true) ?: [];
$rate = $prev['rate'] ?? ['rx' => 0, 'tx' => 0];
if (isset($prev['t']) && $now - $prev['t'] >= 1.0) {
  $dt = $now - $prev['t'];
  $rate = ['rx' => max(0, ($rx - $prev['rx']) / $dt), 'tx' => max(0, ($tx - $prev['tx']) / $dt)];
  @file_put_contents($state, json_encode(['t' => $now, 'rx' => $rx, 'tx' => $tx, 'rate' => $rate]));
} elseif (!isset($prev['t'])) {
  @file_put_contents($state, json_encode(['t' => $now, 'rx' => $rx, 'tx' => $tx, 'rate' => $rate]));
}

echo json_encode(['disks' => $out, 'net' => ['if' => $if, 'rx' => round($rate['rx']), 'tx' => round($rate['tx'])], 't' => round($now, 2)]);
