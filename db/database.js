/**
 * 数据库模块
 * 表：users（用户）、weeks（周文件夹）、upload_records（上传记录）
 */

const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'data', 'uploader.db');

// 确保 data 目录存在
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
    seedData();
  }
  return db;
}

function initTables() {
  const d = getDb();

  // 用户表
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    )
  `);

  // 周文件夹表
  d.exec(`
    CREATE TABLE IF NOT EXISTS weeks (
      id TEXT PRIMARY KEY,
      week_number INTEGER NOT NULL,
      year INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      zip_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // 上传记录表
  d.exec(`
    CREATE TABLE IF NOT EXISTS upload_records (
      id TEXT PRIMARY KEY,
      week_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (week_id) REFERENCES weeks(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 创建唯一索引
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_records_week_user
    ON upload_records(week_id, user_id)
  `);
}

function seedData() {
  const d = getDb();
  const userCount = d.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt > 0) return;

  const now = new Date().toISOString();
  const users = [
    { id: uuidv4(), username: 'admin', password: 'admin123', display_name: '管理员', role: 'admin' },
    { id: uuidv4(), username: 'uploader', password: 'upload@2024', display_name: '上传用户', role: 'user' },
    { id: uuidv4(), username: 'zhangsan', password: 'zhang123', display_name: '张三', role: 'user' },
    { id: uuidv4(), username: 'lisi', password: 'lisi123', display_name: '李四', role: 'user' },
    { id: uuidv4(), username: 'wangwu', password: 'wang123', display_name: '王五', role: 'user' },
  ];

  const insertUser = d.prepare(
    'INSERT INTO users (id, username, password, display_name, role, created_at) VALUES (?,?,?,?,?,?)'
  );
  users.forEach(u => insertUser.run(u.id, u.username, u.password, u.display_name, u.role, now));

  // 自动创建最近4周 + 未来1周（仅第5周及之后）
  const weeks = [];
  const today = new Date();
  for (let i = -3; i <= 1; i++) {
    const weekInfo = getWeekInfo(today, i);
    // 只创建第5周及之后的周
    if (!weekInfo.valid) continue;
    weeks.push({
      id: uuidv4(),
      year: weekInfo.year,
      week_number: weekInfo.weekNum,
      week_start: weekInfo.start,
      week_end: weekInfo.end,
      folder_name: `第${weekInfo.weekNum}周${formatDate(weekInfo.start)}-${formatDate(weekInfo.end)}`,
      status: 'pending'
    });
  }

  const insertWeek = d.prepare(
    'INSERT INTO weeks (id, year, week_number, week_start, week_end, folder_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  const allUsers = d.prepare('SELECT id FROM users').all();
  const insertRecord = d.prepare(
    'INSERT INTO upload_records (id, week_id, user_id, status, created_at) VALUES (?,?,?,?,?)'
  );

  weeks.forEach(w => {
    insertWeek.run(w.id, w.year, w.week_number, w.week_start, w.week_end, w.folder_name, w.status, now, now);
    allUsers.forEach(u => {
      insertRecord.run(uuidv4(), w.id, u.id, 'pending', now);
    });
  });
}

// ============================================================
// 工具函数：周计算
// ============================================================
// 周命名规则：2026.5.4-2026.5.10 为第5周，按序递增
const WEEK5_START = new Date('2026-05-04');  // 第5周开始日期（周一）

// weekOffset: 0=当前周, -1=上周, 1=下周
function getWeekInfo(date, weekOffset = 0) {
  const d = new Date(date);
  // 调整到本周一
  const day = d.getDay(); // 0=周日
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMon + weekOffset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  // 计算周数：相对于第5周(2026-05-04)计算
  const msPerDay = 86400000;
  const daysDiff = Math.floor((monday - WEEK5_START) / msPerDay);
  const weekNum = Math.floor(daysDiff / 7) + 5;  // 第5周 + 偏移周数

  // 如果周一开始日期早于第5周，则返回无效
  if (weekNum < 5) {
    return {
      year: monday.getFullYear(),
      weekNum: -1,  // 无效周
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10),
      startRaw: monday,
      endRaw: sunday,
      valid: false
    };
  }

  return {
    year: monday.getFullYear(),
    weekNum: weekNum,
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
    startRaw: monday,
    endRaw: sunday,
    valid: true
  };
}

function formatDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

function toDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}

// ============================================================
// 用户 CRUD
// ============================================================
const UserDB = {
  findByUsername(username) {
    return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  findById(id) {
    return getDb().prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?').get(id);
  },
  getAll() {
    return getDb().prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at').all();
  },
  getAllRegular() {
    return getDb().prepare("SELECT id, username, display_name, role FROM users WHERE role != 'admin'").all();
  },
  create(username, password, displayName, role = 'user') {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb().prepare(
      'INSERT INTO users (id, username, password, display_name, role, created_at) VALUES (?,?,?,?,?,?)'
    ).run(id, username, password, displayName, role, now);
    return { id, username, display_name: displayName, role };
  }
};

// ============================================================
// 周文件夹 CRUD
// ============================================================
const WeekDB = {
  getAll() {
    return getDb().prepare(
      'SELECT * FROM weeks ORDER BY year DESC, week_number DESC'
    ).all();
  },
  // 获取近 N 周（用于普通用户，-2=上上周, -1=上周, 0=本周）
  getRecentWeeks(limit = 3) {
    return getDb().prepare(
      'SELECT * FROM weeks ORDER BY year DESC, week_number DESC LIMIT ?'
    ).all(limit);
  },
  getById(id) {
    return getDb().prepare('SELECT * FROM weeks WHERE id = ?').get(id);
  },
  getCurrent() {
    const { year, weekNum, start, end } = getWeekInfo(new Date(), -1); // 默认上周
    const existing = getDb().prepare(
      'SELECT * FROM weeks WHERE year = ? AND week_number = ?'
    ).get(year, weekNum);
    return existing || null;
  },
  getOrCreate(dateStr) {
    const info = getWeekInfo(new Date(dateStr), 0);
    const existing = getDb().prepare(
      'SELECT * FROM weeks WHERE year = ? AND week_number = ?'
    ).get(info.year, info.weekNum);
    if (existing) return existing;

    const id = uuidv4();
    const now = new Date().toISOString();
    getDb().prepare(
      'INSERT INTO weeks (id, year, week_number, week_start, week_end, folder_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(id, info.year, info.weekNum, info.start, info.end,
      `第${info.weekNum}周${formatDate(info.start)}-${formatDate(info.end)}`,
      'pending', now, now
    );

    // 为所有普通用户创建上传记录
    const allUsers = UserDB.getAll();
    const insertRecord = getDb().prepare(
      'INSERT INTO upload_records (id, week_id, user_id, status, created_at) VALUES (?,?,?,?,?)'
    );
    allUsers.forEach(u => insertRecord.run(uuidv4(), id, u.id, 'pending', now));

    return WeekDB.getById(id);
  },
  updateStatus(id, status, zipPath = null) {
    const now = new Date().toISOString();
    if (zipPath) {
      getDb().prepare('UPDATE weeks SET status=?, zip_path=?, updated_at=? WHERE id=?').run(status, zipPath, now, id);
    } else {
      getDb().prepare('UPDATE weeks SET status=?, updated_at=? WHERE id=?').run(status, now, id);
    }
    return WeekDB.getById(id);
  }
};

// ============================================================
// 上传记录 CRUD
// ============================================================
const RecordDB = {
  getByWeekAndUser(weekId, userId) {
    return getDb().prepare(
      'SELECT * FROM upload_records WHERE week_id=? AND user_id=?'
    ).get(weekId, userId);
  },
  getByWeek(weekId) {
    return getDb().prepare(`
      SELECT r.*, u.display_name, u.username, u.role
      FROM upload_records r
      JOIN users u ON r.user_id = u.id
      WHERE r.week_id = ?
      ORDER BY u.created_at
    `).all(weekId);
  },
  getPendingByWeek(weekId) {
    return getDb().prepare(`
      SELECT r.*, u.display_name, u.username
      FROM upload_records r
      JOIN users u ON r.user_id = u.id
      WHERE r.week_id = ? AND r.status = 'pending'
    `).all(weekId);
  },
  markComplete(weekId, userId) {
    const now = new Date().toISOString();
    getDb().prepare(
      'UPDATE upload_records SET status=?, completed_at=? WHERE week_id=? AND user_id=?'
    ).run('completed', now, weekId, userId);
  },
  getImageCount(weekId, userId) {
    const week = WeekDB.getById(weekId);
    if (!week) return 0;
    const user = UserDB.findById(userId);
    if (!user) return 0;
    const dir = path.join(__dirname, '..', 'uploads', week.folder_name, user.username);
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(f)).length;
  },
  getTotalImageCount(weekId) {
    const week = WeekDB.getById(weekId);
    if (!week) return 0;
    const weekDir = path.join(__dirname, '..', 'uploads', week.folder_name);
    if (!fs.existsSync(weekDir)) return 0;
    let total = 0;
    fs.readdirSync(weekDir).forEach(sub => {
      const subDir = path.join(weekDir, sub);
      if (!fs.statSync(subDir).isDirectory()) return;
      total += fs.readdirSync(subDir).filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(f)).length;
    });
    return total;
  }
};

module.exports = {
  getDb,
  getWeekInfo,
  formatDate,
  toDisplayDate,
  UserDB,
  WeekDB,
  RecordDB
};
