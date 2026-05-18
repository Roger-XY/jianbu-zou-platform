#!/bin/bash
# ============================================
# 健步走上传平台 - 腾讯云部署脚本
# ============================================

set -e

# 配置
APP_NAME="jianbu Zou-uploader"
APP_DIR="/www/wwwroot/jianbu Zou-uploader"
PORT=3000
DOMAIN="43.157.31.73"

echo "============================================"
echo "  健步走上传平台 - 部署脚本"
echo "============================================"
echo ""

# 1. 安装 Node.js 18.x
echo "[1/6] 安装 Node.js 18..."
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs

# 验证
node -v
npm -v

# 2. 安装 PM2（进程管理器）
echo ""
echo "[2/6] 安装 PM2..."
npm install -g pm2

# 3. 创建应用目录
echo ""
echo "[3/6] 创建应用目录..."
mkdir -p $APP_DIR

# 4. 上传项目文件（这里需要手动操作，见下方说明）
echo ""
echo "[4/6] 项目文件上传..."
echo "请将 image-uploader 文件夹内容上传到: $APP_DIR"
echo "可以使用以下方式之一："
echo "  方式1: 本地执行 rsync"
echo "  方式2: 使用宝塔面板的文件管理器上传"
echo "  方式3: 使用 scp 命令"
echo ""

# 5. 安装依赖
echo "[5/6] 安装项目依赖..."
cd $APP_DIR
npm install

# 6. 配置开机自启
echo ""
echo "[6/6] 配置 PM2 开机自启..."
pm2 startup
pm2 save

# 启动服务
pm2 restart all || pm2 start server.js --name "$APP_NAME"

echo ""
echo "============================================"
echo "  部署完成！"
echo "============================================"
echo ""
echo "访问地址: http://$DOMAIN:$PORT"
echo ""
echo "常用命令:"
echo "  pm2 status          - 查看运行状态"
echo "  pm2 logs            - 查看日志"
echo "  pm2 restart all     - 重启服务"
echo "  pm2 stop all        - 停止服务"
echo ""
