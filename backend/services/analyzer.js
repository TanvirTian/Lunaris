
import { analyzeScripts } from './scriptIntelligence.js';
import { analyzeCookies } from './cookieAnalysis.js';
import { buildOwnershipGraph } from './ownershipGraph.js';
/**
 * Privacy Analysis Engine — upgraded to handle advanced crawler data.
 */

// Domains that are legitimate CDNs / infrastructure — not trackers.
// Excluded from external domain penalty and tracker detection.
const CDN_ALLOWLIST = [
  'gstatic.com',
  'googleapis.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'cloudflare.com',
  'cloudflareinsights.com',
  'jsdelivr.net',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'bootstrapcdn.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'code.jquery.com',
  'assets.website-files.com',
  'amazonaws.com',
  'azureedge.net',
  'akamaihd.net',
  'fastly.net',
  'fastly.com',
];

function isCDN(hostname) {
  return CDN_ALLOWLIST.some((cdn) => hostname === cdn || hostname.endsWith('.' + cdn));
}

const TRACKER_PATTERNS = [
  { keyword: 'google-analytics', company: 'Google Analytics', risk: 'medium' },
  { keyword: 'googletagmanager', company: 'Google Tag Manager', risk: 'medium' },
  { keyword: 'doubleclick', company: 'Google DoubleClick', risk: 'high' },
  { keyword: 'googlesyndication', company: 'Google AdSense', risk: 'high' },
  { keyword: 'facebook.net', company: 'Meta / Facebook', risk: 'high' },
  { keyword: 'connect.facebook', company: 'Meta / Facebook', risk: 'high' },
  { keyword: 'fbevents', company: 'Meta Pixel', risk: 'high' },
  { keyword: 'hotjar', company: 'Hotjar', risk: 'medium' },
  { keyword: 'mixpanel', company: 'Mixpanel', risk: 'medium' },
  { keyword: 'segment.io', company: 'Segment', risk: 'medium' },
  { keyword: 'amplitude', company: 'Amplitude', risk: 'medium' },
  { keyword: 'heap.io', company: 'Heap Analytics', risk: 'medium' },
  { keyword: 'fullstory', company: 'FullStory', risk: 'high' },
  { keyword: 'logrocket', company: 'LogRocket', risk: 'high' },
  { keyword: 'intercom', company: 'Intercom', risk: 'low' },
  { keyword: 'hubspot', company: 'HubSpot', risk: 'low' },
  { keyword: 'ads.twitter', company: 'Twitter Ads', risk: 'high' },
  { keyword: 'linkedin.com/px', company: 'LinkedIn Pixel', risk: 'high' },
  { keyword: 'quantserve', company: 'Quantcast', risk: 'high' },
  { keyword: 'scorecardresearch', company: 'Comscore', risk: 'medium' },
  { keyword: 'outbrain', company: 'Outbrain', risk: 'medium' },
  { keyword: 'taboola', company: 'Taboola', risk: 'medium' },
  { keyword: 'criteo', company: 'Criteo', risk: 'high' },
  { keyword: 'adsrvr', company: 'The Trade Desk', risk: 'high' },
  { keyword: 'moatads', company: 'Moat Analytics', risk: 'medium' },
  { keyword: 'pixel', company: 'Tracking Pixel', risk: 'medium' },
  { keyword: 'analytics', company: 'Analytics Service', risk: 'low' },
  { keyword: 'tracking', company: 'Tracking Service', risk: 'high' },
  { keyword: 'beacon', company: 'Tracking Beacon', risk: 'medium' },
];

const DARK_PATTERN_KEYWORDS = [
  { words: ['limited time', 'expires soon', 'only today', 'act now', 'hurry', 'ending soon'], label: 'Urgency Language' },
  { words: ['subscribe now', 'don\'t miss out', 'exclusive offer', 'members only', 'sign up today'], label: 'Subscription Pressure' },
  { words: ['you\'ve been selected', 'you\'re a winner', 'congratulations', 'you have been chosen'], label: 'False Personalization' },
  { words: ['cancel anytime', 'no commitment', 'free trial', 'no credit card required'], label: 'Misleading Terms' },
  { words: ['by continuing you agree', 'continued use means', 'using this site you consent'], label: 'Implied Consent' },
];

// Tracking-related localStorage key patterns
const TRACKING_STORAGE_KEYS = [
  '_ga', 'amplitude', 'mixpanel', 'fbp', 'fbc', '_hjid', 'ajs_user',
  'ajs_anonymous', 'heap_', 'intercom', 'drift', 'hs-', '__utmz',
];

function detectTrackers(scriptSrcs, allRequestedUrls) {
  const allUrls = [...new Set([...scriptSrcs, ...allRequestedUrls])];
  const detected = new Map();

  for (const url of allUrls) {
    // Skip known CDN/infrastructure domains — not trackers
    try {
      if (isCDN(new URL(url).hostname)) continue;
    } catch { continue; }

    const lowerUrl = url.toLowerCase();
    for (const pattern of TRACKER_PATTERNS) {
      if (lowerUrl.includes(pattern.keyword)) {
        if (!detected.has(pattern.company)) {
          detected.set(pattern.company, {
            company: pattern.company,
            url: url.slice(0, 120),
            risk: pattern.risk,
          });
        }
        break;
      }
    }
  }

  return [...detected.values()];
}

function detectDarkPatterns(pageText) {
  const lower = pageText.toLowerCase();
  const found = [];
  for (const pattern of DARK_PATTERN_KEYWORDS) {
    const matched = pattern.words.filter((w) => lower.includes(w));
    if (matched.length > 0) {
      found.push({ label: pattern.label, examples: matched.slice(0, 3) });
    }
  }
  return found;
}

/**
 * Analyze storage data for tracking keys.
 */
function analyzeStorage(storageData) {
  const findings = [];
  const allKeys = [
    ...Object.keys(storageData.localStorage || {}),
    ...Object.keys(storageData.sessionStorage || {}),
  ];

  for (const key of allKeys) {
    for (const pattern of TRACKING_STORAGE_KEYS) {
      if (key.toLowerCase().includes(pattern)) {
        findings.push(key);
        break;
      }
    }
  }

  return {
    localStorageKeys: Object.keys(storageData.localStorage || {}).length,
    sessionStorageKeys: Object.keys(storageData.sessionStorage || {}).length,
    trackingKeysFound: [...new Set(findings)],
  };
}

/**
 * Build comprehensive security signals list.
 */
function buildSecuritySignals(crawlData, trackers) {
  const signals = [];
  const fp = crawlData.fingerprinting || {};

  // HTTPS
  if (!crawlData.isHttps) {
    signals.push({ type: 'danger', category: 'Transport', message: 'Site uses HTTP — traffic is unencrypted and can be intercepted.' });
  } else {
    signals.push({ type: 'safe', category: 'Transport', message: 'Site uses HTTPS — traffic is encrypted in transit.' });
  }

  // CSP
  if (!crawlData.cspAnalysis?.present) {
    signals.push({ type: 'warning', category: 'Headers', message: 'No Content-Security-Policy header found — site has no script execution controls.' });
  } else {
    if (crawlData.cspAnalysis.allowsUnsafeInline) {
      signals.push({ type: 'warning', category: 'Headers', message: "CSP allows 'unsafe-inline' scripts — weakens script injection protection." });
    }
    if (crawlData.cspAnalysis.allowsUnsafeEval) {
      signals.push({ type: 'warning', category: 'Headers', message: "CSP allows 'unsafe-eval' — allows dynamic code execution by scripts." });
    }
    if (!crawlData.cspAnalysis.allowsUnsafeInline && !crawlData.cspAnalysis.allowsUnsafeEval) {
      signals.push({ type: 'safe', category: 'Headers', message: 'Content-Security-Policy is present and properly restrictive.' });
    }
  }

  // Fingerprinting
  if (fp.canvasFingerprint) {
    signals.push({ type: 'danger', category: 'Fingerprinting', message: 'Canvas fingerprinting detected — browser renders hidden graphics to create a unique device ID.' });
  }
  if (fp.webglFingerprint) {
    signals.push({ type: 'danger', category: 'Fingerprinting', message: 'WebGL fingerprinting detected — GPU capabilities used to identify your device.' });
  }
  if (fp.fontFingerprint) {
    signals.push({ type: 'warning', category: 'Fingerprinting', message: 'Font fingerprinting detected — installed fonts enumerated to build a device profile.' });
  }

  // Keylogger / form snooping
  if (fp.keylogger) {
    signals.push({ type: 'danger', category: 'Input Monitoring', message: 'Global keyboard listener detected — scripts may capture keystrokes across the page.' });
  }
  if (fp.formSnooping) {
    signals.push({ type: 'warning', category: 'Input Monitoring', message: 'Form field access detected — scripts are reading input field values.' });
  }

  // Beacon API
  if (fp.beaconCalls?.length > 0) {
    signals.push({ type: 'warning', category: 'Network', message: `${fp.beaconCalls.length} sendBeacon() call(s) detected — data sent to servers even after page closes.` });
  }

  // WebSockets
  if (crawlData.webSockets?.length > 0) {
    signals.push({ type: 'warning', category: 'Network', message: `${crawlData.webSockets.length} WebSocket connection(s) — persistent data channels that bypass standard request logging.` });
  }

  // Service Worker
  if (fp.serviceWorker) {
    signals.push({ type: 'warning', category: 'Browser', message: 'Service Worker registered — can intercept requests and track offline behavior.' });
  }

  // Redirect chains
  if (crawlData.redirectChains?.length > 3) {
    signals.push({ type: 'warning', category: 'Network', message: `${crawlData.redirectChains.length} redirect(s) detected — common in tracking pixel chains.` });
  }

  // Tracking params in requests
  if (crawlData.trackingParamsFound?.length > 0) {
    signals.push({ type: 'warning', category: 'Network', message: `Tracking parameters found in requests: ${crawlData.trackingParamsFound.join(', ')}.` });
  }

  // Cookies
  if (crawlData.cookies.length > 20) {
    signals.push({ type: 'warning', category: 'Cookies', message: `${crawlData.cookies.length} cookies set — excessive cookie usage.` });
  } else if (crawlData.cookies.length > 0) {
    signals.push({ type: 'info', category: 'Cookies', message: `${crawlData.cookies.length} cookie(s) detected.` });
  }

  // Inline tracker scripts
  if (crawlData.inlineTrackerScripts > 0) {
    signals.push({ type: 'warning', category: 'Scripts', message: `${crawlData.inlineTrackerScripts} inline script(s) contain tracker initialization code.` });
  }

  // External domains — exclude CDNs from the count
  const nonCdnDomains = crawlData.externalDomains.filter((d) => !isCDN(d));
  if (nonCdnDomains.length > 10) {
    signals.push({ type: 'danger', category: 'Network', message: `${nonCdnDomains.length} third-party (non-CDN) domains contacted — very high data sharing exposure.` });
  } else if (nonCdnDomains.length > 5) {
    signals.push({ type: 'warning', category: 'Network', message: `${nonCdnDomains.length} third-party (non-CDN) domains contacted.` });
  } else if (nonCdnDomains.length > 0) {
    signals.push({ type: 'info', category: 'Network', message: `${nonCdnDomains.length} third-party domain(s) contacted (CDNs excluded).` });
  }

  // High-risk trackers
  const highRisk = trackers.filter((t) => t.risk === 'high');
  if (highRisk.length > 0) {
    signals.push({ type: 'danger', category: 'Trackers', message: `${highRisk.length} high-risk tracker(s): ${highRisk.map((t) => t.company).join(', ')}.` });
  }

  return signals;
}

/**
 * Calculate privacy score with advanced signals factored in.
 */
function calculateScore(crawlData, trackers) {
  let score = 100;
  const fp = crawlData.fingerprinting || {};

  score -= trackers.length * 8;
  if (crawlData.cookies.length > 20) score -= 10;
  if (!crawlData.isHttps) score -= 20;
  if (fp.canvasFingerprint) score -= 15;
  if (fp.webglFingerprint) score -= 10;
  if (fp.fontFingerprint) score -= 8;
  if (fp.keylogger) score -= 15;
  if (fp.formSnooping) score -= 8;
  if ((fp.beaconCalls?.length || 0) > 0) score -= 8;
  if (fp.serviceWorker) score -= 5;
  if ((crawlData.trackingParamsFound?.length || 0) > 0) score -= 10;
  if (!crawlData.cspAnalysis?.present) score -= 5;
  if (crawlData.inlineTrackerScripts > 0) score -= 5;

  return Math.max(0, Math.min(100, score));
}

function generateSummary(score, trackers, crawlData) {
  const domain = (() => { try { return new URL(crawlData.url).hostname; } catch { return crawlData.url; } })();
  const fp = crawlData.fingerprinting || {};
  const fingerprintingActive = fp.canvasFingerprint || fp.webglFingerprint || fp.fontFingerprint;
  const pagesNote = crawlData.pagesCrawled?.length > 1
    ? ` Analysis covered ${crawlData.pagesCrawled.length} pages.`
    : '';

  if (score >= 80) {
    return `${domain} has a strong privacy posture. ${trackers.length === 0 ? 'No trackers detected' : `Only ${trackers.length} tracker(s) found`}, no fingerprinting, and HTTPS is in use.${pagesNote}`;
  } else if (score >= 60) {
    return `${domain} has moderate privacy risks. ${trackers.length} tracker(s) detected${fingerprintingActive ? ', and browser fingerprinting is active' : ''}.${pagesNote} Consider a tracker-blocking extension.`;
  } else if (score >= 40) {
    return `${domain} has elevated privacy risks. ${trackers.length} tracker(s), ${crawlData.cookies.length} cookies${fingerprintingActive ? ', and active fingerprinting' : ''} were found.${pagesNote}`;
  } else {
    return `${domain} poses serious privacy risks. ${trackers.length} tracker(s), ${crawlData.externalDomains.length} third-party domains${fingerprintingActive ? ', fingerprinting' : ''}${fp.keylogger ? ', and a global keylogger' : ''} were detected.${pagesNote} Exercise caution.`;
  }
}

export function analyzePrivacy(crawlData) {
  const trackers = detectTrackers(crawlData.scriptSrcs, crawlData.allRequestedUrls);
  const signals = buildSecuritySignals(crawlData, trackers);
  const score = calculateScore(crawlData, trackers);
  const summary = generateSummary(score, trackers, crawlData);
  const darkPatterns = detectDarkPatterns(crawlData.pageText || '');
  const storageAnalysis = analyzeStorage(crawlData.storageData || {});

  return {
    score,
    trackers,
    signals,
    summary,
    darkPatterns,
    fingerprinting: crawlData.fingerprinting || {},
    storageAnalysis,
    meta: {
      url: crawlData.url,
      isHttps: crawlData.isHttps,
      cookieCount: crawlData.cookies.length,
      externalDomainCount: crawlData.externalDomains.filter((d) => !isCDN(d)).length,
      totalDomainCount: crawlData.externalDomains.length,
      externalDomains: crawlData.externalDomains.filter((d) => !isCDN(d)).slice(0, 20),
      cdnDomains: crawlData.externalDomains.filter((d) => isCDN(d)),
      scriptCount: crawlData.scriptSrcs.length,
      pagesCrawled: crawlData.pagesCrawled || [crawlData.url],
      webSocketCount: crawlData.webSockets?.length || 0,
      redirectCount: crawlData.redirectChains?.length || 0,
      trackingParams: crawlData.trackingParamsFound || [],
      csp: crawlData.cspAnalysis || {},
      analyzedAt: new Date().toISOString(),
    },
  };
}
