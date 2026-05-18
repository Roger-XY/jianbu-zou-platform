const { spawn } = require('child_process');
const path = require('path');

const cloudflaredPath = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'; // 正确路径
// const cloudflaredPath = 'C:\\Program Files\\cloudflared\\cloudflared.exe'; // 备选路径

console.log('[INFO] 正在启动 Cloudflare Tunnel...');

const proc = spawn(cloudflaredPath, [
  'tunnel',
  '--url', 'http://localhost:3000',
  '--no-autoupdate'
], { stdio: ['ignore', 'pipe', 'pipe'] });

let url = null;

function extractUrl(data) {
  const text = data.toString();
  // 匹配 trycloudflare.com 地址
  const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
  if (match && !url) {
    url = match[0];
    console.log('\n========================================');
    console.log('  公网访问地址（分享给其他人）：');
    console.log('  ' + url);
    console.log('========================================\n');
  }
}

proc.stdout.on('data', d => { process.stdout.write(d); extractUrl(d); });
proc.stderr.on('data', d => { process.stderr.write(d); extractUrl(d); });

proc.on('exit', (code) => {
  console.log('[INFO] cloudflared 已退出，退出码:', code);
});

// 30秒后如果还没拿到URL，输出提示
setTimeout(() => {
  if (!url) {
    console.log('[WARN] 30秒内未获取到公网地址，请检查网络连接');
  }
}, 30000);
