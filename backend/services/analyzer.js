import { analyzeScripts }        from './scriptIntelligence.js';
import { analyzeCookies }         from './cookieAnalysis.js';
import { buildOwnershipGraph }    from './ownershipGraph.js';
import { calculateWeightedScore } from './scoring.js';
import { analyzeNetworkPayloads } from './networkAnalysis.js';

/**
 * Privacy Analysis Engine — Production Upgrade
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces flat deduction scoring with weighted risk model.
 * Wires all new crawler signals into scoring + UI signal list.
 * Integrates network payload analysis for payload-level privacy violations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CDN_ALLOWLIST = [
  'gstatic.com','googleapis.com','fonts.googleapis.com','fonts.gstatic.com',
  'ajax.googleapis.com','cloudflare.com','cloudflareinsights.com',
  'jsdelivr.net','cdn.jsdelivr.net','unpkg.com','cdnjs.cloudflare.com',
  'bootstrapcdn.com','stackpath.bootstrapcdn.com','maxcdn.bootstrapcdn.com',
  'code.jquery.com','assets.website-files.com','amazonaws.com',
  'azureedge.net','akamaihd.net','fastly.net','fastly.com',
];

export function isCDN(hostname) {
  return CDN_ALLOWLIST.some((cdn) => hostname === cdn || hostname.endsWith('.' + cdn));
}

const TRACKER_PATTERNS = [
  { keyword: 'google-analytics',  company: 'Google Analytics',   risk: 'medium',   category: 'behavioral'           },
  { keyword: 'googletagmanager',  company: 'Google Tag Manager', risk: 'medium',   category: 'advertising'          },
  { keyword: 'doubleclick',       company: 'Google DoubleClick',  risk: 'high',     category: 'advertising'          },
  { keyword: 'googlesyndication', company: 'Google AdSense',     risk: 'high',     category: 'advertising'          },
  { keyword: 'googleadservices',  company: 'Google Ads',         risk: 'high',     category: 'advertising'          },
  { keyword: 'facebook.net',      company: 'Meta Pixel',         risk: 'high',     category: 'advertising'          },
  { keyword: 'connect.facebook',  company: 'Meta / Facebook',    risk: 'high',     category: 'advertising'          },
  { keyword: 'fbevents',          company: 'Meta Pixel',         risk: 'high',     category: 'advertising'          },
  { keyword: 'hotjar',            company: 'Hotjar',             risk: 'high',     category: 'session_replay'       },
  { keyword: 'fullstory',         company: 'FullStory',          risk: 'high',     category: 'session_replay'       },
  { keyword: 'logrocket',         company: 'LogRocket',          risk: 'high',     category: 'session_replay'       },
  { keyword: 'smartlook',         company: 'Smartlook',          risk: 'high',     category: 'session_replay'       },
  { keyword: 'mouseflow',         company: 'Mouseflow',          risk: 'high',     category: 'session_replay'       },
  { keyword: 'luckyorange',       company: 'Lucky Orange',       risk: 'high',     category: 'session_replay'       },
  { keyword: 'clarity.ms',        company: 'Microsoft Clarity',  risk: 'medium',   category: 'session_replay'       },
  { keyword: 'mixpanel',          company: 'Mixpanel',           risk: 'medium',   category: 'behavioral'           },
  { keyword: 'segment.io',        company: 'Segment',            risk: 'medium',   category: 'behavioral'           },
  { keyword: 'amplitude',         company: 'Amplitude',          risk: 'medium',   category: 'behavioral'           },
  { keyword: 'heap.io',           company: 'Heap Analytics',     risk: 'medium',   category: 'behavioral'           },
  { keyword: 'kissmetrics',       company: 'Kissmetrics',        risk: 'medium',   category: 'behavioral'           },
  { keyword: 'criteo',            company: 'Criteo',             risk: 'high',     category: 'identity_resolution'  },
  { keyword: 'adsrvr',            company: 'The Trade Desk',     risk: 'high',     category: 'identity_resolution'  },
  { keyword: 'id5-sync',          company: 'ID5',                risk: 'high',     category: 'identity_resolution'  },
  { keyword: 'liveramp',          company: 'LiveRamp',           risk: 'critical', category: 'data_broker'          },
  { keyword: 'acxiom',            company: 'Acxiom',             risk: 'critical', category: 'data_broker'          },
  { keyword: 'oracle-data',       company: 'Oracle Data Cloud',  risk: 'critical', category: 'data_broker'          },
  { keyword: 'ads.twitter',       company: 'Twitter/X Ads',      risk: 'high',     category: 'advertising'          },
  { keyword: 'linkedin.com/px',   company: 'LinkedIn Pixel',     risk: 'high',     category: 'advertising'          },
  { keyword: 'quantserve',        company: 'Quantcast',          risk: 'high',     category: 'advertising'          },
  { keyword: 'scorecardresearch', company: 'Comscore',           risk: 'medium',   category: 'behavioral'           },
  { keyword: 'outbrain',          company: 'Outbrain',           risk: 'medium',   category: 'advertising'          },
  { keyword: 'taboola',           company: 'Taboola',            risk: 'medium',   category: 'advertising'          },
  { keyword: 'moatads',           company: 'Moat Analytics',     risk: 'medium',   category: 'behavioral'           },
  { keyword: 'intercom',          company: 'Intercom',           risk: 'low',      category: 'functional'           },
  { keyword: 'hubspot',           company: 'HubSpot',            risk: 'low',      category: 'functional'           },
  { keyword: 'zendesk',           company: 'Zendesk',            risk: 'low',      category: 'functional'           },
  { keyword: 'drift',             company: 'Drift',              risk: 'low',      category: 'functional'           },
  { keyword: 'pixel',             company: 'Tracking Pixel',     risk: 'medium',   category: 'advertising'          },
  { keyword: 'tracking',          company: 'Tracking Service',   risk: 'high',     category: 'advertising'          },
  { keyword: 'beacon',            company: 'Tracking Beacon',    risk: 'medium',   category: 'advertising'          },
  { keyword: 'analytics',         company: 'Analytics Service',  risk: 'low',      category: 'behavioral'           },
];

const DARK_PATTERN_KEYWORDS = [
  { words: ['limited time','expires soon','only today','act now','hurry','ending soon'],         label: 'Urgency Language'       },
  { words: ['subscribe now',"don't miss out",'exclusive offer','members only','sign up today'], label: 'Subscription Pressure'  },
  { words: ["you've been selected","you're a winner",'congratulations','you have been chosen'],  label: 'False Personalization'  },
  { words: ['cancel anytime','no commitment','free trial','no credit card required'],            label: 'Misleading Terms'       },
  { words: ['by continuing you agree','continued use means','using this site you consent'],      label: 'Implied Consent'        },
];

const TRACKING_STORAGE_KEYS = [
  '_ga','amplitude','mixpanel','fbp','fbc','_hjid','ajs_user',
  'ajs_anonymous','heap_','intercom','drift','hs-','__utmz',
];

function detectTrackers(scriptSrcs, allRequestedUrls) {
  const allUrls  = [...new Set([...scriptSrcs, ...allRequestedUrls])];
  const detected = new Map();
  for (const url of allUrls) {
    try { if (isCDN(new URL(url).hostname)) continue; } catch { continue; }
    const lower = url.toLowerCase();
    for (const p of TRACKER_PATTERNS) {
      if (lower.includes(p.keyword)) {
        if (!detected.has(p.company)) detected.set(p.company, { company: p.company, url: url.slice(0, 120), risk: p.risk, category: p.category });
        break;
      }
    }
  }
  return [...detected.values()];
}

function detectDarkPatterns(pageText) {
  const lower = pageText.toLowerCase();
  return DARK_PATTERN_KEYWORDS
    .map((p) => { const m = p.words.filter((w) => lower.includes(w)); return m.length ? { label: p.label, examples: m.slice(0, 3) } : null; })
    .filter(Boolean);
}

function analyzeStorage(storageData) {
  const allKeys  = [...Object.keys(storageData.localStorage || {}), ...Object.keys(storageData.sessionStorage || {})];
  const findings = [...new Set(allKeys.filter((k) => TRACKING_STORAGE_KEYS.some((p) => k.toLowerCase().includes(p))))];
  return {
    localStorageKeys:   Object.keys(storageData.localStorage  || {}).length,
    sessionStorageKeys: Object.keys(storageData.sessionStorage || {}).length,
    trackingKeysFound:  findings,
  };
}

// Build the flat signal map consumed by scoring.js
function buildSignalMap(crawlData, trackers, netSignals) {
  const fp  = crawlData.fingerprinting || {};
  const cats = trackers.map((t) => t.category);
  const has  = (cat) => cats.includes(cat);
  return {
    combined_fingerprint_attack:  fp.combinedFingerprintAttack  || false,
    canvas_fingerprint:           fp.canvasFingerprint          || false,
    webgl_fingerprint:            fp.webglFingerprint           || false,
    font_fingerprint:             fp.fontFingerprint            || false,
    audio_fingerprint:            fp.audioFingerprint           || false,
    hardware_fingerprint:         fp.hardwareFingerprint        || false,
    media_device_fingerprint:     fp.mediaDeviceFingerprint     || false,
    battery_fingerprint:          fp.batteryFingerprint         || false,
    timing_fingerprint:           fp.timingKeylogger            || false,
    keylogger_behavioral:         fp.keylogger                  || false,
    keylogger_timing:             fp.timingKeylogger            || false,
    form_snooping_autofill:       fp.autofillCapture            || false,
    form_snooping_hidden:         fp.formSnooping               || false,
    mutation_observer_harvesting: fp.mutationKeylogger          || false,
    session_replay:               has('session_replay') || netSignals.session_replay || false,
    pii_in_payload:               netSignals.pii_in_payload              || false,
    hashed_email_transmission:    netSignals.hashed_email_transmission   || false,
    session_id_leakage:           netSignals.session_id_leakage          || false,
    behavioral_payload:           netSignals.behavioral_payload          || false,
    beacon_exfiltration:          (fp.beaconCalls?.length > 0) || netSignals.beacon_exfiltration || false,
    canvas_hash_in_request:       netSignals.canvas_hash_in_request      || false,
    data_broker_tracker:          has('data_broker')          || netSignals.data_broker_tracker          || false,
    identity_resolution_tracker:  has('identity_resolution')  || netSignals.identity_resolution_tracker  || false,
    session_replay_tracker:       has('session_replay')       || netSignals.session_replay_tracker       || false,
    behavioral_analytics_tracker: has('behavioral')           || netSignals.behavioral_analytics_tracker || false,
    ad_network_tracker:           has('advertising')          || netSignals.ad_network_tracker           || false,
    functional_tracker:           has('functional')           || netSignals.functional_tracker           || false,
    no_https:                     !crawlData.isHttps,
    no_csp:                       !crawlData.cspAnalysis?.present,
    csp_unsafe_inline:            crawlData.cspAnalysis?.allowsUnsafeInline || false,
    csp_unsafe_eval:              crawlData.cspAnalysis?.allowsUnsafeEval   || false,
    obfuscated_script_high_risk:  false, // patched below from scriptResults
    service_worker:               fp.serviceWorker || false,
    websocket_connections:        (crawlData.webSockets?.length > 0) || false,
    tracking_params_in_requests:  (crawlData.trackingParamsFound?.length > 0) || false,
  };
}

function buildSecuritySignals(crawlData, trackers, networkAnalysis, scoring) {
  const signals = [];
  const fp  = crawlData.fingerprinting || {};
  const ctx = crawlData.context || {};

  // Transport
  signals.push(crawlData.isHttps
    ? { type: 'safe',    category: 'Transport', message: 'Site uses HTTPS — traffic is encrypted in transit.' }
    : { type: 'danger',  category: 'Transport', message: 'Site uses HTTP — all traffic is unencrypted and can be intercepted.' });

  // CSP
  if (!crawlData.cspAnalysis?.present) {
    signals.push({ type: 'warning', category: 'Headers', message: 'No Content-Security-Policy header — no script execution controls in place.' });
  } else {
    if (crawlData.cspAnalysis.allowsUnsafeInline) signals.push({ type: 'warning', category: 'Headers', message: "CSP allows 'unsafe-inline' — weakens script injection protection." });
    if (crawlData.cspAnalysis.allowsUnsafeEval)   signals.push({ type: 'warning', category: 'Headers', message: "CSP allows 'unsafe-eval' — permits dynamic code execution." });
    if (!crawlData.cspAnalysis.allowsUnsafeInline && !crawlData.cspAnalysis.allowsUnsafeEval)
      signals.push({ type: 'safe', category: 'Headers', message: 'Content-Security-Policy is present and restrictive.' });
  }

  // Fingerprinting
  if (fp.combinedFingerprintAttack) {
    const apis = fp.fingerprintClusters?.[0]?.join(', ') || 'multiple APIs';
    signals.push({ type: 'danger', category: 'Fingerprinting', message: `Combined fingerprint attack — ${apis} called within 500ms. Entropy: ~${fp.entropyBits?.toFixed(1) || '20+'} bits (~1-in-${Math.min(999999, Math.round(Math.pow(2, fp.entropyBits || 20))).toLocaleString()} devices).` });
  } else {
    if (fp.canvasFingerprint)      signals.push({ type: 'danger',  category: 'Fingerprinting', message: 'Canvas fingerprinting detected. (~7 bits of identifying entropy)' });
    if (fp.webglFingerprint)       signals.push({ type: 'danger',  category: 'Fingerprinting', message: 'WebGL fingerprinting — GPU renderer string used to identify device. (~6.5 bits)' });
    if (fp.audioFingerprint)       signals.push({ type: 'danger',  category: 'Fingerprinting', message: 'Audio fingerprinting — AnalyserNode/OfflineAudioContext used. (~5.5 bits)' });
    if (fp.fontFingerprint)        signals.push({ type: 'warning', category: 'Fingerprinting', message: 'Font fingerprinting — installed fonts enumerated. (~8 bits, highest single-signal entropy)' });
    if (fp.hardwareFingerprint)    signals.push({ type: 'warning', category: 'Fingerprinting', message: 'Hardware fingerprinting — deviceMemory + hardwareConcurrency read without permission.' });
    if (fp.mediaDeviceFingerprint) signals.push({ type: 'danger',  category: 'Fingerprinting', message: 'Media device enumeration — camera/microphone hardware IDs accessed (no permission required). (~4.5 bits)' });
    if (fp.batteryFingerprint)     signals.push({ type: 'warning', category: 'Fingerprinting', message: 'Battery API accessed — deprecated but still used for device fingerprinting.' });
  }

  // Active capture
  if (fp.keylogger) {
    const ctx_note = ctx.hasPasswordField ? ' — password field detected on this page.' : '.';
    signals.push({ type: 'danger', category: 'Input Monitoring', message: `Global keyboard event listener detected${ctx_note}` });
  }
  if (fp.timingKeylogger)  signals.push({ type: 'danger',  category: 'Input Monitoring', message: 'Timing-based keystroke capture — high-frequency rAF loop can reconstruct keystrokes from timing alone.' });
  if (fp.mutationKeylogger) signals.push({ type: 'warning', category: 'Input Monitoring', message: 'MutationObserver watching for new input fields — scripts attach listeners before user interaction.' });
  if (fp.autofillCapture) {
    signals.push({ type: 'danger', category: 'Input Monitoring', message: `Autofill capture — scripts read input values before user interaction.${ctx.hasPaymentForm ? ' Payment form detected.' : ''}` });
  }
  if (fp.formSnooping && !fp.autofillCapture) {
    signals.push({ type: 'warning', category: 'Input Monitoring', message: 'Form field access detected — scripts reading input values.' });
  }

  // Payload findings
  if (networkAnalysis.payloadFindings?.length > 0) {
    const crit = networkAnalysis.payloadFindings.filter((f) => f.risk === 'critical');
    const high = networkAnalysis.payloadFindings.filter((f) => f.risk === 'high');
    if (crit.length) signals.push({ type: 'danger',  category: 'Data Exfiltration', message: `${crit.length} critical: ${[...new Set(crit.map((f) => f.label))].join(', ')}.` });
    if (high.length) signals.push({ type: 'danger',  category: 'Data Exfiltration', message: `${high.length} high-risk: ${[...new Set(high.map((f) => f.label))].join(', ')}.` });
  }

  if (fp.beaconCalls?.length > 0) {
    signals.push({ type: 'warning', category: 'Network', message: `${fp.beaconCalls.length} sendBeacon() call(s) — data transmitted after page close, bypassing blockers.` });
  }

  // Tracker categories
  const byCategory = {};
  for (const t of trackers) { (byCategory[t.category] = byCategory[t.category] || []).push(t.company); }

  if (byCategory.data_broker?.length)
    signals.push({ type: 'danger',  category: 'Trackers', message: `Data broker(s): ${byCategory.data_broker.join(', ')} — sell consumer profiles to third parties.` });
  if (byCategory.session_replay?.length) {
    const note = (ctx.hasLoginForm || ctx.hasPasswordField) ? ' — password/login form on this page.' : '.';
    signals.push({ type: 'danger',  category: 'Trackers', message: `Session replay: ${byCategory.session_replay.join(', ')} records mouse, clicks, and typing${note}` });
  }
  if (byCategory.identity_resolution?.length)
    signals.push({ type: 'danger',  category: 'Trackers', message: `Identity resolution: ${byCategory.identity_resolution.join(', ')} — cross-site user matching without cookies.` });
  if (byCategory.behavioral?.length)
    signals.push({ type: 'warning', category: 'Trackers', message: `Behavioral analytics: ${byCategory.behavioral.join(', ')}.` });

  const highTrackers = trackers.filter((t) => t.risk === 'high' || t.risk === 'critical');
  if (highTrackers.length && !byCategory.session_replay && !byCategory.data_broker)
    signals.push({ type: 'danger', category: 'Trackers', message: `${highTrackers.length} high-risk tracker(s): ${highTrackers.map((t) => t.company).join(', ')}.` });

  if (fp.serviceWorker) signals.push({ type: 'warning', category: 'Browser', message: 'Service Worker registered — intercepts requests and can track offline behavior.' });
  if (crawlData.webSockets?.length > 0) signals.push({ type: 'warning', category: 'Network', message: `${crawlData.webSockets.length} WebSocket connection(s) — persistent real-time channels.` });

  const nonCdnDomains = crawlData.externalDomains.filter((d) => !isCDN(d));
  if      (nonCdnDomains.length > 10) signals.push({ type: 'danger',  category: 'Network', message: `${nonCdnDomains.length} third-party (non-CDN) domains contacted — high data sharing exposure.` });
  else if (nonCdnDomains.length > 5)  signals.push({ type: 'warning', category: 'Network', message: `${nonCdnDomains.length} third-party (non-CDN) domains contacted.` });
  else if (nonCdnDomains.length > 0)  signals.push({ type: 'info',    category: 'Network', message: `${nonCdnDomains.length} third-party domain(s) contacted (CDNs excluded).` });

  if (crawlData.cookies.length > 20) signals.push({ type: 'warning', category: 'Cookies', message: `${crawlData.cookies.length} cookies — excessive for most sites.` });
  else if (crawlData.cookies.length) signals.push({ type: 'info',    category: 'Cookies', message: `${crawlData.cookies.length} cookie(s) set.` });

  if (crawlData.redirectChains?.length > 3)
    signals.push({ type: 'warning', category: 'Network', message: `${crawlData.redirectChains.length} redirect(s) — common in tracking chains.` });

  if (scoring.confidence < 75)
    signals.push({ type: 'info', category: 'Coverage', message: `Analysis confidence: ${scoring.confidence}% — based on ${crawlData.pagesCrawled?.length || 1} page(s). Deeper crawl may reveal more.` });

  if (scoring.exploitability.score >= 70)
    signals.push({ type: 'danger', category: 'Risk Assessment', message: `Exploitability: ${scoring.exploitability.label} — detected signals could enable persistent cross-session identity tracking.` });

  return signals;
}

function generateSummary(scoring, trackers, crawlData, networkAnalysis) {
  const domain    = (() => { try { return new URL(crawlData.url).hostname; } catch { return crawlData.url; } })();
  const fp        = crawlData.fingerprinting || {};
  const pages     = crawlData.pagesCrawled?.length > 1 ? ` Crawled ${crawlData.pagesCrawled.length} pages.` : '';
  const { score, exploitability } = scoring;
  const fpActive  = fp.canvasFingerprint || fp.webglFingerprint || fp.audioFingerprint || fp.combinedFingerprintAttack;
  const capture   = fp.keylogger || fp.timingKeylogger || fp.autofillCapture;
  const exfil     = networkAnalysis.payloadFindings?.some((f) => f.risk === 'critical');

  if (score >= 80) return `${domain} has a strong privacy posture. ${trackers.length === 0 ? 'No trackers detected' : `Only ${trackers.length} tracker(s) found`}${fpActive ? ', though some fingerprinting is active' : ', no fingerprinting detected'}.${pages}`;
  if (score >= 60) return `${domain} has moderate privacy risks. ${trackers.length} tracker(s)${fpActive ? ', active fingerprinting' : ''}. Exploitability: ${exploitability.label.toLowerCase()}.${pages}`;
  if (score >= 40) return `${domain} has elevated privacy risks — ${trackers.length} trackers, ${crawlData.cookies.length} cookies${fpActive ? ', active fingerprinting' : ''}${capture ? ', active input monitoring' : ''}.${pages}`;

  const worst = capture ? 'active input capture' : exfil ? 'sensitive data exfiltration' : fp.combinedFingerprintAttack ? 'combined fingerprint attack' : `${trackers.length} trackers`;
  return `${domain} poses serious privacy risks. ${worst} detected. Exploitability: ${exploitability.label.toLowerCase()}.${pages}`;
}

export async function analyzePrivacy(crawlData) {
  const trackers        = detectTrackers(crawlData.scriptSrcs, crawlData.allRequestedUrls);
  const netAnalysis     = analyzeNetworkPayloads(crawlData.allRequests || []);

  // Run script intelligence + cookie analysis in parallel (both async-capable)
  const [scriptResults, cookieAnalysis] = await Promise.all([
    analyzeScripts(crawlData.scriptSrcs || [], isCDN),
    Promise.resolve(analyzeCookies(
      crawlData.cookies || [],
      (() => { try { return new URL(crawlData.url).hostname; } catch { return ''; } })()
    )),
  ]);

  // Build ownership graph — uses asnResults from crawler for unknown domains
  const ownershipGraph = buildOwnershipGraph(
    crawlData.externalDomains || [],
    crawlData.url,
    crawlData.asnResults || {}
  );

  // Wire script risk into the signal map
  const hasHighRiskScript   = scriptResults.some((s) => s.risk === 'high');
  const hasMediumRiskScript = scriptResults.some((s) => s.risk === 'medium');

  const signalMap = buildSignalMap(crawlData, trackers, netAnalysis.signals);
  // Patch obfuscated_script signals from actual script analysis (was hardcoded false)
  signalMap.obfuscated_script_high_risk   = hasHighRiskScript;
  signalMap.obfuscated_script_medium_risk = hasMediumRiskScript && !hasHighRiskScript;

  const crawlWithCtx    = { ...crawlData, context: { ...crawlData.context, adTrackerCount: netAnalysis.adTrackerCount || 0 } };
  const scoring         = calculateWeightedScore(signalMap, crawlWithCtx);
  const securitySignals = buildSecuritySignals(crawlData, trackers, netAnalysis, scoring);
  const summary         = generateSummary(scoring, trackers, crawlData, netAnalysis);
  const darkPatterns    = detectDarkPatterns(crawlData.pageText || '');
  const storageAnalysis = analyzeStorage(crawlData.storageData || {});
  const riskLevel       = scoring.score >= 80 ? 'low' : scoring.score >= 60 ? 'medium' : scoring.score >= 40 ? 'high' : 'critical';

  return {
    score:         scoring.score,
    confidence:    scoring.confidence,
    exploitability: scoring.exploitability,
    riskLevel,
    riskBreakdown: scoring.riskBreakdown,
    trackers,
    signals:       securitySignals,
    summary,
    darkPatterns,
    fingerprinting:   crawlData.fingerprinting || {},
    storageAnalysis,
    // These three are consumed by OwnershipGraph, ScriptIntelligence, CookieAnalysis components
    ownershipGraph,
    scriptIntelligence: scriptResults,
    cookieAnalysis,
    networkAnalysis: {
      payloadFindings:   netAnalysis.payloadFindings,
      trackerCategories: netAnalysis.trackerCategories,
      summary:           netAnalysis.summary,
    },
    meta: {
      url:                crawlData.url,
      isHttps:            crawlData.isHttps,
      cookieCount:        crawlData.cookies.length,
      externalDomainCount: crawlData.externalDomains.filter((d) => !isCDN(d)).length,
      totalDomainCount:   crawlData.externalDomains.length,
      externalDomains:    crawlData.externalDomains.filter((d) => !isCDN(d)).slice(0, 20),
      cdnDomains:         crawlData.externalDomains.filter((d) => isCDN(d)),
      scriptCount:        crawlData.scriptSrcs.length,
      pagesCrawled:       crawlData.pagesCrawled || [crawlData.url],
      webSocketCount:     crawlData.webSockets?.length || 0,
      redirectCount:      crawlData.redirectChains?.length || 0,
      trackingParams:     crawlData.trackingParamsFound || [],
      csp:                crawlData.cspAnalysis || {},
      hasLoginForm:       crawlData.context?.hasLoginForm     || false,
      hasPasswordField:   crawlData.context?.hasPasswordField || false,
      hasPaymentForm:     crawlData.context?.hasPaymentForm   || false,
      asnResults:         crawlData.asnResults || {},
      analyzedAt:         new Date().toISOString(),
    },
  };
}
