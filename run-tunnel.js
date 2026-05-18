const { spawn } = require('child_process');
const fs = require('fs');

const cloudflaredPath = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const logFile = require('path').join(__dirname, 'tunnel.log');

const out = fs.openSync(logFile, 'w');
const err = fs.openSync(logFile, 'a');

const proc = spawn(cloudflaredPath, [
  'tunnel', '--url', 'http://localhost:3000', '--no-autoupdate'
], { stdio: ['ignore', out, err] });

proc.on('exit', code => {
  fs.appendFileSync(logFile, `[EXIT] code=${code}\n`);
});

console.log('[INFO] cloudflared 已启动，日志: ' + logFile);
