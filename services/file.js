/**
 * 文件操作服务
 * 负责打包 zip、目录操作等
 */

const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

/**
 * 获取某个周文件夹的完整路径
 * @param {string} weekFolderName - 周文件夹名，如 "第20周20260511-20260517"
 * @param {string} username - 用户名（子文件夹）
 */
function getUserDir(weekFolderName, username) {
  const dir = path.join(UPLOAD_DIR, weekFolderName, username);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 获取周文件夹的根目录
 */
function getWeekDir(weekFolderName) {
  const dir = path.join(UPLOAD_DIR, weekFolderName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 获取用户在某个周的文件列表
 */
function getUserFiles(weekFolderName, username) {
  const dir = getUserDir(weekFolderName, username);
  return fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(f))
    .map(filename => {
      const fp = path.join(dir, filename);
      const stat = fs.statSync(fp);
      return {
        filename,
        url: `/uploads/${weekFolderName}/${username}/${filename}`,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString()
      };
    });
}

/**
 * 打包整个周文件夹为 zip
 * @param {string} weekFolderName - 周文件夹名
 * @param {string} zipName - zip 文件名（不含路径和扩展名）
 * @returns {Promise<string>} zip 文件的绝对路径
 */
function packageWeekFolder(weekFolderName, zipName) {
  return new Promise((resolve, reject) => {
    const weekDir = getWeekDir(weekFolderName);
    const zipFileName = `${zipName}.zip`;
    const zipPath = path.join(UPLOAD_DIR, zipFileName);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`[打包] ✅ 已生成: ${zipFileName} (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB)`);
      resolve(zipPath);
    });

    archive.on('error', err => reject(err));

    archive.pipe(output);
    archive.directory(weekDir, weekFolderName);
    archive.finalize();
  });
}

/**
 * 获取周文件夹下所有用户目录信息
 */
function getWeekSubfolders(weekFolderName) {
  const weekDir = getWeekDir(weekFolderName);
  const entries = fs.readdirSync(weekDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => {
      const subDir = path.join(weekDir, e.name);
      const files = fs.readdirSync(subDir).filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(f));
      let totalSize = 0;
      files.forEach(f => { totalSize += fs.statSync(path.join(subDir, f)).size; });
      return {
        username: e.name,
        imageCount: files.length,
        totalSize
      };
    });
}

module.exports = { getUserDir, getWeekDir, getUserFiles, packageWeekFolder, getWeekSubfolders };
