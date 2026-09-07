// [custom] Stop only the desktop instance whose command line contains the
// given needle (e.g. its --user-data-dir), leaving the user's own instance
// running. `taskkill /IM electron.exe` kills every instance.
//
// usage: node scripts/desktop-stop.mjs <needle>

import { execFileSync } from 'node:child_process';

const needle = process.argv[2];
if (!needle) {
    console.error('usage: node scripts/desktop-stop.mjs <command-line substring>');
    process.exit(2);
}

const script = `
$procs = Get-CimInstance Win32_Process -Filter "name='electron.exe'" | Where-Object { $_.CommandLine -like '*${needle.replace(/'/g, "''")}*' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; Write-Output ("stopped " + $p.ProcessId) }
if (-not $procs) { Write-Output "no electron process matches" }
`;
const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
process.stdout.write(out);
