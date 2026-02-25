import { useState, useCallback } from 'react';
import { startScan } from './lib/api.js';
import ScoreMeter from './components/ScoreMeter.jsx';
import TrackerList from './components/TrackerList.jsx';
import SignalList from './components/SignalList.jsx';
import DomainCloud from './components/DomainCloud.jsx';
import DarkPatterns from './components/DarkPatterns.jsx';
import FingerprintReport from './components/FingerprintReport.jsx';
import CrawlMeta from './components/CrawlMeta.jsx';
import ScriptIntelligence from './components/ScriptIntelligence.jsx';
import CookieAnalysis from './components/CookieAnalysis.jsx';
import OwnershipGraph from './components/OwnershipGraph.jsx';

const LOADING_MESSAGES = [
  'Launching headless browser…',
  'Loading homepage…',
  'Injecting fingerprint detectors…',
  'Scanning network requests…',
  'Crawling internal pages…',
  'Downloading scripts for analysis…',
  'Running obfuscation detection…',
  'Analyzing cookies…',
  'Building ownership graph…',
  'Generating privacy report…',
];

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const analyze = useCallback(async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setLoadingMsg(LOADING_MESSAGES[0]);

    let msgIdx = 0;
    const msgInterval = setInterval(() => {
      msgIdx = Math.min(msgIdx + 1, LOADING_MESSAGES.length - 1);
      setLoadingMsg(LOADING_MESSAGES[msgIdx]);
    }, 4000);

    try {
      const job = await startScan(url.trim(), {
        onProgress: ({ status, cached }) => {
          if (cached) setLoadingMsg('Returning cached result…');
          else if (status === 'RUNNING') setLoadingMsg('Crawler active — scanning pages…');
        },
      });
      // job.result contains the analysis; job.result.data is the full rawData blob
      setResult(job.result?.data ?? job.result);
    } catch (err) {
      setError(err.message);
    } finally {
      clearInterval(msgInterval);
      setLoading(false);
    }
  }, [url]);

  return (
    <div className="app">
      <header className="header">
        <p className="header-label">// privacy data flow analyzer</p>
        <h1>Who's watching<br /><span>your traffic?</span></h1>
        <p>Deep-scans websites for trackers, script obfuscation, cookie abuse, corporate data collectors, fingerprinting and more — across multiple pages.</p>
      </header>

      <form className="search-form" onSubmit={analyze}>
        <div className="search-input-wrapper">
          <span className="search-prefix">URL →</span>
          <input
            className="search-input"
            type="text"
            placeholder="example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            autoFocus
          />
        </div>
        <button className="search-btn" type="submit" disabled={loading || !url.trim()}>
          {loading ? 'Scanning…' : 'Analyze'}
        </button>
      </form>

      {error && <div className="error-banner"><span>⚠</span><span>{error}</span></div>}

      {loading && (
        <div className="loading-state">
          <div className="loading-spinner" />
          <p style={{ marginBottom: 8 }}>{loadingMsg}</p>
          <p style={{ fontSize: 11, opacity: 0.4 }}>Full scan takes 30–90 seconds</p>
        </div>
      )}

      {result && !loading && (
        <div className="results">
          <div className="results-meta">
            <span>Analyzed: <strong>{result.meta.url}</strong></span>
            <span>{new Date(result.meta.analyzedAt).toLocaleString()}</span>
            {result.cached && <span className="cached-badge">CACHED</span>}
          </div>

          {/* Score */}
          <div className="score-section">
            <ScoreMeter score={result.score} />
            <div className="score-info">
              <h2>{getScoreLabel(result.score)}</h2>
              <p className="score-summary">{result.summary}</p>
              <div className="score-stats">
                <span className="stat-chip"><strong>{result.trackers.length}</strong> trackers</span>
                <span className="stat-chip"><strong>{result.meta.cookieCount}</strong> cookies</span>
                <span className="stat-chip"><strong>{result.meta.externalDomainCount}</strong> external domains</span>
                <span className="stat-chip"><strong>{result.ownershipGraph?.stats?.totalCompanies || 0}</strong> companies</span>
                <span className="stat-chip"><strong>{result.meta.isHttps ? 'HTTPS ✓' : 'HTTP ✗'}</strong></span>
                <span className="stat-chip"><strong>{result.meta.pagesCrawled?.length || 1}</strong> pages crawled</span>
              </div>
            </div>
          </div>

          {/* Company Ownership Graph — most visual, show first */}
          <OwnershipGraph ownershipGraph={result.ownershipGraph} />

          {/* Crawl coverage */}
          <CrawlMeta meta={result.meta} />

          {/* Script Intelligence */}
          <ScriptIntelligence scripts={result.scriptIntelligence} />

          {/* Cookie Deep Analysis */}
          <CookieAnalysis cookieAnalysis={result.cookieAnalysis} />

          {/* Fingerprinting + storage */}
          <FingerprintReport fingerprinting={result.fingerprinting} storageAnalysis={result.storageAnalysis} />

          {/* Trackers */}
          <TrackerList trackers={result.trackers} />

          {/* Security signals */}
          <SignalList signals={result.signals} />

          {/* Dark patterns */}
          {result.darkPatterns?.length > 0 && <DarkPatterns patterns={result.darkPatterns} />}

          {/* External domains */}
          {result.meta.externalDomains?.length > 0 && <DomainCloud domains={result.meta.externalDomains} />}
        </div>
      )}

      <footer className="footer">
        Privacy Analyzer — no data stored, no cookies set, no irony intended.
      </footer>
    </div>
  );
}

function getScoreLabel(score) {
  if (score >= 80) return '✦ Strong Privacy';
  if (score >= 60) return '◈ Moderate Risk';
  if (score >= 40) return '◆ Elevated Risk';
  return '⬛ High Risk';
}
