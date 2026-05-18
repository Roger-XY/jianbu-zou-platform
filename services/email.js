/**
 * 邮件服务
 * 凭据从环境变量读取（.env 文件由 dotenv 加载）
 * 绝对不能在代码中硬编码任何邮箱地址或授权码
 */

const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

/**
 * 从环境变量获取邮箱配置
 * 若未配置则返回 null，并记录警告
 */
function getEmailConfig() {
  const user = process.env.EMAIL_USER;
  const authCode = process.env.EMAIL_AUTH_CODE;
  const to = process.env.EMAIL_TO || user;

  if (!user || !authCode) {
    return null;
  }

  return {
    host: 'smtp.qq.com',
    port: 587,
    secure: false,
    auth: {
      user,
      pass: authCode
    },
    from: `"图片上传平台" <${user}>`,
    to
  };
}

// 创建 transporter（延迟初始化）
let transporter = null;
let configError = false;

function getTransporter() {
  if (transporter) return transporter;

  const cfg = getEmailConfig();
  if (!cfg) {
    configError = true;
    return null;
  }

  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.auth.user,
      pass: cfg.auth.pass
    }
  });

  return transporter;
}

/**
 * 发送打包 zip 文件邮件
 * @param {string} zipPath - zip 文件绝对路径
 * @param {string} weekName - 周文件夹名称
 */
async function sendZipEmail(zipPath, weekName) {
  const cfg = getEmailConfig();
  if (!cfg) {
    console.log('[邮件] ⚠️ 邮箱未配置（请检查 .env 文件中的 EMAIL_USER 和 EMAIL_AUTH_CODE）');
    return;
  }

  if (!fs.existsSync(zipPath)) {
    console.log(`[邮件] zip 文件不存在: ${zipPath}`);
    return;
  }

  try {
    const t = getTransporter();
    await t.sendMail({
      from: cfg.from,
      to: cfg.to,
      subject: `✅ ${weekName} 上传完成 - 健步走活动`,
      text: `
您好，

${weekName} 所有用户的图片已上传完毕，附件为打包好的 ZIP 文件。

请查收附件。

---
图片上传平台自动发送
${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
      `.trim(),
      attachments: [
        {
          filename: path.basename(zipPath),
          path: zipPath
        }
      ]
    });
    console.log(`[邮件] ✅ 打包 zip 已发送到 ${cfg.to}`);
  } catch (err) {
    console.error(`[邮件] ❌ 发送失败:`, err.message);
  }
}

/**
 * 发送催办邮件（还有用户未完成上传）
 * @param {string} weekName - 周文件夹名称
 * @param {Array} pendingUsers - 待上传用户列表 [{display_name, username}]
 */
async function sendReminderEmail(weekName, pendingUsers) {
  const cfg = getEmailConfig();
  if (!cfg) {
    console.log('[邮件] ⚠️ 邮箱未配置，无法发送催办邮件');
    return;
  }

  if (!pendingUsers || pendingUsers.length === 0) return;

  const userList = pendingUsers.map(u => `  - ${u.display_name}（@${u.username}）`).join('\n');

  try {
    const t = getTransporter();
    await t.sendMail({
      from: cfg.from,
      to: cfg.to,
      subject: `⚠️ 提醒：${weekName} 以下用户尚未完成上传`,
      text: `
您好，

提醒：${weekName} 尚有 ${pendingUsers.length} 位用户未完成上传，请尽快处理。

未完成用户：
${userList}

请相关人员尽快完成上传。

---
图片上传平台自动发送
${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
      `.trim()
    });
    console.log(`[邮件] ✅ 催办邮件已发送到 ${cfg.to}，${pendingUsers.length} 人待处理`);
  } catch (err) {
    console.error(`[邮件] ❌ 催办邮件发送失败:`, err.message);
  }
}

// 测试连接
async function testConnection() {
  const cfg = getEmailConfig();
  if (!cfg) {
    console.log('[邮件] ⚠️ 邮箱未配置（请检查 .env 文件中的 EMAIL_USER 和 EMAIL_AUTH_CODE）');
    console.log('[邮件]   获取授权码：QQ邮箱网页版 → 设置 → 账户 → POP3/SMTP服务 → 生成授权码');
    return false;
  }

  try {
    const t = getTransporter();
    await t.verify();
    console.log('[邮件] ✅ SMTP 连接正常');
    return true;
  } catch (err) {
    console.log(`[邮件] ⚠️ SMTP 连接失败: ${err.message}`);
    console.log('[邮件]   请确认 EMAIL_AUTH_CODE 为授权码而非 QQ 密码');
    return false;
  }
}

module.exports = { sendZipEmail, sendReminderEmail, testConnection };
