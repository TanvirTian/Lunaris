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

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-coords">
          RA 05h 34m 32s<br />
          DEC +22° 00′ 52″<br />
          EPOCH J2000.0
        </div>

        <p className="header-eyebrow">
          Lunaris · Privacy Observatory
        </p>

        <h1>
          Who's watching<br />
          <span className="accent">your traffic?</span>
        </h1>

        <p className="header-desc">
          Deep-scans websites for trackers, script obfuscation, cookie abuse,
          corporate data collectors, fingerprinting and more — across multiple pages.
        </p>
      </header>

      {/* ── Scan Form ──────────────────────────────────────────── */}
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

      {/* ── Error ──────────────────────────────────────────────── */}
      {error && (
        <div className="error-banner">
          <span>⚠</span>
          <span>{error}</span>
        </div>
      )}

      {/* ── Loading — Radar ────────────────────────────────────── */}
      {loading && (
        <div className="loading-state">
          <div className="radar-container">
            <div className="radar-ring" />
            <div className="radar-ring radar-ring-2" />
            <div className="radar-ring radar-ring-3" />
            <div className="radar-sweep" />
            <div className="radar-center" />
          </div>
          <p className="loading-msg">{loadingMsg}</p>
          <p className="loading-sub">Full scan takes 30 – 90 seconds</p>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────── */}
      {result && !loading && (
        <div className="results">

          {/* Meta row */}
          <div className="results-meta">
            <span>Target: <strong>{result.meta.url}</strong></span>
            <span>{new Date(result.meta.analyzedAt).toLocaleString()}</span>
            {result.cached && <span className="cached-badge">CACHED</span>}
          </div>

          {/* Score card */}
          <div className="score-section">
            <ScoreMeter score={result.score} />
            <div className="score-info">
              <h2>{getScoreLabel(result.score)}</h2>
              <p className="score-summary">{result.summary}</p>
              <div className="score-stats">
                <span className="stat-chip">
                  <strong>{result.trackers.length}</strong>trackers
                </span>
                <span className="stat-chip">
                  <strong>{result.meta.cookieCount}</strong>cookies
                </span>
                <span className="stat-chip">
                  <strong>{result.meta.externalDomainCount}</strong>domains
                </span>
                <span className="stat-chip">
                  <strong>{result.ownershipGraph?.stats?.totalCompanies || 0}</strong>companies
                </span>
                <span className="stat-chip">
                  <strong>{result.meta.isHttps ? 'HTTPS ✓' : 'HTTP ✗'}</strong>protocol
                </span>
                <span className="stat-chip">
                  <strong>{result.meta.pagesCrawled?.length || 1}</strong>pages
                </span>
              </div>
            </div>
          </div>

          <OwnershipGraph ownershipGraph={result.ownershipGraph} />
          <CrawlMeta meta={result.meta} />
          <ScriptIntelligence scripts={result.scriptIntelligence} />
          <CookieAnalysis cookieAnalysis={result.cookieAnalysis} />
          <FingerprintReport fingerprinting={result.fingerprinting} storageAnalysis={result.storageAnalysis} />
          <TrackerList trackers={result.trackers} />
          <SignalList signals={result.signals} />
          {result.darkPatterns?.length > 0 && <DarkPatterns patterns={result.darkPatterns} />}
          {result.meta.externalDomains?.length > 0 && <DomainCloud domains={result.meta.externalDomains} />}

        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="footer">
        <p className="footer-brand">LUNARIS</p>
        <p>No data stored · No cookies set · No irony intended</p>
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
