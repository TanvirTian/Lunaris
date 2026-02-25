/**
 * Script Intelligence Panel
 * Shows obfuscation analysis, entropy scores, eval detection,
 * and data exfiltration patterns per external script.
 */
export default function ScriptIntelligence({ scripts }) {
  if (!scripts?.length) return (
    <div className="section">
      <div className="section-header">
        <span className="section-title"><span>⌥</span> Script Intelligence</span>
        <span className="section-count">0</span>
      </div>
      <div className="empty-state"><span className="check">✓</span> No suspicious scripts analyzed</div>
    </div>
  );

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title"><span>⌥</span> Script Intelligence</span>
        <span className="section-count">{scripts.length} analyzed</span>
      </div>
      <div className="section-body">
        {scripts.map((s, i) => (
          <div key={i} className="script-item">
            <div className="script-header">
              <div className="script-url">{s.url}</div>
              <span className={`risk-badge risk-${s.risk}`}>{s.risk}</span>
            </div>

            {/* Entropy + obfuscation bar */}
            <div className="script-metrics">
              <div className="metric">
                <span className="metric-label">Entropy</span>
                <div className="entropy-bar">
                  <div
                    className="entropy-fill"
                    style={{
                      width: `${Math.min(100, (s.obfuscation.entropy / 6) * 100)}%`,
                      background: s.obfuscation.entropy > 5.5 ? 'var(--danger)'
                        : s.obfuscation.entropy > 4.5 ? 'var(--warning)' : 'var(--safe)',
                    }}
                  />
                </div>
                <span className="metric-value">{s.obfuscation.entropy}</span>
              </div>
              <div className="metric">
                <span className="metric-label">Size</span>
                <span className="metric-value">{s.sizeKb}kb</span>
              </div>
              <div className="metric">
                <span className="metric-label">Obfuscation</span>
                <span className="metric-value" style={{
                  color: s.obfuscation.obfuscationScore >= 60 ? 'var(--danger)'
                    : s.obfuscation.obfuscationScore >= 30 ? 'var(--warning)' : 'var(--safe)'
                }}>
                  {s.obfuscation.obfuscationScore}/100
                </span>
              </div>
            </div>

            {/* Detected signatures */}
            {s.signatures.length > 0 && (
              <div className="script-tags">
                {s.signatures.map((sig, j) => (
                  <span key={j} className={`script-tag tag-${sig.severity}`}>
                    {sig.label} ×{sig.count}
                  </span>
                ))}
              </div>
            )}

            {/* Exfil patterns */}
            {s.exfilPatterns.length > 0 && (
              <div className="script-tags">
                {s.exfilPatterns.map((p, j) => (
                  <span key={j} className="script-tag tag-exfil">{p.label}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
