import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, cspHeaderName, summarizeCspReports } from '#/server/csp'

describe('contentSecurityPolicy', () => {
  it('包含 media-src self blob 且响应头随 cspReportOnly 切换；未配置 pvuvSiteId 时不放行 pvuv.ai', () => {
    const policy = contentSecurityPolicy('nonce-123', { pvuvSiteId: '' })
    expect(policy).toContain("media-src 'self' blob:")
    expect(policy).toContain("'nonce-nonce-123'")
    expect(policy).not.toContain('pvuv.ai')
    expect(cspHeaderName(true)).toBe('Content-Security-Policy-Report-Only')
    expect(cspHeaderName(false)).toBe('Content-Security-Policy')
  })

  it('配置了 pvuvSiteId 时在 script-src 与 connect-src 放行对应的 https 源', () => {
    const policy = contentSecurityPolicy('nonce-456', {
      pvuvSiteId: 'site_123',
      pvuvScriptUrl: 'https://www.pvuv.ai/f.js',
      pvuvIngestUrl: 'https://in.pvuv.ai',
    })
    expect(policy).toMatch(/script-src[^;]*https:\/\/www\.pvuv\.ai/)
    expect(policy).toMatch(/connect-src[^;]*https:\/\/in\.pvuv\.ai/)

    // 非 https 的无效地址不会混进 CSP
    const insecure = contentSecurityPolicy('nonce-789', {
      pvuvSiteId: 'site_123',
      pvuvScriptUrl: 'http://www.pvuv.ai/f.js',
      pvuvIngestUrl: 'not-a-url',
    })
    expect(insecure).not.toContain('pvuv.ai')
  })
})

describe('summarizeCspReports', () => {
  it('report-uri 格式：URL 去掉 query 和 hash（不把买家邮箱写进日志），inline 等关键字原样保留', () => {
    const raw = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://example.test/checkout/success?email=buyer%40example.test&status=paid#top',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'inline',
        'source-file': 'https://example.test/assets/main.js?v=1',
        'line-number': 12,
      },
    })
    expect(summarizeCspReports(raw)).toEqual([
      'script-src-elem blocked=inline page=https://example.test/checkout/success source=https://example.test/assets/main.js:12',
    ])
  })

  it('Reporting API 格式：一次多条，跳过没有指令的条目', () => {
    const raw = JSON.stringify([
      { type: 'csp-violation', body: { documentURL: 'https://example.test/zh?ref=x', effectiveDirective: 'img-src', blockedURL: 'https://cdn.test/a.png?token=secret' } },
      { type: 'deprecation', body: { message: 'x' } },
      { type: 'csp-violation', body: { documentURL: 'https://example.test/', effectiveDirective: 'script-src-elem', blockedURL: 'eval' } },
    ])
    expect(summarizeCspReports(raw)).toEqual([
      'img-src blocked=https://cdn.test/a.png page=https://example.test/zh',
      'script-src-elem blocked=eval page=https://example.test/',
    ])
  })

  it('非 JSON、空对象、null、字段类型不对时不输出', () => {
    for (const raw of ['not json', '', '{}', 'null', '[null, 1, "x"]', JSON.stringify({ 'csp-report': { 'effective-directive': { x: 1 } } })]) {
      expect(summarizeCspReports(raw), raw).toEqual([])
    }
  })
})
