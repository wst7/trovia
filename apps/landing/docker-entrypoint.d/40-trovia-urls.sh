#!/bin/sh
# Replace the absolute-address placeholders in the landing page at startup.
#
# Why not at build time: on hosting platforms (Northflank and the like) the domain is generated only once the deploy finishes, so
# hardcoding it at build time would point at localhost. Set XUNJI_RUNTIME_URLS=1 at build time to keep the placeholders,
# and they are filled in here from the runtime environment variables.
#
# Variable sources:
#   XUNJI_APP_URL  —— app address, supplied by the deploy config (required)
#   XUNJI_SITE_URL —— address of this page, used for the absolute og:image URL; when unset, take the first NF_HOSTS entry
set -e

HTML_DIR="${XUNJI_HTML_DIR:-/usr/share/nginx/html}"
HTML="$HTML_DIR/index.html"

if [ ! -f "$HTML" ]; then
  echo "trovia: $HTML 不存在，跳过地址替换" >&2
  exit 0
fi

# Northflank injects NF_HOSTS (comma-separated); the first entry is this service's own public domain
if [ -z "${XUNJI_SITE_URL:-}" ] && [ -n "${NF_HOSTS:-}" ]; then
  XUNJI_SITE_URL="https://$(printf '%s' "$NF_HOSTS" | cut -d',' -f1)"
fi

: "${XUNJI_APP_URL:=http://localhost:3000}"
: "${XUNJI_SITE_URL:=http://localhost:3001}"

# Strip the trailing slashes so we do not build //register
APP_URL=$(printf '%s' "$XUNJI_APP_URL" | sed 's|/*$||')
SITE_URL=$(printf '%s' "$XUNJI_SITE_URL" | sed 's|/*$||')

# Use | as the delimiter because URLs may contain /; escape the special characters in the sed replacement string
escape() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }

sed -i \
  -e "s|__APP_URL__|$(escape "$APP_URL")|g" \
  -e "s|__SITE_URL__|$(escape "$SITE_URL")|g" \
  "$HTML"

echo "trovia: app=$APP_URL site=$SITE_URL"
