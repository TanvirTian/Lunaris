export default function DomainCloud({ domains }) {
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">
          <span>◌</span> External Domains Contacted
        </span>
        <span className="section-count">{domains.length}</span>
      </div>
      <div className="domains-grid">
        {domains.map((d, i) => (
          <span key={i} className="domain-tag">{d}</span>
        ))}
      </div>
    </div>
  );
}
