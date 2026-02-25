/**
 * Cookie Deep Analysis Panel
 * Shows per-cookie breakdown: purpose, lifetime, security attributes,
 * third-party status, and company attribution.
 */
const PURPOSE_COLOR = {
  tracking:   'var(--danger)',
  session:    'var(--safe)',
  functional: 'var(--info)',
  unknown:    'var(--text-muted)',
};

const LIFETIME_COLOR = {
  critical: 'var(--danger)',
  high:     'var(--warning)',
  medium:   '#ffdd88',
  low:      'var(--info)',
  safe:     'var(--safe)',
};

export default function CookieAnalysis({ cookieAnalysis }) {
  if (!cookieAnalysis) return null;
  const { cookies, summary } = cookieAnalysis;

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title"><span>◉</span> Cookie Deep Analysis</span>
        <span className="section-count">{summary.total}</span>
      </div>

      {/* Summary bar */}
      <div className="cookie-summary">
        {Object.entries(summary.byPurpose).map(([purpose, count]) => (
          <div key={purpose} className="cookie-purpose-stat">
            <span className="cookie-purpose-count" style={{ color: PURPOSE_COLOR[purpose] || 'var(--text)' }}>{count}</span>
            <span className="cookie-purpose-label">{purpose}</span>
          </div>
        ))}
        <div className="cookie-purpose-stat">
          <span className="cookie-purpose-count" style={{ color: 'var(--danger)' }}>{summary.thirdPartyTracking}</span>
          <span className="cookie-purpose-label">3rd-party tracking</span>
        </div>
        <div className="cookie-purpose-stat">
          <span className="cookie-purpose-count" style={{ color: 'var(--warning)' }}>{summary.securityIssues}</span>
          <span className="cookie-purpose-label">security issues</span>
        </div>
        {summary.longestLivedDays > 365 && (
          <div className="cookie-purpose-stat">
            <span className="cookie-purpose-count" style={{ color: 'var(--danger)' }}>
              {Math.round(summary.longestLivedDays / 365)}yr
            </span>
            <span className="cookie-purpose-label">longest cookie</span>
          </div>
        )}
      </div>

      {/* Cookie rows */}
      <div className="section-body">
        {cookies.map((c, i) => (
          <div key={i} className="cookie-row">
            <div className="cookie-main">
              <div className="cookie-name-row">
                <span className="cookie-name">{c.name}</span>
                {c.isThirdParty && <span className="cookie-badge badge-3p">3rd party</span>}
                {!c.isHttpOnly && <span className="cookie-badge badge-warn">JS-accessible</span>}
                {!c.isSecure && <span className="cookie-badge badge-warn">no Secure</span>}
              </div>
              <span className="cookie-company">{c.company} · {c.domain}</span>
            </div>
            <div className="cookie-meta">
              <span className="cookie-purpose" style={{ color: PURPOSE_COLOR[c.purpose] || 'var(--text)' }}>
                {c.purpose}
              </span>
              <span className="cookie-lifetime" style={{ color: LIFETIME_COLOR[c.lifetime.risk] || 'var(--text)' }}>
                {c.lifetime.label}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
