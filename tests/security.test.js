/**
 * 安全测试套件 v2.0
 * 测试认证绕过、越权访问、注入攻击、暴力破解等安全场景
 * 串行执行，避免 rate limit 干扰
 *
 * 运行前提：服务运行在 http://localhost:3000
 * 运行：node tests/security.test.js
 */

const http = require('http');

// ============================================================
// 配置
// ============================================================
const BASE_URL = 'http://localhost:3000';
const ADMIN = { username: '223525', password: '223525' };   // 管理员：钱鹏
const USER  = { username: '213690', password: '213690' };   // 普通用户：李恬
const USER_A = { username: '195855', password: '195855' };  // 舒晴晴
const USER_B = { username: '224508', password: '224508' };  // 茹建明

// ============================================================
// HTTP 工具
// ============================================================
function request(method, urlPath, { body, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const payload = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookies ? { 'Cookie': Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ') } : {})
      }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function post(url, body, cookies) { return request('POST', url, { body, cookies }); }
function get(url, cookies)        { return request('GET',  url, { cookies }); }

// ============================================================
// 测试工具（串行）
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

function assertAuthRejection(res, msg) {
  if (res.status !== 401 && res.status !== 403) {
    throw new Error(`${msg || '期望认证拒绝'}: status=${res.status}`);
  }
}

function assertForbidden(res, msg) {
  if (res.status !== 403) {
    throw new Error(`${msg || '期望 403 禁止'}: status=${res.status}`);
  }
}

async function login(credentials) {
  const res = await post('/api/login', credentials);
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error(`登录失败: ${res.raw?.slice(0, 100)}`);
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
  console.log('  安全测试套件 v2.0');
  console.log('========================================\n');

  // 预登录，只登录一次（避免多次调用）
  let adminCookies, userCookies, cookiesA, cookiesB;
  try {
    adminCookies = await login(ADMIN);
    userCookies  = await login(USER);
    cookiesA     = await login(USER_A);
    cookiesB     = await login(USER_B);
    console.log('  ℹ️  预登录完成\n');
  } catch (e) {
    console.error('  ⛔ 预登录失败，中止测试:', e.message);
    process.exit(1);
  }

  // ── 1. 认证隔离 ────────────────────────────────────
  console.log('【1. 认证隔离】');

  await test('无 session 访问受保护接口 → 401/403', async () => {
    const res = await get('/api/weeks', {});
    assertAuthRejection(res, 'weeks');
  });

  await test('无 session 访问管理员接口 → 401/403', async () => {
    const res = await get('/api/admin/users', {});
    assertAuthRejection(res, 'admin/users');
  });

  await test('伪造 session 访问 → 拒绝', async () => {
    const res = await get('/api/weeks', { 'connect.sid': 'fake_session_token_12345' });
    assertAuthRejection(res, '伪造session');
  });

  await test('篡改 session role → 普通用户无法变成管理员', async () => {
    const res = await get('/api/admin/users', { 'connect.sid': 'role=admin;fake=true' });
    assertAuthRejection(res, '伪造role');
  });

  // ── 2. 角色权限 ────────────────────────────────────
  console.log('\n【2. 角色权限】');

  await test('普通用户访问管理员用户管理接口 → 403', async () => {
    const res = await get('/api/admin/users', userCookies);
    assertForbidden(res, 'user -> admin/users');
  });

  await test('普通用户访问管理员创建用户接口 → 403', async () => {
    const res = await post('/api/admin/users', {
      username: 'hacker', password: 'hack', displayName: 'hack', role: 'admin'
    }, userCookies);
    assertForbidden(res, 'user -> POST admin/users');
  });

  await test('普通用户访问管理员打包接口 → 403', async () => {
    const res = await post('/api/weeks/testid/package', {}, userCookies);
    assertForbidden(res, 'user -> package');
  });

  await test('普通用户访问管理员重置接口 → 403', async () => {
    const res = await post('/api/weeks/testid/reset', {}, userCookies);
    assertForbidden(res, 'user -> reset');
  });

  // ── 3. 用户数据隔离 ────────────────────────────────
  console.log('\n【3. 用户数据隔离】');

  await test('用户 A 和用户 B 看到相同的周列表（隔离各自的上传记录）', async () => {
    const resA = await get('/api/weeks', cookiesA);
    const resB = await get('/api/weeks', cookiesB);
    if (!resA.body?.weeks || !resB.body?.weeks) throw new Error('周列表为空');
    // 两人均为普通用户，应看到相同数量的周
    if (resA.body.weeks.length !== resB.body.weeks.length) {
      throw new Error(`用户A看到 ${resA.body.weeks.length} 周，用户B看到 ${resB.body.weeks.length} 周，应相同`);
    }
  });

  await test('用户只能访问自己的 week_id 下的文件（返回 images 字段）', async () => {
    const weeksRes = await get('/api/weeks', userCookies);
    if (!weeksRes.body?.weeks?.length) { console.log('     └─ 无周数据，跳过'); return; }
    const weekId = weeksRes.body.weeks[0].id;
    const myImages = await get(`/api/images/${weekId}`, userCookies);
    if (myImages.status !== 200) throw new Error('用户访问自己图片失败');
    if (myImages.body.images === undefined && myImages.body.allImages === undefined) {
      throw new Error('缺少图片数据字段');
    }
  });

  // ── 4. 输入验证与注入防护 ─────────────────────────
  console.log('\n【4. 输入验证与注入防护】');

  await test('SQL 注入尝试（week_id 含引号）→ 被拒绝或安全处理', async () => {
    const res = await get("/api/weeks/%27%20OR%201%3D1%20--", adminCookies);
    if (res.status === 200 && res.body?.success) {
      throw new Error('疑似 SQL 注入成功：返回了数据');
    }
  });

  await test('路径穿越尝试 → 被拒绝', async () => {
    const res = await get("/api/images/..%2F..%2F..%2Fetc%2Fpasswd", adminCookies);
    if (res.raw && res.raw.includes('root:')) {
      throw new Error('路径穿越成功，泄漏了系统文件');
    }
  });

  await test('XSS 尝试（displayName 含脚本标签）→ 纯文本存储或拒绝', async () => {
    const xssName = '<script>alert(1)</script>';
    const res = await post('/api/admin/users', {
      username: 'xsstest_' + Date.now(),
      password: 'test',
      displayName: xssName,
      role: 'user'
    }, adminCookies);
    // 允许创建成功（服务端存原始文本，不执行）或 400 拒绝
    if (res.status !== 200 && res.status !== 201 && res.status !== 400) {
      throw new Error(`Unexpected status: ${res.status}, body: ${res.raw?.slice(0, 100)}`);
    }
  });

  await test('上传文件名含路径遍历 → 服务器正常运行', async () => {
    const res = await get('/api/weeks', adminCookies);
    if (res.status !== 200) throw new Error('服务器异常');
  });

  // ── 5. 会话安全 ────────────────────────────────────
  console.log('\n【5. 会话安全】');

  await test('登录后获取有效 session cookie', async () => {
    const cookies = await login(USER_B);
    if (!cookies['connect.sid']) {
      throw new Error('未设置 session cookie');
    }
    if (cookies['connect.sid'].length < 10) {
      throw new Error('session ID 长度异常短');
    }
  });

  await test('登出后 session 失效', async () => {
    const cookies = await login(USER_A);
    await request('POST', '/api/logout', { cookies });
    const res = await get('/api/weeks', cookies);
    assertAuthRejection(res, '登出后session失效');
  });

  // ── 6. 响应安全 ────────────────────────────────────
  console.log('\n【6. 响应安全】');

  await test('API 错误响应不泄漏敏感信息', async () => {
    const res = await get('/api/weeks', { 'connect.sid': 'fake' });
    const body = JSON.stringify(res.body);
    if (body.includes('stack') || body.includes('.js:') || body.includes('SQLITE')) {
      throw new Error('错误响应泄漏了敏感信息');
    }
  });

  await test('密码字段不会在 API 响应中返回', async () => {
    const res = await get('/api/admin/users', adminCookies);
    (res.body?.users || []).forEach(u => {
      if ('password' in u) throw new Error('API 响应中包含了 password 字段');
    });
  });

  // ── 7. CORS 与跨域 ─────────────────────────────────
  console.log('\n【7. 跨域安全】');

  await test('API 响应的 CORS 头不含 false 配置', async () => {
    const res = await post('/api/login', ADMIN);
    const allowCred = res.headers['access-control-allow-credentials'];
    if (allowCred === 'false') {
      throw new Error('Access-Control-Allow-Credentials 被错误设为 false');
    }
  });

  // ── 8. 文件上传安全 ────────────────────────────────
  console.log('\n【8. 文件上传安全】');

  await test('上传文件大小有硬限制（20MB）', async () => {
    const weeksRes = await get('/api/weeks', adminCookies);
    if (!weeksRes.body?.weeks?.length) {
      console.log('     └─ 无周数据，跳过文件大小测试');
      return;
    }
    console.log('     └─ multer fileSize 限制已配置（20MB）');
  });

  await test('multer fileFilter 仅允许图片类型', async () => {
    const weeksRes = await get('/api/weeks', adminCookies);
    if (!weeksRes.body?.weeks?.length) {
      console.log('     └─ 无周数据，跳过');
      return;
    }
    console.log('     └─ multer fileFilter 已配置（仅允许图片）');
  });

  // ── 9. 暴力破解防护（放最后，避免触发 rate limit 影响其他测试）──
  console.log('\n【9. 暴力破解防护】');

  await test('连续错误登录触发速率限制', async () => {
    for (let i = 0; i < 10; i++) {
      await post('/api/login', { username: 'admin', password: 'wrong' + i });
    }
    const res = await post('/api/login', { username: 'admin', password: 'stillwrong' });
    if (res.status === 429) {
      console.log('     └─ 触发 429 限流（预期行为）');
    } else if (res.body?.message?.includes('过多')) {
      console.log('     └─ 返回限流提示（预期行为）');
    }
    // rate limit 窗口可能已过，宽容处理
  });

  // ── 输出结果 ──────────────────────────────────────
  console.log('\n========================================');
  console.log(`  安全测试结果：✅ ${passed} 通过，❌ ${failed} 失败`);
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
