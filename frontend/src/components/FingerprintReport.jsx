/**
 * Displays browser fingerprinting detection results.
 */
export default function FingerprintReport({ fingerprinting, storageAnalysis }) {
  if (!fingerprinting) return null;

  const checks = [
    { key: 'canvasFingerprint', label: 'Canvas Fingerprinting',  desc: 'Hidden canvas used to generate device ID' },
    { key: 'webglFingerprint',  label: 'WebGL Fingerprinting',   desc: 'GPU info used to identify device' },
    { key: 'fontFingerprint',   label: 'Font Fingerprinting',    desc: 'Installed fonts enumerated for profiling' },
    { key: 'keylogger',         label: 'Global Keylogger',       desc: 'Keystroke listener on document/window' },
    { key: 'formSnooping',      label: 'Form Field Snooping',    desc: 'Scripts reading input field values' },
    { key: 'serviceWorker',     label: 'Service Worker',         desc: 'Can intercept requests + track offline' },
  ];

  const detected = checks.filter((c) => fingerprinting[c.key]);
  const beacons = fingerprinting.beaconCalls || [];

  const hasAnything = detected.length > 0 || beacons.length > 0 || (storageAnalysis?.trackingKeysFound?.length > 0);

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title"><span>◎</span> Fingerprinting & Storage</span>
        <span className="section-count">{detected.length + (beacons.length > 0 ? 1 : 0)} detected</span>
      </div>
      <div className="section-body">
        {!hasAnything ? (
          <div className="empty-state"><span className="check">✓</span> No fingerprinting techniques detected</div>
        ) : (
          <>
            {detected.map((c) => (
              <div key={c.key} className="tracker-item">
                <div className="tracker-info">
                  <h4>{c.label}</h4>
                  <p className="tracker-url">{c.desc}</p>
                </div>
                <span className="risk-badge risk-high">ACTIVE</span>
              </div>
            ))}

            {beacons.length > 0 && (
              <div className="tracker-item">
                <div className="tracker-info">
                  <h4>Beacon API Calls ({beacons.length})</h4>
                  <p className="tracker-url">Data sent to: {[...new Set(beacons.map(b => { try { return new URL(b.url).hostname } catch { return b.url } }))].join(', ')}</p>
                </div>
                <span className="risk-badge risk-medium">BEACON</span>
              </div>
            )}

            {storageAnalysis?.trackingKeysFound?.length > 0 && (
              <div className="tracker-item">
                <div className="tracker-info">
                  <h4>Tracking Data in Storage</h4>
                  <p className="tracker-url">
                    Keys: {storageAnalysis.trackingKeysFound.join(', ')}
                    {' '}({storageAnalysis.localStorageKeys} localStorage, {storageAnalysis.sessionStorageKeys} sessionStorage items total)
                  </p>
                </div>
                <span className="risk-badge risk-medium">STORAGE</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
