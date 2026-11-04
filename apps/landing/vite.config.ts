import { defineConfig } from 'vite'

/**
 * 静态说明页，不依赖前端框架。
 * __APP_URL__ 在构建时替换为应用地址：默认开发环境 5173，
 * Docker 构建时通过 XUNJI_APP_URL 传入（见 docker-compose.yml）。
 * __SITE_URL__ 同理，用于 og:image 等必须绝对地址的元信息。
 */
const appUrl = (process.env.XUNJI_APP_URL || 'http://localhost:5173').replace(/\/$/, '')
const siteUrl = (process.env.XUNJI_SITE_URL || 'http://localhost:5174').replace(/\/$/, '')

/**
 * 托管平台（Northflank 等）的域名要等部署完成才生成，构建期写死会指向 localhost。
 * 置 XUNJI_RUNTIME_URLS=1 时保留占位符，由容器启动脚本按环境变量替换。
 */
const runtimeUrls = process.env.XUNJI_RUNTIME_URLS === '1'

export default defineConfig({
  // 相对基址：GitHub Pages 的项目站点挂在 /<repo>/ 下，写死 '/' 会让样式和截图 404。
  base: './',
  server: { port: 5174 },
  preview: { port: 5174 },
  plugins: [
    {
      name: 'trovia-url-tokens',
      transformIndexHtml(html) {
        // 运行时模式下原样保留 __APP_URL__ / __SITE_URL__，
        // 交给容器启动脚本替换（见 apps/landing/docker-entrypoint.d/40-trovia-urls.sh）。
        if (runtimeUrls) return html
        return html.split('__APP_URL__').join(appUrl).split('__SITE_URL__').join(siteUrl)
      },
    },
  ],
})
