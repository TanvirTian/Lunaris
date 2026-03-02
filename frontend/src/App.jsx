import { useState, useCallback, useEffect, useRef } from 'react';
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

// ── Loading messages ──────────────────────────────────────────────────────────
// These play in two modes:
//
//   SLOW (cache miss)  — one message every 4 000ms, real crawl running
//   FAST (cache hit)   — one message every 65ms, flashes through in ~600ms
//
// The sequence is identical. Only the speed differs.
// Users on a cache hit see the scanner apparently blazing through a full crawl
// in under a second — they assume the tool is just that fast.
// No cache indicator is ever shown anywhere in the UI.
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

const SLOW_MS =  4_000; // real crawl — advance message every 4 seconds
const FAST_MS =     65; // cache hit  — flash all messages in ~600ms total

/* ── Spinning Moon Loader ─────────────────────────────────────────────────── */
function MoonLoader() {
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAngle(a => (a + 1.4) % 360), 30);
    return () => clearInterval(id);
  }, []);

  const cx = 52, cy = 52, r = 40;
  const rad        = (angle * Math.PI) / 180;
  const termRx     = Math.abs(r * Math.cos(rad));
  const litOnRight = Math.cos(rad) >= 0;

  return (
    <svg
      width={104} height={104}
      viewBox="0 0 104 104"
      style={{
        display: 'block',
        margin: '0 auto',
        filter: 'drop-shadow(0 0 18px rgba(196,168,105,0.45)) drop-shadow(0 0 6px rgba(196,168,105,0.25))',
      }}
    >
      <defs>
        <clipPath id="moon-clip">
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        <radialGradient id="moon-lit" cx="36%" cy="32%" r="68%">
          <stop offset="0%"   stopColor="#f5ecd4" stopOpacity="1" />
          <stop offset="45%"  stopColor="#d4b878" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#8a6830" stopOpacity="0.85" />
        </radialGradient>
        <radialGradient id="moon-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#0c0a06" stopOpacity="0.97" />
          <stop offset="100%" stopColor="#060504" stopOpacity="1" />
        </radialGradient>
      </defs>

      <circle cx={cx} cy={cy} r={r + 5}  fill="none" stroke="rgba(196,168,105,0.14)" strokeWidth={0.8} />
      <circle cx={cx} cy={cy} r={r + 11} fill="none" stroke="rgba(196,168,105,0.06)" strokeWidth={0.6} strokeDasharray="3 9" />
      <circle cx={cx} cy={cy} r={r} fill="url(#moon-lit)" />

      <g clipPath="url(#moon-clip)">
        <rect x={cx} y={cy - r} width={r} height={r * 2} fill="url(#moon-shadow)" />
        <ellipse cx={cx} cy={cy} rx={termRx} ry={r} fill="url(#moon-shadow)" />
        {!litOnRight && (
          <rect x={cx - r} y={cy - r} width={r} height={r * 2} fill="url(#moon-shadow)" />
        )}
      </g>

      <g clipPath="url(#moon-clip)" opacity={0.13}>
        <circle cx={cx - 14} cy={cy - 17} r={7.5} fill="none" stroke="#f5ecd4" strokeWidth={1} />
        <circle cx={cx + 16} cy={cy + 12} r={5}   fill="none" stroke="#f5ecd4" strokeWidth={0.7} />
        <circle cx={cx - 4}  cy={cy + 23} r={6}   fill="none" stroke="#f5ecd4" strokeWidth={0.7} />
        <circle cx={cx + 7}  cy={cy - 27} r={3.5} fill="none" stroke="#f5ecd4" strokeWidth={0.6} />
        <circle cx={cx - 25} cy={cy + 4}  r={3}   fill="none" stroke="#f5ecd4" strokeWidth={0.5} />
      </g>

      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke="#f5ecd4" strokeWidth={1.2} strokeOpacity={0.22}
        clipPath="url(#moon-clip)" />
    </svg>
  );
}

/* ── App ──────────────────────────────────────────────────────────────────── */
export default function App() {
  const [url,        setUrl]        = useState('');
  const [loading,    setLoading]    = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [loadingSub, setLoadingSub] = useState('Full scan takes 30 – 90 seconds');
  const [error,      setError]      = useState(null);
  const [result,     setResult]     = useState(null);
  const [scanTarget, setScanTarget] = useState(null);

  // Ref-based interval so we can swap speed mid-scan (slow → fast)
  // without tearing down and re-mounting any component state.
  const intervalRef = useRef(null);
  const msgIdxRef   = useRef(0);

  const startTicker = useCallback((ms) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      msgIdxRef.current = Math.min(msgIdxRef.current + 1, LOADING_MESSAGES.length - 1);
      setLoadingMsg(LOADING_MESSAGES[msgIdxRef.current]);
    }, ms);
  }, []);

  const analyze = useCallback(async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setScanTarget(null);
    msgIdxRef.current = 0;
    setLoadingMsg(LOADING_MESSAGES[0]);
    setLoadingSub('Full scan takes 30 – 90 seconds');

    // Begin slow — we don't know yet if this is a cache hit
    startTicker(SLOW_MS);

    try {
      const job = await startScan(url.trim(), {
        onProgress: ({ status, cached }) => {
          if (cached) {
            // Cache hit — switch the ticker to warp speed.
            // The backend will respond in 300–600ms total.
            // At 65ms per message that's ~5–8 messages flashing past.
            // Sub-text changes to signal completion is imminent.
            setLoadingSub('Analysis complete');
            startTicker(FAST_MS);
          } else if (status === 'RUNNING') {
            setLoadingMsg('Crawler active — scanning pages…');
          }
        },
      });

      setScanTarget(
        job.result?.data?.meta?.url
        ?? job.result?.meta?.url
        ?? url.trim()
      );
      setResult(job.result?.data ?? job.result);

    } catch (err) {
      setError(err.message);
    } finally {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      setLoading(false);
    }
  }, [url, startTicker]);

  return (
    <div className="app">

      {/* ── Nav ─────────────────────────────────────────────────── */}
      <nav className="lunar-nav">
        <div className="lunar-logo">
          <div className="lunar-crescent" />
          <span className="lunar-wordmark">LUNARIS</span>
        </div>
        <span className="lunar-tagline">Privacy Observatory</span>
      </nav>

      {/* ── Header ──────────────────────────────────────────────── */}
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

      {/* ── Scan Form ───────────────────────────────────────────── */}
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

      {/* ── Error ───────────────────────────────────────────────── */}
      {error && (
        <div className="error-banner">
          <span>⚠</span>
          <span>{error}</span>
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────── */}
      {loading && (
        <div className="loading-state">
          <MoonLoader />
          <p className="loading-msg">{loadingMsg}</p>
          <p className="loading-sub">{loadingSub}</p>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────── */}
      {result && !loading && (
        <div className="results">

          {/* Target URL only — no timestamps, no cache indicators */}
          <div className="results-meta">
            <span>Target: <strong>{scanTarget}</strong></span>
          </div>

          <div className="score-section">
            <ScoreMeter score={result.score} />
            <div className="score-info">
              <h2>{getScoreLabel(result.score)}</h2>
              <p className="score-summary">{result.summary}</p>
              <div className="score-stats">
                <span className="stat-chip">
                  <strong>{result.trackers?.length ?? 0}</strong>trackers
                </span>
                <span className="stat-chip">
                  <strong>{result.meta?.cookieCount ?? 0}</strong>cookies
                </span>
                <span className="stat-chip">
                  <strong>{result.meta?.externalDomainCount ?? 0}</strong>domains
                </span>
                <span className="stat-chip">
                  <strong>{result.ownershipGraph?.stats?.totalCompanies ?? 0}</strong>companies
                </span>
                <span className="stat-chip">
                  <strong>{result.meta?.isHttps ? 'HTTPS ✓' : 'HTTP ✗'}</strong>protocol
                </span>
                <span className="stat-chip">
                  <strong>{result.meta?.pagesCrawled?.length ?? 1}</strong>pages
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
          {result.meta?.externalDomains?.length > 0 && <DomainCloud domains={result.meta.externalDomains} />}

        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────── */}
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
