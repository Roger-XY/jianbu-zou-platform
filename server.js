/**
 * 图片上传平台 - 主服务
 * 功能：多用户账号 + 按周文件夹 + 上传状态管理 + 邮件通知
 */

// 加载环境变量（必须在最顶部）
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// 初始化模块
// ============================================================
const { getDb, UserDB, WeekDB, RecordDB, getWeekInfo } = require('./db/database');
const { sendZipEmail, sendReminderEmail, testConnection } = require('./services/email');
const { getUserDir, getWeekDir, getUserFiles, packageWeekFolder, getWeekSubfolders } = require('./services/file');

// 确保目录存在
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
[UPLOAD_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// 初始化数据库（触发 seed）
getDb();

// ============================================================
// 中间件
// ============================================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: '登录尝试次数过多，请15分钟后重试' }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'image-uploader-v2-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ============================================================
// Multer 配置
// ============================================================
function createMulter(weekId, username) {
  const week = WeekDB.getById(weekId);
  if (!week) throw new Error('周文件夹不存在');

  const userDir = getUserDir(week.folder_name, username);

  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, userDir),
      filename: (req, file, cb) => {
        const timestamp = Date.now();
        const safeBaseName = file.originalname.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
        cb(null, `${timestamp}_${safeBaseName}`);
      }
    }),
    fileFilter: (req, file, cb) => {
      const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'];
      if (allowed.includes(file.mimetype)) cb(null, true);
      else cb(new Error('只允许图片文件'));
    },
    limits: { fileSize: 20 * 1024 * 1024, files: 20 }
  });
}

// ============================================================
// 鉴权中间件
// ============================================================
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: '请先登录', code: 'UNAUTHORIZED' });
  }
  const user = UserDB.findById(req.session.userId);
  if (!user) { req.session.destroy(); return res.status(401).json({ success: false, message: '用户不存在' }); }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: '需要管理员权限' });
    next();
  });
}

// ============================================================
// ========== 登录相关 API ==========
// ============================================================

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '请输入账号和密码' });
  }
  const user = UserDB.findByUsername(username);
  if (user && user.password === password) {
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    console.log(`[${now()}] 用户 "${user.display_name}(${user.role})" 登录成功`);
    res.json({ success: true, username: user.username, displayName: user.display_name, role: user.role });
  } else {
    console.log(`[${now()}] 登录失败: "${username}"`);
    res.status(401).json({ success: false, message: '账号或密码错误' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  if (req.session.userId) {
    const user = UserDB.findById(req.session.userId);
    if (user) {
      return res.json({ loggedIn: true, username: user.username, displayName: user.display_name, role: user.role });
    }
  }
  res.json({ loggedIn: false });
});

// ============================================================
// ========== 用户管理 API（仅管理员） ==========
// ============================================================

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = UserDB.getAll();
  res.json({ success: true, users });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, displayName, role } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ success: false, message: '缺少必填字段' });
  }
  const existing = UserDB.findByUsername(username);
  if (existing) return res.status(400).json({ success: false, message: '账号已存在' });
  const user = UserDB.create(username, password, displayName, role || 'user');
  console.log(`[${now()}] 管理员新建用户: ${username}`);
  res.json({ success: true, user });
});

// ============================================================
// ========== 周文件夹 API ==========
// ============================================================

// 获取所有周（带当前用户上传状态）
// 普通用户返回近2周（本周、上周），基于实时日期自动计算，管理员返回全部
app.get('/api/weeks', requireAuth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  // 管理员取全部，普通用户取最近2周（本周、上周）
  const weeks = isAdmin ? WeekDB.getAll() : WeekDB.getRecentWeeks(2);
  const result = weeks.map(week => {
    let myRecord = null;
    let allRecords = [];
    if (!isAdmin) {
      myRecord = RecordDB.getByWeekAndUser(week.id, req.user.id);
    } else {
      allRecords = RecordDB.getByWeek(week.id);
    }
    return {
      id: week.id,
      week_number: week.week_number,
      year: week.year,
      folder_name: week.folder_name,
      week_start: week.week_start,
      week_end: week.week_end,
      status: week.status,
      my_status: myRecord ? myRecord.status : null,
      my_completed_at: myRecord ? myRecord.completed_at : null,
      records: allRecords,
      pending_count: allRecords.filter(r => r.status === 'pending').length,
      completed_count: allRecords.filter(r => r.status === 'completed').length,
      is_limited: !isAdmin  // 标记是否被限制（前端展示"更多"引导）
    };
  });
  res.json({ success: true, weeks: result });
});

// 获取某个周详情
app.get('/api/weeks/:id', requireAuth, (req, res) => {
  const week = WeekDB.getById(req.params.id);
  if (!week) return res.status(404).json({ success: false, message: '周不存在' });
  const records = RecordDB.getByWeek(week.id);
  const subfolders = req.user.role === 'admin' ? getWeekSubfolders(week.folder_name) : [];
  res.json({ success: true, week, records, subfolders });
});

// ============================================================
// ========== 图片上传 API ==========
// ============================================================

app.post('/api/upload', requireAuth, (req, res, next) => {
  // week_id 优先从 query string 读取（?week_id=xxx），兼容 form body
  // 注意：multipart 请求中 req.body 在 multer 解析前为空，
  // 因此前端应将 week_id 放在 URL query 参数而非 form body 中。
  const week_id = req.query.week_id;

  console.log(`[${now()}] 上传请求 - week_id: ${week_id}, user: ${req.user.username}`);

  if (!week_id) {
    return res.status(400).json({ success: false, message: '缺少 week_id 参数（请通过 URL query 传递：?week_id=xxx）' });
  }

  const week = WeekDB.getById(week_id);
  if (!week) return res.status(404).json({ success: false, message: '周文件夹不存在' });
  if (week.status === 'completed') return res.status(400).json({ success: false, message: '该周已上传完毕，无法继续上传' });

  try {
    // 单次 multer 调用，用磁盘存储写文件
    const uploader = createMulter(week_id, req.user.username);
    uploader.array('images', 20)(req, res, err => {
      if (err) {
        if (err.message && err.message.includes('只允许')) {
          return res.status(400).json({ success: false, message: err.message });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: '单文件超过20MB限制' });
        }
        return res.status(400).json({ success: false, message: err.message });
      }
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: '未收到图片文件' });
      }
      const results = req.files.map(f => ({
        filename: f.filename,
        originalName: f.originalname,
        url: `/uploads/${week.folder_name}/${req.user.username}/${f.filename}`,
        size: f.size
      }));
      console.log(`[${now()}] 用户 "${req.user.display_name}" 上传 ${req.files.length} 张图片到 ${week.folder_name}`);
      res.json({ success: true, message: `成功上传 ${req.files.length} 张图片`, files: results });
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取用户在某周已上传的图片列表
app.get('/api/images/:week_id', requireAuth, (req, res) => {
  const week = WeekDB.getById(req.params.week_id);
  if (!week) return res.status(404).json({ success: false, message: '周不存在' });

  if (req.user.role === 'admin') {
    // 管理员：返回所有用户的图片 + 确认记录
    const subfolders = getWeekSubfolders(week.folder_name);
    // 补充 display_name
    subfolders.forEach(sf => {
      const u = UserDB.findByUsername(sf.username);
      if (u) sf.display_name = u.display_name;
    });
    const allImages = {};
    subfolders.forEach(sf => {
      allImages[sf.username] = getUserFiles(week.folder_name, sf.username);
    });
    const records = RecordDB.getByWeek(week.id);
    return res.json({ success: true, subfolders, allImages, records });
  } else {
    // 普通用户：只返回自己的
    const files = getUserFiles(week.folder_name, req.user.username);
    return res.json({ success: true, images: files, count: files.length });
  }
});

// 删除某张图片
app.delete('/api/images/:week_id/:filename', requireAuth, (req, res) => {
  const week = WeekDB.getById(req.params.week_id);
  if (!week) return res.status(404).json({ success: false, message: '周不存在' });

  // 管理员可删任何，普通用户只能删自己的
  let targetUsername = req.user.username;
  if (req.user.role === 'admin' && req.query.username) {
    targetUsername = req.query.username;
  }

  const safeFile = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, week.folder_name, targetUsername, safeFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: '文件不存在' });
  fs.unlinkSync(filePath);
  console.log(`[${now()}] "${req.user.display_name}" 删除了 ${week.folder_name}/${targetUsername}/${safeFile}`);
  res.json({ success: true });
});

// ============================================================
// ========== 完成上传确认 API ==========
// ============================================================

app.post('/api/weeks/:id/complete', requireAuth, (req, res) => {
  const week = WeekDB.getById(req.params.id);
  if (!week) return res.status(404).json({ success: false, message: '周不存在' });
  if (week.status === 'completed') return res.status(400).json({ success: false, message: '该周已标记完成' });

  // 标记当前用户完成
  RecordDB.markComplete(week.id, req.user.id);

  // 检查是否所有人都完成了
  const pending = RecordDB.getPendingByWeek(week.id);
  const regularUsers = UserDB.getAllRegular();

  if (pending.length === 0 && regularUsers.length > 0) {
    // 所有人都完成了 → 打包 + 发邮件
    const zipName = `健步走活动-第${week.week_number}周`;
    packageWeekFolder(week.folder_name, zipName).then(zipPath => {
      WeekDB.updateStatus(week.id, 'completed', zipPath);
      sendZipEmail(zipPath, week.folder_name).then(() => {
        console.log(`[${now()}] ✅ ${week.folder_name} 已完成打包并发送邮件`);
      });
    });
    res.json({ success: true, all_completed: true, message: '所有用户已完成，系统正在打包并发送邮件...' });
  } else {
    res.json({
      success: true,
      all_completed: false,
      pending_count: pending.length,
      pending_users: pending.map(r => r.display_name),
      message: `已确认完成，${pending.length} 位用户仍在等待上传`
    });
  }
});

// 管理员手动打包
app.post('/api/weeks/:id/package', requireAdmin, async (req, res) => {
  const week = WeekDB.getById(req.params.id);
  if (!week) return res.status(404).json({ success: false, message: '周不存在' });

  const zipName = `健步走活动-第${week.week_number}周`;
  try {
    const zipPath = await packageWeekFolder(week.folder_name, zipName);
    WeekDB.updateStatus(week.id, 'completed', zipPath);
    await sendZipEmail(zipPath, week.folder_name);
    res.json({ success: true, message: '打包完成，邮件已发送' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 管理员手动重置周状态
app.post('/api/weeks/:id/reset', requireAdmin, (req, res) => {
  const week = WeekDB.getById(req.params.id);
  if (!week) return res.status(404).json({ success: false, message: '周不存在' });
  WeekDB.updateStatus(week.id, 'pending', null);
  // 重置所有记录
  getDb().prepare("UPDATE upload_records SET status='pending', completed_at=NULL WHERE week_id=?").run(week.id);
  console.log(`[${now()}] 管理员重置了 ${week.folder_name} 的状态`);
  res.json({ success: true, message: '已重置为待上传状态' });
});

// ============================================================
// ========== 定时任务 ==========
// ============================================================

// 每分钟检查一次（主要是周一早上9点的催办）
let lastReminderDate = null;

cron.schedule('0 9 * * 1', async () => {
  // 每周一 9:00 执行
  const today = new Date().toISOString().slice(0, 10);
  if (lastReminderDate === today) return; // 避免重复发送
  lastReminderDate = today;

  console.log(`[${now()}] ⏰ 周一检查：开始检查上周上传状态...`);

  // 上周（weekOffset = -1）
  const { year, weekNum, start, end } = getWeekInfo(new Date(), -1);
  const week = getDb().prepare('SELECT * FROM weeks WHERE year=? AND week_number=?').get(year, weekNum);

  if (!week || week.status === 'completed') {
    console.log(`[${now()}] 上周已完成或无记录`);
    return;
  }

  const pending = RecordDB.getPendingByWeek(week.id);
  if (pending.length > 0) {
    await sendReminderEmail(week.folder_name, pending);
    console.log(`[${now()}] ✅ 已发送催办邮件，${pending.length} 人待处理`);
  }
});

// 服务启动时也检查一次（防止服务重启后错过周一9点）
async function startupCheck() {
  console.log(`[${now()}] 启动检查...`);
  const connected = await testConnection();
  if (!connected) {
    console.log('[邮件] ⚠️ 提示：请复制 .env.example 为 .env，填写 QQ 邮箱授权码以启用邮件功能');
    console.log('[邮件]   授权码获取：QQ邮箱网页版 → 设置 → 账户 → POP3/SMTP服务 → 生成授权码');
  }
}

// ============================================================
// ========== 错误处理 ==========
// ============================================================
app.use((err, req, res, next) => {
  console.error(`[${now()}] 服务器错误:`, err.message);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// ============================================================
// ========== 启动 ==========
// ============================================================
function now() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║      健步走上传平台 v2.1 - 多用户按周管理版         ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`  本地访问:  http://localhost:${PORT}`);
  console.log(`  上传目录:  ${UPLOAD_DIR}`);
  console.log('');
  console.log('  用户账号（密码同用户名）:');
  UserDB.getAll().forEach(u => {
    console.log(`    - ${u.display_name} / ${u.username} / ${u.role}`);
  });
  console.log('');
  console.log('  功能说明:');
  console.log('    1. 普通用户：仅显示近3周，上周优先展示');
  console.log('    2. 上传图片 → 点击"确认完成" → 等待所有人完成');
  console.log('    3. 所有人完成 → 自动打包zip → 自动发送邮件');
  console.log('    4. 周一9点未完成 → 自动发送催办邮件');
  console.log('    5. 管理员可查看全部周、手动打包、重置状态');
  console.log('');
  console.log('  环境变量:');
  console.log('    首次使用请复制 .env.example 为 .env 并填写邮箱授权码');
  console.log('');
  await startupCheck();
  console.log('');
});
