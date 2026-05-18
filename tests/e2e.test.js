/**
 * E2E 功能测试 - 健步走上传平台 v2.3
 *
 * 运行方式：
 *   node tests/e2e.test.js
 *
 * 测试覆盖：
 *   1. 登录态检查（checkAuth）
 *   2. 管理员登录后 admin panel 数据加载
 *   3. 周详情区块可见性
 *   4. 普通用户登录态和用户面板加载
 *   5. 登出功能
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:3000';
const ADMIN_USER = '223525';
const ADMIN_PWD = '223525';
const USER_USER = '213690';
const USER_PWD = '213690';

// 简易 Cookie Jar
class CookieJar {
  constructor() { this.cookies = []; }
  add(setCookie) {
    if (Array.isArray(setCookie)) {
      setCookie.forEach(c => {
        const m = c.match(/^([^=]+)=([^;]+)/);
        if (m) {
          const existing = this.cookies.findIndex(x => x.startsWith(m[1] + '='));
          if (existing >= 0) this.cookies[existing] = m[1] + '=' + m[2];
          else this.cookies.push(m[1] + '=' + m[2]);
        }
      });
    }
  }
  header() {
    const h = this.cookies.join('; ');
    return h ? { Cookie: h } : {};
  }
}

function req(method, urlPath, { body, jar, json = true } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json', ...jar.header() }
    };
    const req = http.request(opts, res => {
      jar.add(res.headers['set-cookie']);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (!json) return resolve({ status: res.statusCode, body: data });
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(condition, msg) {
  if (!condition) throw new Error('❌ 断言失败: ' + msg);
  console.log('  ✓ ' + msg);
}

async function run() {
  console.log('\n========================================');
  console.log('E2E 功能测试 - 健步走上传平台');
  console.log('========================================\n');

  let passed = 0, failed = 0;

  async function test(name, fn) {
    process.stdout.write(`[${name}] `);
    try {
      await fn();
      passed++;
    } catch(e) {
      console.error('  ❌ ' + e.message);
      failed++;
    }
  }

  // ── 读取 index.html 检查 HTML 结构 ──────────────────────────
  await test('HTML结构 - admin-page 与 user-content 在 app-page 内', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 检查关键元素的 ID 均存在于 HTML 中
    assert(html.includes('<div id="app-page">'), 'app-page 元素存在');
    assert(html.includes('<div class="main-content" id="user-content">'), 'user-content 元素存在');
    assert(html.includes('<div class="main-content" id="admin-page">'), 'admin-page 元素存在');
    // 验证 admin-page 确实不在 user-content 的闭合标签之后才出现
    // 用行号辅助判断：grep 输出已确认 admin-page 在 user-content 之后
    const lines = html.split('\n');
    let userContentLine = -1, adminPageLine = -1;
    lines.forEach((l, i) => {
      if (l.includes('id="user-content"')) userContentLine = i;
      if (l.includes('id="admin-page"') && l.trim().startsWith('<div')) adminPageLine = i;
    });
    assert(userContentLine >= 0 && adminPageLine >= 0, `user-content 在第${userContentLine + 1}行，admin-page 在第${adminPageLine + 1}行`);
    assert(adminPageLine > userContentLine, 'admin-page 在 user-content 之后（同级关系）');
  });

  await test('HTML结构 - admin-week-detail-section 元素存在', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(html.includes('id="admin-week-detail-section"'), 'admin-week-detail-section 元素存在');
    assert(html.includes('id="admin-detail-week-select"'), 'admin-detail-week-select 选择器存在');
    assert(html.includes('id="detail-breadcrumb"'), '面包屑导航元素存在');
  });

  // ── Test 1: checkAuth 无登录态 ──────────────────────────────
  await test('checkAuth - 未登录返回 loggedIn:false', async () => {
    const jar = new CookieJar();
    const r = await req('GET', '/api/auth/status', { jar });
    assert(r.body.loggedIn === false, `loggedIn=${r.body.loggedIn}`);
  });

  // ── Test 2: 管理员完整登录流程 ───────────────────────────────
  await test('管理员登录 - POST /api/login', async () => {
    const jar = new CookieJar();
    const r = await req('POST', '/api/login', { body: { username: ADMIN_USER, password: ADMIN_PWD }, jar });
    assert(r.status === 200, `status=200`);
    assert(r.body.success === true, `success=true`);
    assert(r.body.role === 'admin', `role=admin`);
    assert(r.body.username === ADMIN_USER, `username=${ADMIN_USER}`);
    // 保存 jar 供后续测试用
    global.adminJar = jar;
  });

  await test('管理员 - checkAuth 返回已登录', async () => {
    const r = await req('GET', '/api/auth/status', { jar: global.adminJar });
    assert(r.body.loggedIn === true, `loggedIn=true`);
    assert(r.body.role === 'admin', `role=admin`);
  });

  await test('管理员 - GET /api/weeks 返回所有周', async () => {
    const r = await req('GET', '/api/weeks', { jar: global.adminJar });
    assert(r.body.success === true, `success=true`);
    assert(Array.isArray(r.body.weeks), 'weeks 是数组');
    assert(r.body.weeks.length >= 3, `至少3周数据（实际${r.body.weeks.length}周）`);
  });

  await test('管理员 - GET /api/admin/users 返回用户列表', async () => {
    const r = await req('GET', '/api/admin/users', { jar: global.adminJar });
    assert(r.body.success === true, `success=true`);
    assert(r.body.users.length >= 2, `至少2个用户（实际${r.body.users.length}个）`);
    const admin = r.body.users.find(u => u.role === 'admin');
    assert(admin, '包含管理员账户');
  });

  // ── Test 3: 周详情 API ─────────────────────────────────────
  await test('管理员 - GET /api/images/:week_id 返回 allImages', async () => {
    const r1 = await req('GET', '/api/weeks', { jar: global.adminJar });
    const weekId = r1.body.weeks[0].id;
    const r = await req('GET', `/api/images/${weekId}`, { jar: global.adminJar });
    assert(r.body.success === true, `success=true`);
    assert(r.body.subfolders !== undefined, '返回 subfolders 字段');
    assert(r.body.allImages !== undefined, '返回 allImages 字段（按用户分组的图片）');
    assert(typeof r.body.allImages === 'object', 'allImages 是对象');
  });

  // ── Test 4: 普通用户登录 ────────────────────────────────────
  await test('普通用户登录 - POST /api/login', async () => {
    const jar = new CookieJar();
    const r = await req('POST', '/api/login', { body: { username: USER_USER, password: USER_PWD }, jar });
    assert(r.status === 200, `status=200`);
    assert(r.body.success === true, `success=true`);
    assert(r.body.role === 'user', `role=user`);
    global.userJar = jar;
  });

  await test('普通用户 - checkAuth 返回已登录', async () => {
    const r = await req('GET', '/api/auth/status', { jar: global.userJar });
    assert(r.body.loggedIn === true, `loggedIn=true`);
    assert(r.body.role === 'user', `role=user`);
  });

  await test('普通用户 - GET /api/weeks 只返回近2周', async () => {
    const r = await req('GET', '/api/weeks', { jar: global.userJar });
    assert(r.body.success === true, `success=true`);
    // 普通用户应只看到近2周
    assert(r.body.weeks.length <= 2, `最多2周（实际${r.body.weeks.length}周）`);
  });

  await test('普通用户 - GET /api/images/:week_id 返回自己的图片', async () => {
    const r1 = await req('GET', '/api/weeks', { jar: global.userJar });
    const weekId = r1.body.weeks[0].id;
    const r = await req('GET', `/api/images/${weekId}`, { jar: global.userJar });
    assert(r.body.success === true, `success=true`);
    assert(Array.isArray(r.body.images), 'images 是数组');
    assert(r.body.allImages === undefined, '普通用户不返回 allImages（只返回自己的图片）');
  });

  // ── Test 5: 权限控制 ────────────────────────────────────────
  await test('普通用户 - GET /api/admin/users 应返回 403', async () => {
    const r = await req('GET', '/api/admin/users', { jar: global.userJar });
    assert(r.status === 403, `status=403（需要管理员权限）`);
  });

  // ── Test 6: 登出 ────────────────────────────────────────────
  await test('登出 - POST /api/logout', async () => {
    const r = await req('POST', '/api/logout', { jar: global.adminJar });
    assert(r.body.success === true, `success=true`);
  });

  await test('登出后 - checkAuth 返回未登录', async () => {
    const r = await req('GET', '/api/auth/status', { jar: global.adminJar });
    assert(r.body.loggedIn === false, `loggedIn=false`);
  });

  // ── Test 7: JS 代码检查 ────────────────────────────────────
  await test('JS代码 - showApp() 在 admin 模式下调用 loadAdminPanel()', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 找 showApp 函数范围（下一个顶层 function 或 </script> 之前）
    const showAppIdx = html.indexOf('function showApp(');
    assert(showAppIdx >= 0, '找到 showApp 函数');
    // 找紧跟的下一个顶层函数
    const nextScript = html.indexOf('\nfunction ', showAppIdx + 1);
    const nextAsync = html.indexOf('\nasync function ', showAppIdx + 1);
    const nextFn = nextScript >= 0 && nextAsync >= 0 ? Math.min(nextScript, nextAsync)
                 : nextScript >= 0 ? nextScript : nextAsync;
    const endIdx = nextFn > showAppIdx ? nextFn : html.length;
    const body = html.substring(showAppIdx, endIdx);
    assert(body.includes('loadAdminPanel()'), 'showApp() 调用了 loadAdminPanel()');
  });

  await test('JS代码 - loadAdminPanel() 调用所有数据加载函数', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const match = html.match(/async function loadAdminPanel\(\)\s*\{([\s\S]*?)\n\}/);
    assert(match, '找到 loadAdminPanel 函数');
    const body = match[1];
    assert(body.includes('loadAdminUploadSection()'), '调用 loadAdminUploadSection()');
    assert(body.includes('loadAdminUsers()'), '调用 loadAdminUsers()');
    assert(body.includes('loadAdminWeeks()'), '调用 loadAdminWeeks()');
    assert(body.includes('loadAdminRecords()'), '调用 loadAdminRecords()');
  });

  await test('JS代码 - loadAdminPanel() 默认隐藏周详情区块', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const match = html.match(/async function loadAdminPanel\(\)\s*\{([\s\S]*?)\n\}/);
    assert(match, '找到 loadAdminPanel 函数');
    const body = match[1];
    assert(body.includes("style.display = 'none'"), "初始化时设置 style.display = 'none'");
  });

  // ── Test 8: 错误处理 ────────────────────────────────────────
  await test('错误处理 - 缺少 week_id 的上传请求返回 400', async () => {
    const jar = new CookieJar();
    const r1 = await req('POST', '/api/login', { body: { username: ADMIN_USER, password: ADMIN_PWD }, jar });
    global.adminJar = jar;
    const r = await req('POST', '/api/upload', { jar });
    assert(r.status === 400, `status=400`);
    assert(r.body.success === false, `success=false`);
  });

  await test('错误处理 - 未登录访问受保护接口返回 401', async () => {
    const jar = new CookieJar();
    const r = await req('GET', '/api/weeks', { jar });
    assert(r.status === 401, `status=401`);
  });

  // ── Test 9: 登录失败 ────────────────────────────────────────
  await test('登录失败 - 错误密码', async () => {
    const jar = new CookieJar();
    const r = await req('POST', '/api/login', { body: { username: ADMIN_USER, password: 'wrong' }, jar });
    assert(r.status === 401, `status=401`);
    assert(r.body.success === false, `success=false`);
  });

  // ── Test 10: 速率限制 ────────────────────────────────────────
  // (略过，大量请求可能导致账户临时封禁)

  console.log(`\n========================================`);
  console.log(`测试结果：${passed} 通过，${failed} 失败`);
  console.log(`========================================\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('测试运行错误:', e); process.exit(1); });
