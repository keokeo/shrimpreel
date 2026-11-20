import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPvuvCrawler, isReportablePvuvPage, reportPvuvCrawlerHit } from '#/server/pvuv'

const PROD_ENV = { APP_ENV: 'production', PVUV_INGEST_TOKEN: 'pvuv_ingest_secret' } as unknown as Env

function crawlerRequest(path = '/pricing', ua = 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', method = 'GET') {
  const req = new Request(`https://moonhop.ai${path}`, {
    method,
    headers: {
      'User-Agent': ua,
      'CF-Connecting-IP': '203.0.113.42',
    },
  })
  Object.assign(req, { cf: { country: 'US' } })
  return req
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isPvuvCrawler & isReportablePvuvPage', () => {
  it('识别主流搜索引擎与 AI 爬虫 UA，普通浏览器不命中', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0',
      'OAI-SearchBot/1.0',
      'GPTBot/1.2',
      'PerplexityBot/1.0',
      'Perplexity-User/1.0',
      'ClaudeBot/1.0',
      'Claude-SearchBot/1.0',
      'Claude-User/1.0',
      'Applebot/0.1',
      'DuckDuckBot/1.1',
      'DuckAssistBot/1.0',
      'Mozilla/5.0 (compatible; YandexBot/3.0)',
      'meta-externalagent/1.1',
      'Bytespider',
    ]) {
      expect(isPvuvCrawler(ua), ua).toBe(true)
    }
    for (const ua of [null, undefined, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', 'curl/8.7.1']) {
      expect(isPvuvCrawler(ua), String(ua)).toBe(false)
    }
  })

  it('只允许公开内容页面上报，排除后台、登录、个人中心、收银台、分享页与静态/接口前缀', () => {
    for (const path of ['/', '/zh', '/pricing', '/zh/guides', '/how-to-make-neon-shuffle-ai-video', '/administrator-guide']) {
      expect(isReportablePvuvPage(path), path).toBe(true)
    }
    for (const path of [
      '/admin',
      '/admin/orders',
      '/sign-in',
      '/zh/sign-in',
      '/dashboard',
      '/zh/dashboard/orders/ord_1',
      '/checkout/success',
      '/phone-upload',
      '/v/abcd1234efgh5678',
      '/zh/v/abcd1234efgh5678',
      '/api/health',
      '/media/templates/a.mp4',
      '/s/script.js',
      '/demo/ai1.mp4',
      '/i/ABCD2345',
      '/__prerender/index.html',
    ]) {
      expect(isReportablePvuvPage(path), path).toBe(false)
    }
  })
})

describe('reportPvuvCrawlerHit', () => {
  it('生产环境命中爬虫 GET 200/404 时向 PVUV 发送 crawler_hits 载荷', async () => {
    const fetchMock = vi.fn((..._args: unknown[]) => Promise.resolve(new Response('{"ok":true}', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    for (const status of [200, 404]) {
      const req = crawlerRequest('/zh/pricing')
      const task = reportPvuvCrawlerHit(req, PROD_ENV, new URL(req.url), status, { siteId: 'site_123', now: 1763600000000 })
      expect(task).not.toBeNull()
      await task
    }

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [targetUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(targetUrl).toBe('https://api.pvuv.ai/v1/sites/site_123/crawler_hits')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer pvuv_ingest_secret',
      'content-type': 'application/json',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body as string)).toEqual({
      hits: [
        {
          ua: 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
          path: '/zh/pricing',
          ip: '203.0.113.42',
          status: 200,
          country: 'US',
          ts: 1763600000000,
        },
      ],
    })
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string).hits[0].status).toBe(404)
  })

  it('非 production、缺 siteId 或令牌、非 GET、非 200/404、私有路径或普通访客都直接返回 null', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const req = crawlerRequest('/pricing')
    const url = new URL(req.url)
    expect(reportPvuvCrawlerHit(req, { ...PROD_ENV, APP_ENV: 'development' } as Env, url, 200, { siteId: 'site_123' })).toBeNull()
    expect(reportPvuvCrawlerHit(req, { ...PROD_ENV, APP_ENV: 'staging' } as Env, url, 200, { siteId: 'site_123' })).toBeNull()
    expect(reportPvuvCrawlerHit(req, PROD_ENV, url, 200, { siteId: '  ' })).toBeNull()
    expect(reportPvuvCrawlerHit(req, { APP_ENV: 'production', PVUV_INGEST_TOKEN: '' } as unknown as Env, url, 200, { siteId: 'site_123' })).toBeNull()
    expect(reportPvuvCrawlerHit(crawlerRequest('/pricing', 'GPTBot/1.2', 'HEAD'), PROD_ENV, url, 200, { siteId: 'site_123' })).toBeNull()
    expect(reportPvuvCrawlerHit(req, PROD_ENV, url, 301, { siteId: 'site_123' })).toBeNull()
    expect(reportPvuvCrawlerHit(req, PROD_ENV, url, 500, { siteId: 'site_123' })).toBeNull()
    expect(reportPvuvCrawlerHit(crawlerRequest('/admin'), PROD_ENV, new URL('https://moonhop.ai/admin'), 200, { siteId: 'site_123' })).toBeNull()
    expect(reportPvuvCrawlerHit(crawlerRequest('/pricing', 'Mozilla/5.0 Chrome/131.0'), PROD_ENV, url, 200, { siteId: 'site_123' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('上游网络错误或超时时静默吞掉异常，不向外抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('The operation was aborted', 'TimeoutError'))))
    const req = crawlerRequest('/')
    const task = reportPvuvCrawlerHit(req, PROD_ENV, new URL(req.url), 200, { siteId: 'site_123', timeoutMs: 5 })
    await expect(task).resolves.toBeUndefined()
  })
})
