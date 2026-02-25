export default function DarkPatterns({ patterns }) {
  if (!patterns?.length) return null;

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">
          <span>⚠</span> Dark Pattern Signals
        </span>
        <span className="section-count">{patterns.length}</span>
      </div>
      <div className="section-body">
        {patterns.map((p, i) => (
          <div key={i} className="dark-pattern-item">
            <div className="dark-pattern-label">{p.label}</div>
            <div className="dark-pattern-examples">
              Keywords found: {p.examples.join(', ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
