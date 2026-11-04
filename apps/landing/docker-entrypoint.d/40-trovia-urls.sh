#!/bin/sh
# 启动时替换说明页里的绝对地址占位符。
#
# 为什么不在构建时替换：托管平台（Northflank 等）的域名要等部署完成才生成，
# 构建期写死会指向 localhost。构建时设置 XUNJI_RUNTIME_URLS=1 保留占位符，
# 这里按运行环境变量填入。
#
# 变量来源：
#   XUNJI_APP_URL  —— 应用地址，由部署配置传入（必填）
#   XUNJI_SITE_URL —— 本页地址，用于 og:image 绝对 URL；未传则取 NF_HOSTS 第一项
set -e

HTML_DIR="${XUNJI_HTML_DIR:-/usr/share/nginx/html}"
HTML="$HTML_DIR/index.html"

if [ ! -f "$HTML" ]; then
  echo "trovia: $HTML 不存在，跳过地址替换" >&2
  exit 0
fi

# Northflank 注入 NF_HOSTS（逗号分隔），第一项即本服务自己的公开域名
if [ -z "${XUNJI_SITE_URL:-}" ] && [ -n "${NF_HOSTS:-}" ]; then
  XUNJI_SITE_URL="https://$(printf '%s' "$NF_HOSTS" | cut -d',' -f1)"
fi

: "${XUNJI_APP_URL:=http://localhost:3000}"
: "${XUNJI_SITE_URL:=http://localhost:3001}"

# 去掉结尾斜杠，避免拼出 //register
APP_URL=$(printf '%s' "$XUNJI_APP_URL" | sed 's|/*$||')
SITE_URL=$(printf '%s' "$XUNJI_SITE_URL" | sed 's|/*$||')

# 用 | 作分隔符，URL 里可能含 /；转义 sed 替换串中的特殊字符
escape() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }

sed -i \
  -e "s|__APP_URL__|$(escape "$APP_URL")|g" \
  -e "s|__SITE_URL__|$(escape "$SITE_URL")|g" \
  "$HTML"

echo "trovia: app=$APP_URL site=$SITE_URL"
