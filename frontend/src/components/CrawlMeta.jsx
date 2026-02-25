/**
 * Shows crawl coverage + advanced network metadata.
 */
export default function CrawlMeta({ meta }) {
  if (!meta) return null;

  const rows = [
    { label: 'Pages crawled', value: meta.pagesCrawled?.length || 1 },
    { label: 'External domains', value: meta.externalDomainCount },
    { label: 'Scripts loaded', value: meta.scriptCount },
    { label: 'Cookies', value: meta.cookieCount },
    { label: 'WebSockets', value: meta.webSocketCount || 0 },
    { label: 'Redirects', value: meta.redirectCount || 0 },
    { label: 'Tracking params', value: (meta.trackingParams || []).length },
    { label: 'CSP header', value: meta.csp?.present ? '✓ Present' : '✗ Missing' },
  ];

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title"><span>◫</span> Crawl Coverage</span>
        <span className="section-count">{meta.pagesCrawled?.length || 1} page(s)</span>
      </div>
      <div className="section-body">
        {/* Pages crawled list */}
        <div style={{ padding: '12px 24px 4px', borderBottom: '1px solid var(--border)' }}>
          {(meta.pagesCrawled || [meta.url]).map((p, i) => (
            <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              {i === 0 ? '▸ ' : '  '}{p}
            </div>
          ))}
        </div>
        {/* Stats grid */}
        <div className="crawl-stats-grid">
          {rows.map((r) => (
            <div key={r.label} className="crawl-stat">
              <span className="crawl-stat-value">{r.value}</span>
              <span className="crawl-stat-label">{r.label}</span>
            </div>
          ))}
        </div>
        {/* Tracking params detail */}
        {meta.trackingParams?.length > 0 && (
          <div style={{ padding: '8px 24px 12px', borderTop: '1px solid var(--border)' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
              Tracking params found: {meta.trackingParams.join(', ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
