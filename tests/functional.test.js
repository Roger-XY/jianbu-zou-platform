/**
 * 功能测试套件
 * 使用 Node.js 内置 http/https 模块，无需额外依赖
 *
 * 运行前提：
 * 1. 服务运行在 http://localhost:3000
 * 2. 测试账号存在（admin/admin123, uploader/upload@2024）
 *
 * 运行：node tests/functional.test.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// 配置
// ============================================================
const BASE_URL = 'http://localhost:3000';
const ADMIN = { username: '223525', password: '223525' };   // 管理员：钱鹏
const USER  = { username: '213690', password: '213690' };   // 普通用户：李恬

// ============================================================
// HTTP 工具 — JSON 请求
// ============================================================
function request(method, urlPath, { body, headers = {}, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const payload = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
        ...(cookies ? { 'Cookie': cookieStr(cookies) } : {})
      }
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieStr(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('; ');
}

function post(url, body, cookies, extraHeaders = {}) {
  return request('POST', url, { body, cookies, headers: extraHeaders });
}

function get(url, cookies) {
  return request('GET', url, { cookies });
}

function del(url, cookies) {
  return request('DELETE', url, { cookies });
}

// ============================================================
// HTTP 工具 — multipart/form-data 上传
// ============================================================
/**
 * 发送 multipart/form-data 请求
 * @param {string} urlPath  — 支持 query string，如 /api/upload?week_id=1
 * @param {Array<{name,filename,mime,data}>} fileParts  — 文件字段
 * @param {Object} fields   — 普通文本字段（key→value）
 * @param {Object} cookies
 */
function requestMultipart(urlPath, fileParts = [], fields = {}, cookies = {}) {
  return new Promise((resolve, reject) => {
    // boundary 值不含 --，请求体里的分隔符才加 --
    const boundary = 'TestBoundary' + Date.now();
    const CRLF = '\r\n';

    const parts = [];

    // 文本字段
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
        `${value}${CRLF}`
      );
    }

    // 文件字段
    for (const fp of fileParts) {
      const header =
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${fp.name}"; filename="${fp.filename}"${CRLF}` +
        `Content-Type: ${fp.mime}${CRLF}${CRLF}`;
      parts.push({ header, data: fp.data });
    }

    // 构建 Buffer
    const chunks = [];
    for (const p of parts) {
      if (typeof p === 'string') {
        chunks.push(Buffer.from(p));
      } else {
        chunks.push(Buffer.from(p.header));
        chunks.push(p.data);
        chunks.push(Buffer.from(CRLF));
      }
    }
    chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
    const body = Buffer.concat(chunks);

    const url  = new URL(urlPath, BASE_URL);
    const opts = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        ...(cookies ? { 'Cookie': cookieStr(cookies) } : {})
      }
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============================================================
// 测试工具（串行执行版）
// ============================================================
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${e.message}`);
  }
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || '断言失败'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertOk(res, msg) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${msg || '期望成功响应'}: status=${res.status}, body=${res.raw}`);
  }
  if (res.body && res.body.success === false) {
    throw new Error(`${msg || '期望成功'}: ${res.body.message}`);
  }
}

// 期望 4xx 响应
function assertFail(res, msg) {
  if (res.status < 400 || res.status >= 500) {
    throw new Error(`${msg || '期望 4xx 错误'}: status=${res.status}, body=${res.raw}`);
  }
}

// ============================================================
// 登录辅助：返回 cookies 对象
// ============================================================
async function login(credentials) {
  const res = await post('/api/login', credentials);
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error(`登录失败，未收到 cookie: ${res.raw}`);
  const cookies = {};
  setCookie.forEach(c => {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (k && v) cookies[k.trim()] = v.trim();
  });
  return cookies;
}

// ============================================================
// 最小合法 PNG（1×1 白色像素，经过验证的 base64）
// ============================================================
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// ============================================================
// 主测试
// ============================================================
async function run() {
  console.log('\n========================================');
  console.log('  功能测试套件 v2.0');
  console.log('========================================\n');

  let adminCookies;
  let userCookies;
  let firstWeekId;

  // ── 0. 预登录 + 预获取周 ID（后续复用） ────────────────
  try {
    adminCookies = await login(ADMIN);
    userCookies  = await login(USER);
  } catch (e) {
    console.error('  ⛔ 前置登录失败，中止测试:', e.message);
    process.exit(1);
  }

  // 获取第一个可用周 ID（供上传测试使用）
  try {
    const weeksRes = await get('/api/weeks', adminCookies);
    if (weeksRes.body.weeks && weeksRes.body.weeks.length > 0) {
      firstWeekId = weeksRes.body.weeks[0].id;
    }
  } catch (_) {}
  if (firstWeekId) {
    console.log(`  ℹ️  使用测试周 ID: ${firstWeekId}`);
  } else {
    console.log('  ⚠️  无可用周数据，上传相关测试将跳过');
  }

  // ── 1. 认证相关 ──────────────────────────────────────
  console.log('【1. 认证测试】');

  await test('未登录访问受保护接口返回 401', async () => {
    const res = await get('/api/weeks');
    eq(res.status, 401, 'status');
  });

  await test('错误密码登录返回 401', async () => {
    const res = await post('/api/login', { username: 'admin', password: 'wrongpassword' });
    eq(res.status, 401, 'status');
    eq(res.body.success, false, 'success=false');
  });

  await test('正确账号登录返回用户信息', async () => {
    const res = await post('/api/login', ADMIN);
    assertOk(res, '登录成功');
    eq(res.body.role, 'admin', 'role=admin');
    eq(!!res.body.username, true, '有username');
  });

  await test('获取登录状态返回已登录', async () => {
    const status = await get('/api/auth/status', adminCookies);
    assertOk(status, '获取状态成功');
    eq(status.body.loggedIn, true, 'loggedIn=true');
  });

  // ── 2. 周列表接口 ──────────────────────────────────
  console.log('\n【2. 周列表测试】');

  await test('管理员获取周列表成功', async () => {
    const res = await get('/api/weeks', adminCookies);
    assertOk(res, '获取成功');
    eq(Array.isArray(res.body.weeks), true, 'weeks是数组');
  });

  await test('管理员周列表包含完整字段', async () => {
    const res = await get('/api/weeks', adminCookies);
    assertOk(res, '获取成功');
    const w = res.body.weeks[0];
    for (const f of ['id', 'folder_name', 'week_start', 'week_end', 'status']) {
      if (!(f in w)) throw new Error(`缺少字段: ${f}`);
    }
  });

  await test('普通用户周列表限制为 ≤3 条', async () => {
    const res = await get('/api/weeks', userCookies);
    assertOk(res, '获取成功');
    if (res.body.weeks.length > 3) throw new Error(`普通用户应最多3周，实际 ${res.body.weeks.length} 条`);
  });

  await test('普通用户周列表有 is_limited 标记', async () => {
    const res = await get('/api/weeks', userCookies);
    if (res.body.weeks.length > 0) {
      if (res.body.weeks[0].is_limited === undefined) throw new Error('缺少 is_limited 字段');
    }
  });

  // ── 3. 图片上传功能 ────────────────────────────────
  console.log('\n【3. 上传功能测试】');

  await test('未登录上传返回 401', async () => {
    const res = await post('/api/upload', {});
    eq(res.status, 401, 'status=401');
  });

  await test('上传缺少 week_id（无 query）返回 400', async () => {
    // 发送 multipart 但不带 week_id query
    const res = await requestMultipart('/api/upload', [], {}, adminCookies);
    eq(res.status, 400, `status=400, body=${JSON.stringify(res.body)}`);
  });

  await test('上传不存在的 week_id 返回 404', async () => {
    const res = await requestMultipart(
      '/api/upload?week_id=nonexistent_id_12345',
      [{ name: 'images', filename: 'test.png', mime: 'image/png', data: TINY_PNG }],
      {},
      adminCookies
    );
    eq(res.status, 404, `status=404, body=${JSON.stringify(res.body)}`);
  });

  await test('上传时不附带文件返回 400', async () => {
    if (!firstWeekId) { console.log('     └─ 无周数据，跳过'); return; }
    const res = await requestMultipart(
      `/api/upload?week_id=${firstWeekId}`,
      [],     // 无文件
      {},
      adminCookies
    );
    eq(res.status, 400, `status=400, body=${JSON.stringify(res.body)}`);
  });

  let uploadedFilename = null;

  await test('✨ 真实 multipart 上传图片成功', async () => {
    if (!firstWeekId) { console.log('     └─ 无周数据，跳过'); return; }

    // 先确认该周是 pending 状态
    const weekDetail = await get(`/api/weeks/${firstWeekId}`, adminCookies);
    if (weekDetail.body.week && weekDetail.body.week.status === 'completed') {
      // 重置一下
      await post(`/api/weeks/${firstWeekId}/reset`, {}, adminCookies);
    }

    const res = await requestMultipart(
      `/api/upload?week_id=${firstWeekId}`,
      [{ name: 'images', filename: 'test_upload.png', mime: 'image/png', data: TINY_PNG }],
      {},
      adminCookies
    );
    if (res.status !== 200) {
      throw new Error(`上传失败: status=${res.status}, body=${JSON.stringify(res.body)}`);
    }
    assertOk(res, '上传成功');
    if (!Array.isArray(res.body.files) || res.body.files.length === 0) {
      throw new Error('返回的 files 数组为空');
    }
    uploadedFilename = res.body.files[0].filename;
    console.log(`     └─ 已上传文件: ${uploadedFilename}`);
  });

  await test('上传成功后图片列表中可查到', async () => {
    if (!firstWeekId || !uploadedFilename) { console.log('     └─ 无上传文件，跳过'); return; }
    const res = await get(`/api/images/${firstWeekId}`, adminCookies);
    assertOk(res, '获取图片列表成功');
    // 管理员返回的是 allImages 字段
    const allImages = res.body.allImages || {};
    const found = Object.values(allImages).flat().some(f => f.filename === uploadedFilename);
    if (!found) throw new Error(`图片列表中未找到刚上传的文件 ${uploadedFilename}`);
  });

  await test('删除刚上传的图片成功', async () => {
    if (!firstWeekId || !uploadedFilename) { console.log('     └─ 无上传文件，跳过'); return; }
    const res = await del(
      `/api/images/${firstWeekId}/${encodeURIComponent(uploadedFilename)}?username=${ADMIN.username}`,
      adminCookies
    );
    assertOk(res, '删除成功');
  });

  await test('删除后再次访问该文件返回 404', async () => {
    if (!firstWeekId || !uploadedFilename) { console.log('     └─ 无上传文件，跳过'); return; }
    // 文件已删除，再次删除同一文件应该返回 404
    const res = await del(
      `/api/images/${firstWeekId}/${encodeURIComponent(uploadedFilename)}?username=${ADMIN.username}`,
      adminCookies
    );
    eq(res.status, 404, 'status=404');
  });

  await test('上传多张图片一次成功', async () => {
    if (!firstWeekId) { console.log('     └─ 无周数据，跳过'); return; }
    const files = [
      { name: 'images', filename: 'batch1.png', mime: 'image/png', data: TINY_PNG },
      { name: 'images', filename: 'batch2.png', mime: 'image/png', data: TINY_PNG },
    ];
    const res = await requestMultipart(
      `/api/upload?week_id=${firstWeekId}`,
      files,
      {},
      adminCookies
    );
    assertOk(res, '批量上传成功');
    if (res.body.files.length !== 2) {
      throw new Error(`期望返回2个文件，实际 ${res.body.files.length}`);
    }
    // 清理
    for (const f of res.body.files) {
      await del(`/api/images/${firstWeekId}/${encodeURIComponent(f.filename)}?username=${ADMIN.username}`, adminCookies);
    }
  });

  // ── 4. 图片列表与删除 ─────────────────────────────
  console.log('\n【4. 图片列表与删除测试】');

  await test('访问不存在的周的图片列表 → 404', async () => {
    const res = await get('/api/images/nonexistent', adminCookies);
    eq(res.status, 404, 'status=404');
  });

  await test('删除不存在的文件 → 404', async () => {
    if (!firstWeekId) { console.log('     └─ 无周数据，跳过'); return; }
    const res = await del(`/api/images/${firstWeekId}/this_file_does_not_exist.jpg`, adminCookies);
    eq(res.status, 404, 'status=404');
  });

  await test('普通用户可获取自己的图片列表', async () => {
    if (!firstWeekId) { console.log('     └─ 无周数据，跳过'); return; }
    const res = await get(`/api/images/${firstWeekId}`, userCookies);
    assertOk(res, '获取成功');
    if (res.body.images === undefined) throw new Error('普通用户响应中缺少 images 字段');
  });

  // ── 5. 确认完成 ────────────────────────────────────
  console.log('\n【5. 确认完成测试】');

  await test('获取某个周详情成功', async () => {
    if (!firstWeekId) { console.log('     └─ 无周数据，跳过'); return; }
    const res = await get(`/api/weeks/${firstWeekId}`, adminCookies);
    assertOk(res, '获取成功');
    eq(!!res.body.week, true, '有week数据');
  });

  await test('普通用户确认完成本周（不报 5xx）', async () => {
    const weeks = await get('/api/weeks', userCookies);
    const pendingWeek = weeks.body.weeks.find(w => w.status === 'pending' && w.my_status !== 'completed');
    if (!pendingWeek) { console.log('     └─ 无 pending 周，跳过'); return; }
    const res = await post(`/api/weeks/${pendingWeek.id}/complete`, {}, userCookies);
    if (res.status >= 500) throw new Error(`服务器错误: ${res.body.message}`);
  });

  // ── 6. 管理员功能 ──────────────────────────────────
  console.log('\n【6. 管理员功能测试】');

  await test('普通用户不能访问管理员接口 → 403', async () => {
    const res = await get('/api/admin/users', userCookies);
    eq(res.status, 403, 'status=403');
  });

  await test('管理员获取用户列表', async () => {
    const res = await get('/api/admin/users', adminCookies);
    assertOk(res, '获取成功');
    eq(Array.isArray(res.body.users), true, 'users是数组');
  });

  await test('管理员响应中不含 password 字段', async () => {
    const res = await get('/api/admin/users', adminCookies);
    (res.body.users || []).forEach(u => {
      if ('password' in u) throw new Error('响应中包含 password 字段');
    });
  });

  await test('管理员创建新用户', async () => {
    const username = 'testuser_' + Date.now();
    const res = await post('/api/admin/users', {
      username, password: 'test123', displayName: '测试用户', role: 'user'
    }, adminCookies);
    if (res.status !== 200 && res.status !== 201) {
      if (res.body?.message?.includes('已存在')) return;
      throw new Error(`创建用户失败: ${res.status} ${res.body?.message}`);
    }
    eq(res.body.success, true, '创建成功');
  });

  await test('管理员手动打包不存在的周 → 404', async () => {
    const res = await post('/api/weeks/nonexistent/package', {}, adminCookies);
    eq(res.status, 404, 'status=404');
  });

  await test('管理员重置不存在的周 → 404', async () => {
    const res = await post('/api/weeks/nonexistent/reset', {}, adminCookies);
    eq(res.status, 404, 'status=404');
  });

  // ── 7. 接口格式 ────────────────────────────────────
  console.log('\n【7. 接口格式测试】');

  await test('GET /api/weeks 响应有 success:true', async () => {
    const res = await get('/api/weeks', adminCookies);
    eq(res.body.success, true, 'success=true');
  });

  await test('不存在的接口返回 404', async () => {
    const res = await get('/api/nonexistent_endpoint_xyz', adminCookies);
    eq(res.status, 404, 'status=404');
  });

  await test('POST 空 body 登录返回 400', async () => {
    const res = await post('/api/login', {});
    eq(res.status, 400, 'status=400');
  });

  // ── 8. 会话测试 ────────────────────────────────────
  console.log('\n【8. 会话测试】');

  await test('登出成功后再访问受保护接口返回 401', async () => {
    const tempCookies = await login(USER);
    await post('/api/logout', {}, tempCookies);
    const res = await get('/api/weeks', tempCookies);
    eq(res.status, 401, '登出后应返回401');
  });

  // ── 所有测试已串行完成，直接打印结果 ──────────────
  console.log('\n========================================');
  console.log(`  测试结果：✅ ${passed} 通过，❌ ${failed} 失败`);
  if (failures.length > 0) {
    console.log('\n  失败详情：');
    failures.forEach((f, i) => {
      console.log(`  ${i+1}. ${f.name}`);
      console.log(`     ${f.error}`);
    });
  }
  console.log('========================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('测试运行错误:', err.message);
  process.exit(1);
});
