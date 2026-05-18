/**
 * 功能测试套件
 * 使用 Node.js 内置 http 模块，无需额外依赖
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
const FormData = require('form-data');

// ============================================================
// 配置
// ============================================================
const BASE_URL = 'http://localhost:3000';
const ADMIN = { username: 'admin', password: 'admin123' };
const USER = { username: 'uploader', password: 'upload@2024' };

// ============================================================
// HTTP 工具
// ============================================================
function request(method, urlPath, { body, headers, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    // 添加 Cookie
    if (cookies) {
      options.headers['Cookie'] = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`).join('; ');
    }

    // multipart 不设置 Content-Type（让 Node 自动设置含 boundary）
    if (body instanceof FormData || headers?.['Content-Type'] === undefined && !(body instanceof Object)) {
      delete options.headers['Content-Type'];
    }

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
      });
    });

    req.on('error', reject);

    if (body) {
      if (body instanceof FormData) {
        // form-data 需要单独处理
        req.destroy();
        resolve({ status: 0, error: '请使用 requestMultipart' });
      } else if (typeof body === 'string' || Buffer.isBuffer(body)) {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

function post(url, body, cookies, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (cookies) {
    h['Cookie'] = Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');
  }
  return request('POST', url, { body, headers: h });
}

function get(url, cookies) {
  return request('GET', url, {
    cookies,
    headers: { 'Accept': 'application/json' }
  });
}

function del(url, cookies) {
  return request('DELETE', url, { cookies });
}

// ============================================================
// 测试工具
// ============================================================
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch(e) {
      failed++;
      failures.push({ name, error: e.message });
      console.log(`  ❌ ${name}`);
      console.log(`     └─ ${e.message}`);
    }
  })();
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || '断言失败'}: expected ${expected}, got ${actual}`);
  }
}

function assertOk(res, msg) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${msg || '期望成功响应'}: status=${res.status}`);
  }
  if (res.body && res.body.success === false) {
    throw new Error(`${msg || '期望成功'}: ${res.body.message}`);
  }
}

function assertFail(res, msg) {
  if (res.status >= 200 && res.status < 400) {
    throw new Error(`${msg || '期望失败响应'}: status=${res.status}, body=${JSON.stringify(res.body)}`);
  }
}

// ============================================================
// 登录辅助：返回 cookies
// ============================================================
async function login(credentials) {
  const res = await post('/api/login', credentials);
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return {};
  const cookies = {};
  setCookie.forEach(c => {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (k && v) cookies[k.trim()] = v.trim();
  });
  return cookies;
}

// ============================================================
// 主测试
// ============================================================
async function run() {
  console.log('\n========================================');
  console.log('  功能测试套件');
  console.log('========================================\n');

  // ── 1. 认证相关 ──────────────────────────────────────
  console.log('【1. 认证测试】');

  test('未登录访问受保护接口返回 401', async () => {
    const res = await get('/api/weeks');
    eq(res.status, 401, 'status');
  });

  test('错误密码登录返回 401', async () => {
    const res = await post('/api/login', { username: 'admin', password: 'wrongpassword' });
    eq(res.status, 401, 'status');
    eq(res.body.success, false, 'success=false');
  });

  test('正确账号登录返回用户信息', async () => {
    const res = await post('/api/login', { username: ADMIN.username, password: ADMIN.password });
    assertOk(res, '登录成功');
    eq(res.body.role, 'admin', 'role=admin');
    eq(!!res.body.username, true, '有username');
  });

  test('获取登录状态返回已登录', async () => {
    const res = await post('/api/login', { username: ADMIN.username, password: ADMIN.password });
    const cookies = await login(ADMIN);
    const status = await get('/api/auth/status', cookies);
    assertOk(status, '获取状态成功');
    eq(status.body.loggedIn, true, 'loggedIn=true');
  });

  // ── 2. 周列表接口 ──────────────────────────────────
  console.log('\n【2. 周列表测试】');

  let adminCookies;
  let userCookies;

  test('管理员登录获取周列表', async () => {
    adminCookies = await login(ADMIN);
    const res = await get('/api/weeks', adminCookies);
    assertOk(res, '获取成功');
    eq(Array.isArray(res.body.weeks), true, 'weeks是数组');
  });

  test('管理员周列表包含所有周（超过3条）', async () => {
    const res = await get('/api/weeks', adminCookies);
    assertOk(res, '获取成功');
    if (res.body.weeks.length < 3) {
      throw new Error(`管理员应看到全部周，至少3条，实际${res.body.weeks.length}条`);
    }
  });

  test('普通用户周列表限制为3条', async () => {
    userCookies = await login(USER);
    const res = await get('/api/weeks', userCookies);
    assertOk(res, '获取成功');
    eq(res.body.weeks.length <= 3, true, '普通用户最多3周');
  });

  test('普通用户周列表有 is_limited 标记', async () => {
    const res = await get('/api/weeks', userCookies);
    if (res.body.weeks.length > 0) {
      eq(typeof res.body.weeks[0].is_limited !== 'undefined', true, '有is_limited字段');
    }
  });

  test('周列表返回正确的字段', async () => {
    const res = await get('/api/weeks', userCookies);
    assertOk(res, '获取成功');
    const w = res.body.weeks[0];
    const required = ['id', 'folder_name', 'week_start', 'week_end', 'status', 'my_status'];
    required.forEach(field => {
      if (!(field in w)) throw new Error(`缺少字段: ${field}`);
    });
  });

  // ── 3. 上传功能 ────────────────────────────────────
  console.log('\n【3. 上传功能测试】');

  test('未登录上传返回 401', async () => {
    const res = await post('/api/upload', { week_id: 'test' });
    eq(res.status, 401, 'status=401');
  });

  test('上传缺少 week_id 返回 400', async () => {
    const res = await post('/api/upload', {}, adminCookies);
    eq(res.status, 400, 'status=400');
  });

  test('上传不存在的 week_id 返回 404', async () => {
    const res = await post('/api/upload', { week_id: 'nonexistent' }, adminCookies);
    eq(res.status, 404, 'status=404');
  });

  // ── 4. 确认完成 ────────────────────────────────────
  console.log('\n【4. 确认完成测试】');

  test('获取某个周详情成功', async () => {
    const weeks = await get('/api/weeks', adminCookies);
    const firstWeek = weeks.body.weeks[0];
    const res = await get(`/api/weeks/${firstWeek.id}`, adminCookies);
    assertOk(res, '获取成功');
    eq(!!res.body.week, true, '有week数据');
  });

  test('普通用户确认完成本周', async () => {
    const weeks = await get('/api/weeks', userCookies);
    // 找 pending 状态的周
    const pendingWeek = weeks.body.weeks.find(w => w.status === 'pending' && w.my_status !== 'completed');
    if (!pendingWeek) {
      console.log('     └─ 无 pending 周，跳过');
      return;
    }
    const res = await post(`/api/weeks/${pendingWeek.id}/complete`, {}, userCookies);
    // 只要不是 500 错误即可（业务逻辑容许返回 400 等）
    if (res.status >= 500) throw new Error(`服务器错误: ${res.body.message}`);
  });

  // ── 5. 管理员功能 ──────────────────────────────────
  console.log('\n【5. 管理员功能测试】');

  test('普通用户不能访问管理员接口 → 403', async () => {
    const res = await get('/api/admin/users', userCookies);
    eq(res.status, 403, 'status=403');
  });

  test('管理员获取用户列表', async () => {
    const res = await get('/api/admin/users', adminCookies);
    assertOk(res, '获取成功');
    eq(Array.isArray(res.body.users), true, 'users是数组');
  });

  test('管理员创建新用户', async () => {
    const randomUser = 'testuser_' + Date.now();
    const res = await post('/api/admin/users', {
      username: randomUser,
      password: 'test123',
      displayName: '测试用户',
      role: 'user'
    }, adminCookies);
    // 允许 201 或 200
    if (res.status !== 201 && res.status !== 200) {
      // 可能是用户已存在，宽容处理
      if (res.body.message && res.body.message.includes('已存在')) return;
      throw new Error(`创建用户失败: ${res.status} ${res.body.message}`);
    }
    eq(res.body.success, true, '创建成功');
  });

  test('管理员手动打包不存在的周 → 404', async () => {
    const res = await post('/api/weeks/nonexistent/package', {}, adminCookies);
    eq(res.status, 404, 'status=404');
  });

  test('管理员重置不存在的周 → 404', async () => {
    const res = await post('/api/weeks/nonexistent/reset', {}, adminCookies);
    eq(res.status, 404, 'status=404');
  });

  // ── 6. 登出 ────────────────────────────────────────
  console.log('\n【6. 会话测试】');

  test('登出成功', async () => {
    const res = await request('POST', '/api/logout', {
      headers: { 'Content-Type': 'application/json' }
    });
    eq(res.status, 200, 'status=200');
    // 登出后再访问受保护接口应返回 401
    const protectedRes = await get('/api/weeks', {});
    eq(protectedRes.status, 401, '登出后访问受保护接口=401');
  });

  // ── 7. 文件操作 ────────────────────────────────────
  console.log('\n【7. 文件操作测试】');

  test('访问不存在的周的图片列表 → 404', async () => {
    const res = await get('/api/images/nonexistent', adminCookies);
    eq(res.status, 404, 'status=404');
  });

  test('删除不存在的文件 → 404', async () => {
    const weeks = await get('/api/weeks', adminCookies);
    const firstWeek = weeks.body.weeks[0];
    const res = await del(`/api/images/${firstWeek.id}/nonexistent.jpg`, adminCookies);
    eq(res.status, 404, 'status=404');
  });

  // ── 8. 接口格式 ────────────────────────────────────
  console.log('\n【8. 接口格式测试】');

  test('GET /api/weeks 响应格式正确', async () => {
    const res = await get('/api/weeks', adminCookies);
    assertOk(res, '获取成功');
    eq(res.body.success, true, 'success=true');
    eq(Array.isArray(res.body.weeks), true, 'weeks是数组');
  });

  test('GET / 不存在的接口 → 404', async () => {
    const res = await get('/api/nonexistent', adminCookies);
    eq(res.status, 404, 'status=404');
  });

  test('POST 空 body → 400', async () => {
    const res = await post('/api/login', {});
    eq(res.status, 400, 'status=400');
  });

  // 等待所有测试完成
  setTimeout(() => {
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
  }, 2000);
}

run().catch(err => {
  console.error('测试运行错误:', err.message);
  process.exit(1);
});
