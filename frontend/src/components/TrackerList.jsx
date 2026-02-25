export default function TrackerList({ trackers }) {
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">
          <span>⬡</span> Trackers Detected
        </span>
        <span className="section-count">{trackers.length}</span>
      </div>
      <div className="section-body">
        {trackers.length === 0 ? (
          <div className="empty-state">
            <span className="check">✓</span>
            No known trackers detected
          </div>
        ) : (
          trackers.map((t, i) => (
            <div key={i} className="tracker-item">
              <div className="tracker-info">
                <h4>{t.company}</h4>
                <p className="tracker-url">{t.url}</p>
              </div>
              <span className={`risk-badge risk-${t.risk}`}>{t.risk}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
