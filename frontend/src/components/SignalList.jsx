export default function SignalList({ signals }) {
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">
          <span>◈</span> Security Signals
        </span>
        <span className="section-count">{signals.length}</span>
      </div>
      <div className="section-body">
        {signals.map((s, i) => (
          <div key={i} className={`signal-item signal-${s.type}`}>
            <span className="signal-dot" />
            <span>{s.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
