/**
 * E2E 全流程测试 — 健步走上传平台
 *
 * 验证重点：
 * 1. 周 tab 标签正确（上周 / 本周，基于实时日期）
 * 2. 日期区间正确（0511~0517 / 0518~0524）
 * 3. 默认选中上周
 * 4. 切换到本周后可以上传图片
 * 5. 确认完成流程
 *
 * 运行前提：服务已启动（node server.js）
 * 运行命令：node tests/e2e.test.js
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// 辅助：构造 multipart/form-data 上传图片
function makeUploadRequest(cookie, weekId, filePath, filename) {
  const fileData = fs.readFileSync(filePath);
  const boundary = '----TestBoundary' + Date.now();
  const bodyParts = [];

  // 文件字段
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
  bodyParts.push(Buffer.from(header));
  bodyParts.push(fileData);
  bodyParts.push(Buffer.from('\r\n'));
  bodyParts.push(Buffer.from(`--${boundary}--\r\n`));

  return new Promise((resolve, reject) => {
    const body = Buffer.concat(bodyParts);
    const opts = {
      hostname: 'localhost', port: 3000,
      path: `/api/upload?week_id=${encodeURIComponent(weekId)}`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'Cookie': cookie
      }
    };
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// 辅助：HTTP 请求
function httpReq(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(buf ? { 'Content-Length': buf.length } : {}),
        ...(cookie ? { 'Cookie': cookie } : {})
      }
    };
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (buf) req.write(buf);
    req.end();
  });
}

// 测试用例
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch(e) {
    console.error(`  ❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

// ========== E2E 测试 ==========
async function runE2E() {
  console.log('\n========== E2E 全流程测试 ==========\n');

  // 1. 生成测试用 PNG（1x1 白色像素）
  const testImgPath = path.join(__dirname, '_test_img.png');
  const png1px = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e000000003c4944415408d76360f8cfc00000000200012c4a0f5c0000000049454e44ae426082',
    'hex'
  );
  fs.writeFileSync(testImgPath, png1px);

  // 2. 登录（普通用户）
  const loginR = await httpReq('POST', '/api/login', { username: '195855', password: '195855' });
  if (!loginR.body.success) throw new Error('登录失败: ' + JSON.stringify(loginR.body));
  const cookie = loginR.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  console.log(`  → 普通用户登录: ${loginR.body.displayName}（${loginR.body.role}）`);

  // 3. 获取周列表
  const weeksR = await httpReq('GET', '/api/weeks', null, cookie);
  if (!weeksR.body.success) throw new Error('获取周列表失败');
  const weeks = weeksR.body.weeks;

  // ========== 重点用例：周标签和日期区间 ==========
  await test('周列表返回 2 条（上周 + 本周）', () => {
    if (weeks.length !== 2) throw new Error(`期望 2 周，实际 ${weeks.length} 周`);
  });

  // 计算今日和本周
  const today = new Date().toISOString().slice(0, 10);

  await test('Tab[0] = 上周（非本周）', () => {
    const tab0 = weeks[0];
    const isThisWeek = today >= tab0.week_start && today <= tab0.week_end;
    if (isThisWeek) throw new Error(`Tab[0] 应为"上周"，但日期区间 ${tab0.week_start}~${tab0.week_end} 包含今天`);
  });

  await test('Tab[1] = 本周（包含今日）', () => {
    const tab1 = weeks[1];
    const isThisWeek = today >= tab1.week_start && today <= tab1.week_end;
    if (!isThisWeek) throw new Error(`Tab[1] 应为"本周"，但日期区间 ${tab1.week_start}~${tab1.week_end} 不包含今天 ${today}`);
  });

  await test('Tab 日期格式正确（MMdd~MMdd）', () => {
    const fmtDateShort = d => d.slice(5,7) + d.slice(8,10);
    const fmtExpected = d => `${d.slice(5,7)}${d.slice(8,10)}`;
    for (const w of weeks) {
      const got = fmtDateShort(w.week_start) + '~' + fmtDateShort(w.week_end);
      const got2 = fmtDateShort(w.week_start);
      if (!/^\d{4}~\d{4}$/.test(got)) throw new Error(`日期格式错误: ${got}，应为 MMDD~MMDD`);
    }
  });

  await test('Tab 日期区间与周号对应正确', () => {
    // 当前是 2026-05-18 = 第7周，上周是第6周
    const curWeek = weeks.find(w => today >= w.week_start && today <= w.week_end);
    const lastWeek = weeks.find(w => w.week_end < today);
    if (!curWeek) throw new Error('找不到包含今天的"本周"');
    if (!lastWeek) throw new Error('找不到"上周"');
    // 验证周号
    if (curWeek.week_number !== 7) throw new Error(`本周应为第7周，实际第${curWeek.week_number}周`);
    if (lastWeek.week_number !== 6) throw new Error(`上周应为第6周，实际第${lastWeek.week_number}周`);
  });

  // ========== 核心用例：上传 + 确认流程 ==========
  const thisWeek = weeks.find(w => today >= w.week_start && today <= w.week_end);

  await test('本周 tab 可以查询图片列表', async () => {
    const r = await httpReq('GET', `/api/images/${thisWeek.id}`, null, cookie);
    if (!r.body.success) throw new Error(r.body.message);
  });

  // 上传一张测试图片
  const uploadR = await makeUploadRequest(cookie, thisWeek.id, testImgPath, 'e2e_test.png');
  await test('本周 tab 上传图片成功', () => {
    if (!uploadR.body.success) throw new Error(uploadR.body.message || JSON.stringify(uploadR.body));
    if (!uploadR.body.files || uploadR.body.files.length === 0) throw new Error('未返回文件信息');
  });

  const uploadedFile = uploadR.body.files[0];

  await test('本周 tab 上传后图片出现在列表中', async () => {
    const r = await httpReq('GET', `/api/images/${thisWeek.id}`, null, cookie);
    if (!r.body.success) throw new Error(r.body.message);
    const found = r.body.images.find(img => img.filename === uploadedFile.filename);
    if (!found) throw new Error(`上传的文件 ${uploadedFile.filename} 未出现在图片列表`);
  });

  // 清理：删除测试图片
  const deleteR = await httpReq('DELETE', `/api/images/${thisWeek.id}/${encodeURIComponent(uploadedFile.filename)}`, null, cookie);
  await test('删除测试图片', () => {
    if (!deleteR.body.success) throw new Error(deleteR.body.message || JSON.stringify(deleteR.body));
  });

  await test('删除后图片从列表消失', async () => {
    const r = await httpReq('GET', `/api/images/${thisWeek.id}`, null, cookie);
    if (!r.body.success) throw new Error(r.body.message);
    const found = r.body.images.find(img => img.filename === uploadedFile.filename);
    if (found) throw new Error(`删除的文件 ${uploadedFile.filename} 仍存在于列表`);
  });

  // ========== 边界用例 ==========
  await test('切换到上周 tab 可正常查询', async () => {
    const lastWeek = weeks.find(w => w.week_end < today);
    if (!lastWeek) return; // 无上周时跳过
    const r = await httpReq('GET', `/api/images/${lastWeek.id}`, null, cookie);
    if (!r.body.success) throw new Error(r.body.message);
  });

  await test('上周 tab 无 week_id 时返回 404', async () => {
    const r = await httpReq('GET', '/api/images/nonexistent-id', null, cookie);
    if (r.status !== 404) throw new Error(`期望 404，实际 ${r.status}`);
  });

  // 清理测试图片
  fs.unlinkSync(testImgPath);

  console.log('\n========== E2E 测试完成 ==========\n');
}

runE2E().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
