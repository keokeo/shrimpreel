// PVUV 服务端爬虫上报：搜索引擎和 AI 爬虫不执行浏览器统计脚本，由 Worker 在后台异步补报。
// 只在 APP_ENV=production 且同时配置了 site.analytics.pvuvSiteId 与 PVUV_INGEST_TOKEN 时启用；
// 仅统计公开页面的 GET 请求（200 与 404），超时或报错全部静默忽略，不影响页面响应。
import { site } from '../config/site'
import { SHARE_PAGE } from './shares'

export const DEFAULT_PVUV_API_ORIGIN = 'https://api.pvuv.ai'

// 与 PVUV 服务端识别名单对齐的搜索与 AI 爬虫标识
const PVUV_CRAWLER =
  /chatgpt-user|oai-searchbot|gptbot|perplexity-user|perplexitybot|claude-user|claude-searchbot|claudebot|bingbot|googlebot|applebot|duckduckbot|duckassistbot|yandexbot|meta-externalagent|bytespider/i

// 私有、后台、登录、收银台和公开分享页都不计入公开内容爬虫抓取
const PRIVATE_OR_NON_PUBLIC_PAGE =
  /^\/admin(?:\/|$)|^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:dashboard|checkout|sign-in|phone-upload)(?:\/|$)/i

export function isPvuvCrawler(ua: string | null | undefined): boolean {
  return Boolean(ua && PVUV_CRAWLER.test(ua))
}

export function isReportablePvuvPage(pathname: string): boolean {
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/media/') ||
    pathname.startsWith('/s/') ||
    pathname.startsWith('/demo/') ||
    pathname.startsWith('/i/') ||
    pathname.startsWith('/__prerender/')
  ) {
    return false
  }
  if (PRIVATE_OR_NON_PUBLIC_PAGE.test(pathname) || SHARE_PAGE.test(pathname)) return false
  return true
}

export interface PvuvReportOptions {
  siteId?: string
  apiOrigin?: string
  now?: number
  timeoutMs?: number
}

export function reportPvuvCrawlerHit(
  request: Request,
  env: Env,
  url: URL,
  status: number,
  options?: PvuvReportOptions,
): Promise<void> | null {
  if (env.APP_ENV !== 'production') return null
  if (request.method !== 'GET' || (status !== 200 && status !== 404)) return null
  const siteId = (options?.siteId ?? site.analytics.pvuvSiteId).trim()
  const token = env.PVUV_INGEST_TOKEN?.trim()
  if (!siteId || !token) return null
  if (!isReportablePvuvPage(url.pathname)) return null
  const ua = request.headers.get('user-agent')
  if (!ua || !isPvuvCrawler(ua)) return null

  const apiOrigin = (options?.apiOrigin ?? DEFAULT_PVUV_API_ORIGIN).replace(/\/+$/, '')
  const ip = request.headers.get('cf-connecting-ip')?.trim() || undefined
  const country = (request as Request & { cf?: { country?: string } }).cf?.country || undefined
  const hit = {
    ua,
    path: url.pathname,
    ip,
    status,
    country,
    ts: options?.now ?? Date.now(),
  }

  return fetch(`${apiOrigin}/v1/sites/${encodeURIComponent(siteId)}/crawler_hits`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ hits: [hit] }),
    signal: AbortSignal.timeout(options?.timeoutMs ?? 3000),
  })
    .then(() => undefined)
    .catch(() => undefined)
}
