import { chromium } from 'playwright';
import { lookup, Resolver } from 'dns/promises';
import { isIP } from 'net';


const MAX_PAGES          = 4;
const CRAWL_CONCURRENCY  = 2;
const MAX_POST_BODY_SIZE = 4096;

const TIMEOUTS = {
  dns:        5_000,
  navigation: 25_000,
  pageSettle: 6_000,
  jsSettle:   2_000,
};

// ─── Layer 1: URL Normalization ───────────────────────────────────────────────

export function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('URL_MISSING: no URL provided');
  let input = raw.trim();
  if (!input) throw new Error('URL_EMPTY: URL cannot be blank');
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;

    let parsed;
  try { parsed = new URL(input); }
  catch { throw new Error(`URL_MALFORMED: "${input}" is not a valid URL`); }

  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error(`URL_INVALID_PROTOCOL: "${parsed.protocol}" is not supported`);

  const hostname = parsed.hostname;
  if (!hostname || hostname.length < 1) throw new Error('URL_INVALID_HOSTNAME: no hostname found');
  if (!hostname.includes('.')) throw new Error(`URL_NO_TLD: "${hostname}" has no dot — not a valid domain`);
  if (isIP(hostname)) throw new Error(`URL_RAW_IP: direct IP addresses are not supported`);
  return parsed.href;
}

// ─── Layer 2: DNS Pre-Resolution ─────────────────────────────────────────────

async function resolveDns(hostname) {
  const dnsPromise = lookup(hostname, { family: 0 });
  const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('DNS_TIMEOUT')), TIMEOUTS.dns)
  );
  try {
    return await Promise.race([dnsPromise, timeout]);
  } catch (err) {
    if ((err.message || '').includes('DNS_TIMEOUT') || err.code === 'ETIMEOUT')
      throw new Error(`DNS_TIMEOUT: could not resolve "${hostname}" in time`);
    throw new Error(`DNS_FAILED:${err.code || 'UNKNOWN'}: "${hostname}" does not exist`);
  }
}

// ─── Layer 3: SSRF Protection ─────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^127\./, /^10\./, /^192\.168\./,
/^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./,
/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^0\./,
/^::1$/, /^fc[0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i,
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '0.0.0.0', 'metadata.google.internal', '169.254.169.254',
]);

const BLOCKED_HOSTNAME_PATTERNS = [
  /\.local$/i, /\.internal$/i, /\.corp$/i, /\.lan$/i, /\.intranet$/i,
];

function assertNotPrivate(hostname, resolvedAddress) {
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase()))
    throw new Error(`SSRF_BLOCKED_HOSTNAME: "${hostname}" is a reserved hostname`);
  if (BLOCKED_HOSTNAME_PATTERNS.some((p) => p.test(hostname)))
    throw new Error(`SSRF_BLOCKED_PATTERN: "${hostname}" matches a private network pattern`);
  if (PRIVATE_IP_PATTERNS.some((p) => p.test(resolvedAddress)))
    throw new Error(`SSRF_PRIVATE_IP: "${hostname}" resolves to private IP "${resolvedAddress}"`);
}

// ─── Layer 4: Navigation Failure Detection ────────────────────────────────────

async function detectNavigationFailure(page, response, requests, url, isHomepage) {
  const signals = [];
  if (!response) signals.push('NO_RESPONSE');

  const status = response?.status() ?? null;
  if (status !== null && status >= 400) signals.push(`HTTP_${status}`);

  const responseUrl = response?.url() || '';
  if (responseUrl.startsWith('chrome-error://') || responseUrl.startsWith('about:') || responseUrl.startsWith('data:text/html'))
    signals.push('CHROME_INTERNAL_PAGE');

  const realRequests = requests.filter((r) => !r.url.startsWith('data:'));
  if (realRequests.length <= 1) signals.push('NO_NETWORK_ACTIVITY');

  const content = await page.content().catch(() => '');
  const ERROR_MARKERS = [
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT',
    'ERR_TIMED_OUT', 'ERR_ADDRESS_UNREACHABLE', 'ERR_INTERNET_DISCONNECTED',
    'ERR_EMPTY_RESPONSE', 'chrome-error://', 'neterror', 'jserrorpage', 'dns-not-found',
  ];
  if (ERROR_MARKERS.some((m) => content.includes(m))) signals.push('CHROMIUM_ERROR_PAGE');

  const threshold = isHomepage ? 1 : 2;
  if (signals.length >= threshold) throw new Error(`UNREACHABLE:${signals.join(',')}:${url}`);
  if (signals.length > 0) console.warn(`Weak signals [${signals.join(', ')}] for ${url} — continuing`);
}

// ─── Fingerprint + Behavioral Detector ───────────────────────────────────────
// Injected into every page before any other script runs.
// Patches ~20 browser APIs to silently record all privacy-relevant activity.
const FINGERPRINT_DETECTOR_SCRIPT = `
(function() {
  'use strict';

  window.__privacySignals = {
    canvasFingerprint:         false,
    webglFingerprint:          false,
    fontFingerprint:           false,
    audioFingerprint:          false,
    hardwareFingerprint:       false,
    mediaDeviceFingerprint:    false,
    batteryFingerprint:        false,
    timezoneProbed:            false,
    combinedFingerprintAttack: false,
    fingerprintClusters:       [],
    entropyBits:               0,
    collectedSignals:          [],
    keylogger:                 false,
    timingKeylogger:           false,
    mutationKeylogger:         false,
    autofillCapture:           false,
    formSnooping:              false,
      beaconCalls:               [],
      serviceWorker:             false,
      _userHasInteracted:        false,
      _rafCallCount:             0,
      _rafWindowStart:           null,
      _elementKeyListeners:      0,
  };

  const S = window.__privacySignals;

  // ── Fingerprint cluster tracker ─────────────────────────────────────────
  // 3+ distinct fingerprinting APIs within 500ms = combined attack
  const _recentFpCalls = [];
  function recordFingerprintCall(apiName) {
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    _recentFpCalls.push({ api: apiName, time: now });
    const cutoff = now - 500;
    while (_recentFpCalls.length && _recentFpCalls[0].time < cutoff) _recentFpCalls.shift();
    const distinct = new Set(_recentFpCalls.map(c => c.api));
    if (distinct.size >= 3) {
      const cluster = [...distinct].sort();
      const key = cluster.join(',');
      if (!S.fingerprintClusters.some(c => c.join(',') === key)) {
        S.fingerprintClusters.push(cluster);
        S.combinedFingerprintAttack = true;
      }
    }
  }

  function addEntropy(apiName, bits) {
    if (!S.collectedSignals.includes(apiName)) {
      S.collectedSignals.push(apiName);
      S.entropyBits += bits;
    }
    recordFingerprintCall(apiName);
  }

  // ── Canvas fingerprinting ───────────────────────────────────────────────
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...a) {
    S.canvasFingerprint = true; addEntropy('canvas', 7.0);
    return origToDataURL.apply(this, a);
  };
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function(...a) {
    S.canvasFingerprint = true; addEntropy('canvas', 7.0);
    return origGetImageData.apply(this, a);
  };

  // ── WebGL fingerprinting ────────────────────────────────────────────────
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...a) {
    if (/webgl/i.test(type)) { S.webglFingerprint = true; addEntropy('webgl', 6.5); }
    return origGetContext.apply(this, [type, ...a]);
  };
  if (typeof WebGLRenderingContext !== 'undefined') {
    const origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(...a) {
      S.webglFingerprint = true; addEntropy('webgl_params', 3.0);
      return origGetParam.apply(this, a);
    };
  }
  // WebGL2 is the modern default and used exclusively by many current trackers.
  // Patching only WebGLRenderingContext misses all WebGL2 fingerprint attempts.
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(...a) {
      S.webglFingerprint = true; addEntropy('webgl2_params', 3.0);
      return origGetParam2.apply(this, a);
    };
  }

  // ── Font fingerprinting ─────────────────────────────────────────────────
  if (document.fonts && document.fonts.check) {
    const origCheck = document.fonts.check.bind(document.fonts);
    document.fonts.check = function(...a) {
      S.fontFingerprint = true; addEntropy('fonts', 8.0);
      return origCheck(...a);
    };
  }

  // ── Audio fingerprinting ────────────────────────────────────────────────
  const _AC = window.AudioContext || window.webkitAudioContext;
  if (_AC && _AC.prototype.createAnalyser) {
    const orig = _AC.prototype.createAnalyser;
    _AC.prototype.createAnalyser = function(...a) {
      S.audioFingerprint = true; addEntropy('audio', 5.5);
      return orig.apply(this, a);
    };
  }
  if (typeof OfflineAudioContext !== 'undefined' && OfflineAudioContext.prototype.startRendering) {
    const orig = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function(...a) {
      S.audioFingerprint = true; addEntropy('audio', 5.5);
      return orig.apply(this, a);
    };
  }

  // ── Hardware fingerprinting ─────────────────────────────────────────────
  ['deviceMemory', 'hardwareConcurrency'].forEach(function(prop) {
    const desc = prop in navigator ? Object.getOwnPropertyDescriptor(Navigator.prototype, prop) : null;
    if (!desc || !desc.get) return;
    Object.defineProperty(Navigator.prototype, prop, {
      get: function() { S.hardwareFingerprint = true; addEntropy('hardware', 3.0); return desc.get.call(this); },
                          configurable: true,
    });
  });

  // ── Media device enumeration ────────────────────────────────────────────
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    const orig = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = function() {
      S.mediaDeviceFingerprint = true; addEntropy('media_devices', 4.5);
      return orig();
    };
  }

  // ── Battery API ─────────────────────────────────────────────────────────
  if (navigator.getBattery) {
    const orig = navigator.getBattery.bind(navigator);
    navigator.getBattery = function() {
      S.batteryFingerprint = true; addEntropy('battery', 4.0);
      return orig();
    };
  }

  // ── Screen property fingerprinting ────────────────────────────────────
  // Screen dimensions (width, height, colorDepth, pixelDepth) are a standard
  // high-entropy fingerprinting input. Legitimate page rendering never needs
  // to read these via property getters directly on Screen.prototype.
  if (typeof Screen !== 'undefined') {
    ['width', 'height', 'colorDepth', 'pixelDepth', 'availWidth', 'availHeight'].forEach(function(prop) {
      const desc = Object.getOwnPropertyDescriptor(Screen.prototype, prop);
      if (!desc || !desc.get) return;
      Object.defineProperty(Screen.prototype, prop, {
        get: function() { S.hardwareFingerprint = true; addEntropy('screen', 2.5); return desc.get.call(this); },
        configurable: true,
      });
    });
  }

  // ── Network Information API fingerprinting ──────────────────────────────
  // navigator.connection (effectiveType, rtt, downlink) is used to bucket
  // users into network profiles, adding ~2 bits of fingerprint entropy.
  if (navigator.connection) {
    ['effectiveType', 'rtt', 'downlink'].forEach(function(prop) {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator.connection), prop);
      if (!desc || !desc.get) return;
      Object.defineProperty(Object.getPrototypeOf(navigator.connection), prop, {
        get: function() { S.hardwareFingerprint = true; addEntropy('connection', 2.0); return desc.get.call(this); },
        configurable: true,
      });
    });
  }

  // ── Timezone probing ────────────────────────────────────────────────────
  const origResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  Intl.DateTimeFormat.prototype.resolvedOptions = function(...a) {
    S.timezoneProbed = true; addEntropy('timezone', 2.0);
    return origResolved.apply(this, a);
  };

  // ── Timing-based keystroke capture ──────────────────────────────────────
  // A rAF loop running at 55+ calls/sec continuously = timing attack pattern
  const origRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = function(cb) {
    S._rafCallCount++;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (!S._rafWindowStart) S._rafWindowStart = now;
    if (now - S._rafWindowStart > 1000) {
      if (S._rafCallCount >= 55) S.timingKeylogger = true;
      S._rafCallCount = 0; S._rafWindowStart = now;
    }
    return origRAF.call(window, cb);
  };

  // ── Global keylogger ────────────────────────────────────────────────────
  const origAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, ...a) {
    if (type === 'keydown' || type === 'keypress' || type === 'keyup') {
      if (this === document || this === window) S.keylogger = true;
      else { S._elementKeyListeners++; if (S._elementKeyListeners >= 3) S.keylogger = true; }
    }
    return origAEL.apply(this, [type, listener, ...a]);
  };

  // ── MutationObserver form harvesting ────────────────────────────────────
  const OrigMO = window.MutationObserver;
  if (OrigMO) {
    window.MutationObserver = function(cb) {
      return new OrigMO(function(mutations, observer) {
        for (const m of mutations) {
          for (const node of (m.addedNodes || [])) {
            if (node.nodeType !== 1) continue;
            const tag = node.tagName || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' ||
              (typeof node.querySelectorAll === 'function' &&
              node.querySelectorAll('input,textarea').length > 0)) {
              S.mutationKeylogger = true;
              }
          }
        }
        return cb.call(this, mutations, observer);
      });
    };
    window.MutationObserver.prototype = OrigMO.prototype;
  }

  // ── Autofill capture detection ──────────────────────────────────────────
  document.addEventListener('click',      function() { S._userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('keydown',    function() { S._userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('touchstart', function() { S._userHasInteracted = true; }, { once: true, capture: true });

  const origValGet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get;
  if (origValGet) {
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      get: function() {
        if (!S._userHasInteracted) S.autofillCapture = true;
        if (this.type === 'hidden') S.formSnooping = true;
        return origValGet.call(this);
      },
      configurable: true,
    });
  }

  // Bulk input enumeration = harvesting pattern
  const origQSA = document.querySelectorAll.bind(document);
  document.querySelectorAll = function(sel) {
    const res = origQSA(sel);
    const s = (sel || '').toLowerCase().trim();
    if ((s === 'input' || s === 'textarea' || s === 'input,textarea' || s === 'input, textarea') && res.length >= 3)
      S.formSnooping = true;
    return res;
  };

  // ── Beacon API ──────────────────────────────────────────────────────────
  // Guard: sendBeacon is absent in some browser contexts and extensions may
  // remove it. Calling .bind() on undefined would throw and break the injected
  // script, silently disabling ALL detections that follow.
  if (navigator.sendBeacon) {
  const origBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function(url, data) {
    S.beaconCalls.push({ url: url.toString().slice(0, 200), hasData: !!data });
    return origBeacon(url, data);
  };
  } // end sendBeacon guard

  // ── Service Worker ──────────────────────────────────────────────────────
  if (navigator.serviceWorker) {
    const origSW = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function(...a) { S.serviceWorker = true; return origSW(...a); };
  }

})();
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchSitemapUrls(baseUrl, page) {
  try {
    const res = await page.request.get(new URL('/sitemap.xml', baseUrl).href, { timeout: 5000 });
    if (!res.ok()) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)]
    .map((m) => m[1].trim())
    .filter((u) => { try { new URL(u); return true; } catch { return false; } });
  } catch { return []; }
}

const HIGH_VALUE_PATHS = [
  { pattern: /\/(login|signin|sign-in|signup|sign-up|register|auth|sso)/i, score: 10 },
  { pattern: /\/(checkout|payment|cart|order|billing|purchase)/i,          score: 10 },
  { pattern: /\/(account|profile|settings|preferences|dashboard)/i,        score: 8  },
  { pattern: /\/(contact|support|help|feedback|submit)/i,                   score: 6  },
  { pattern: /\/(article|post|blog|news|story)/i,                           score: 4  },
  { pattern: /\/(about|team|company|privacy|terms|legal)/i,                 score: 3  },
];

function selectPagesToCrawl(internalLinks, sitemapUrls, baseHostname, max, visitedUrls = new Set()) {
  const candidates = new Set([...sitemapUrls, ...internalLinks]);
  const scored = [];
  for (const url of candidates) {
    try {
      if (visitedUrls.has(url)) continue; // don't re-crawl pages we already visited
      const u = new URL(url);
      if (u.hostname !== baseHostname) continue;
      const path = u.pathname.toLowerCase();
      if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|css|js|xml|json|ico|woff2?|mp4|webp|avif)$/.test(path)) continue;
      let pageScore = 0;
      for (const p of HIGH_VALUE_PATHS) { if (p.pattern.test(path)) { pageScore = p.score; break; } }
      pageScore -= path.split('/').filter(Boolean).length * 0.5;
      if (u.search) pageScore -= 2;
      scored.push({ url, score: pageScore });
    } catch { /* skip */ }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.url);
}

function analyzeCSP(headers) {
  const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
  if (!csp) return { present: false, trustedDomains: [], allowsUnsafeInline: false, allowsUnsafeEval: false };
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) || '';
  return {
    present:           true,
    trustedDomains:    [...scriptSrc.matchAll(/https?:\/\/([^\s'"]+)/g)].map((m) => m[1]),
    allowsUnsafeInline: scriptSrc.includes("'unsafe-inline'"),
    allowsUnsafeEval:   scriptSrc.includes("'unsafe-eval'"),
    rawPolicy:          csp.slice(0, 500),
  };
}

// Payload-level PII / fingerprint detection
const PAYLOAD_TRACKING_PARAMS = [
  'uid','user_id','userid','cid','client_id','tid','tracking_id',
'fbclid','gclid','_ga','utm_source','utm_medium','utm_campaign',
'pixel_id','event_id','visitor_id','session_id',
];

const PAYLOAD_SENSITIVE_PATTERNS = [
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,    label: 'email',           risk: 'high'     },
{ pattern: /(?:em|email|hashed_email|sha256)=[a-f0-9]{64}/i,      label: 'hashed_email',    risk: 'high'     },
{ pattern: /canvas[_-]?(hash|fp|print|id)=[a-zA-Z0-9+/]{20,}/i,  label: 'canvas_hash',     risk: 'critical' },
{ pattern: /session[_-]?id=[a-zA-Z0-9]{16,}/i,                    label: 'session_id',      risk: 'high'     },
{ pattern: /"(rrweb|recording|replay|snapshot)":/i,                label: 'session_replay',  risk: 'critical' },
{ pattern: /user[_-]?id=[a-zA-Z0-9\-]{8,36}/i,                   label: 'user_id',         risk: 'high'     },
{ pattern: /\["[a-z]",\s*\d+\]/,                                  label: 'keystroke_array', risk: 'critical' },
{ pattern: /keylog|keystroke|typingdata|kl=/i,                    label: 'keystroke_id',    risk: 'critical' },
{ pattern: /"(events|interactions|moves|scrolls)":\s*\[/,         label: 'behavioral_data', risk: 'medium'   },
];

function inspectRequestPayload(url, postData) {
  const trackingParams   = [];
  const sensitivePayload = [];

  try {
    const u = new URL(url);
    for (const p of PAYLOAD_TRACKING_PARAMS) { if (u.searchParams.has(p)) trackingParams.push(p); }
  } catch { /* skip */ }

  const body = typeof postData === 'string' ? postData : '';
  if (body) {
    for (const p of PAYLOAD_TRACKING_PARAMS) {
      if (!trackingParams.includes(p) && (body.includes(p + '=') || body.includes(`"${p}"`)))
        trackingParams.push(p);
    }
  }

  // Check URL and body separately.
  // Concatenating them (url + ' ' + body) risks a regex matching across the
  // boundary between the two strings, producing false positives on patterns
  // like /session_id=[a-zA-Z0-9]{16,}/i when the id happens to span the join.
  for (const p of PAYLOAD_SENSITIVE_PATTERNS) {
    if (p.pattern.test(url) || (body && p.pattern.test(body)))
      sensitivePayload.push({ label: p.label, risk: p.risk });
  }

  return { trackingParams, sensitivePayload };
}

// ─── ASN corporate inference ──────────────────────────────────────────────────

const ASN_TO_CORPORATION = {
  'AS15169': 'Alphabet (Google)', 'AS396982': 'Alphabet (Google Cloud)',
  'AS32934': 'Meta Platforms',
  'AS8075':  'Microsoft',
  'AS16509': 'Amazon (AWS)',       'AS14618': 'Amazon (AWS)',
  'AS54113': 'Fastly',
  'AS13335': 'Cloudflare',
  'AS63293': 'Salesforce',
  'AS20940': 'Akamai',             'AS16625': 'Akamai',
  'AS2906':  'Netflix',
  'AS36351': 'SoftLayer (IBM)',
};

const _asnCache    = new Map();
const ASN_CACHE_MAX = 500; // ~80 KB worst-case; evict oldest when full

export async function inferCorporateOwnerFromDomain(domain) {
  if (_asnCache.has(domain)) return _asnCache.get(domain);

  // FIFO eviction: Maps preserve insertion order; deleting the first key
  // removes the oldest entry. Keeps memory bounded without a full LRU.
  if (_asnCache.size >= ASN_CACHE_MAX) {
    _asnCache.delete(_asnCache.keys().next().value);
  }
  try {
    const resolver = new Resolver();
    resolver.setServers(['8.8.8.8']);

    // Step 1: IP → ASN
    // Query:   {reversed-ip}.origin.asn.cymru.com
    // Returns: "ASN | IP_PREFIX | COUNTRY | RIR | ALLOCATION_DATE"
    // parts[4] is the IP block allocation DATE (e.g. "2012-05-24") — NOT an org name.
    const addrs = await resolver.resolve4(domain).catch(() => null);
    if (!addrs?.[0]) { _asnCache.set(domain, null); return null; }
    const reversed = addrs[0].split('.').reverse().join('.');
    const originTxt = await Promise.race([
      resolver.resolveTxt(`${reversed}.origin.asn.cymru.com`),
                                         new Promise((_, r) => setTimeout(() => r(new Error('ASN_TIMEOUT')), 3000)),
    ]).catch(() => null);
    if (!originTxt?.[0]) { _asnCache.set(domain, null); return null; }
    const originParts = originTxt[0][0].split('|').map(s => s.trim());
    const asn = originParts[0]; // e.g. "15169"

    // If we already know this ASN from our local table, use that — no second query needed.
    if (ASN_TO_CORPORATION[asn]) {
      const result = { ip: addrs[0], asn, orgName: ASN_TO_CORPORATION[asn], corporation: ASN_TO_CORPORATION[asn] };
      _asnCache.set(domain, result);
      return result;
    }

    // Step 2: ASN → Org name (only for unknown ASNs)
    // Query:   AS{asn}.asn.cymru.com
    // Returns: "ASN | BGP_PREFIX | COUNTRY | RIR | DATE | ORG_NAME"
    // parts[5] is the actual registered org name (e.g. "EDGECAST - Verizon Digital Media, US")
    const asnTxt = await Promise.race([
      resolver.resolveTxt(`AS${asn}.asn.cymru.com`),
                                      new Promise((_, r) => setTimeout(() => r(new Error('ASN_ORG_TIMEOUT')), 3000)),
    ]).catch(() => null);

    let orgName = 'Unknown';
    if (asnTxt?.[0]) {
      const asnParts = asnTxt[0][0].split('|').map(s => s.trim());
      const raw = asnParts[5] || ''; // "GOOGLE - Google LLC, US"
      // Strip trailing country code: "GOOGLE - Google LLC, US" → "GOOGLE - Google LLC"
      orgName = raw.split(',')[0].trim() || 'Unknown';
    }

    const result = { ip: addrs[0], asn, orgName, corporation: orgName };
    _asnCache.set(domain, result);
    return result;
  } catch { _asnCache.set(domain, null); return null; }
}

// ─── Page context detection ───────────────────────────────────────────────────

async function detectPageContext(page) {
  return page.evaluate(() => {
    const inputs          = [...document.querySelectorAll('input')];
    const bodyText        = document.body?.innerText?.slice(0, 3000) || '';
    const hasPasswordField = inputs.some(i => i.type === 'password');
    const hasLoginForm    = hasPasswordField || (
      !!document.querySelector('form') &&
      /login|signin|sign.in|log.in|username|email|password/i.test(bodyText)
    );
    const paymentRx = /credit.card|card.number|cvv|expir|billing|checkout|payment/i;
    const hasPaymentForm = inputs.some(i =>
    paymentRx.test(i.name || i.placeholder || i.id || '')
    ) || paymentRx.test(bodyText);
    return { hasLoginForm, hasPasswordField, hasPaymentForm };
  }).catch(() => ({ hasLoginForm: false, hasPasswordField: false, hasPaymentForm: false }));
}

// ─── Single page crawler ──────────────────────────────────────────────────────

async function crawlSinglePage(page, url, baseHostname, isHomepage = false) {
  const requests       = [];
  const webSockets     = [];
  const redirectChains = [];
  const sensitivePayloadFound = [];

  // Split timeouts: navigation (goto, waitForNavigation) legitimately needs
  // the full 25s window; evaluate() and waitForSelector() should fail faster.
  // Using a single setDefaultTimeout(25s) for everything means a hung
  // page.evaluate() holds the worker for 25s before throwing -- too long.
  page.setDefaultNavigationTimeout(TIMEOUTS.navigation); // 25s for page loads
  page.setDefaultTimeout(5_000);                         // 5s for evaluate/waitFor*

  // Block resource types that carry no privacy signal — 40–60% faster
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) return route.abort();
    return route.continue();
  });

  page.on('request', (req) => {
    const reqUrl   = req.url();
    const method   = req.method();
    const rawPost  = method === 'POST' ? (req.postData() ?? '') : '';
    const postData = rawPost.slice(0, MAX_POST_BODY_SIZE);

    const { trackingParams, sensitivePayload } = inspectRequestPayload(reqUrl, postData);
    if (sensitivePayload.length) sensitivePayloadFound.push(...sensitivePayload);

    requests.push({ url: reqUrl, method, resourceType: req.resourceType(), trackingParams, sensitivePayload, hasPostData: !!rawPost });
  });

  page.on('response', (res) => {
    const s = res.status();
    if (s >= 300 && s < 400)
      redirectChains.push({ from: res.url(), to: res.headers()['location'] || '?', status: s });
  });

  page.on('websocket', (ws) => { webSockets.push({ url: ws.url() }); });

  let response = null;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.navigation });
  } catch (err) {
    // Reclassify raw Playwright / Chromium net:: errors into clean, monitorable
    // codes. The friendlyError() mapper in routes/analyze.js then converts these
    // to user-readable messages without leaking internal detail.
    const m = err.message || '';
    if (/TimeoutError|timeout/i.test(m))                throw new Error(`UNREACHABLE:NAVIGATION_TIMEOUT:${url}`);
    if (/ERR_NAME_NOT_RESOLVED/i.test(m))               throw new Error(`DNS_FAILED:ENOTFOUND:${url}`);
    if (/ERR_CONNECTION_REFUSED/i.test(m))              throw new Error(`UNREACHABLE:CONNECTION_REFUSED:${url}`);
    if (/ERR_CONNECTION_TIMED_OUT/i.test(m))            throw new Error(`UNREACHABLE:CONNECTION_TIMEOUT:${url}`);
    if (/ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED/i.test(m)) throw new Error(`UNREACHABLE:ADDRESS_UNREACHABLE:${url}`);
    if (/ERR_CERT_|SSL_ERROR|ERR_SSL/i.test(m))         throw new Error(`UNREACHABLE:TLS_ERROR:${url}`);
    if (/ERR_EMPTY_RESPONSE/i.test(m))                  throw new Error(`UNREACHABLE:EMPTY_RESPONSE:${url}`);
    if (/ERR_ABORTED/i.test(m))                         throw new Error(`UNREACHABLE:ABORTED:${url}`);
    if (/ERR_BLOCKED_BY_CLIENT|ERR_BLOCKED_BY_RESPONSE/i.test(m)) throw new Error(`UNREACHABLE:BLOCKED:${url}`);
    // Fallback: preserve original message for unknown errors
    throw new Error(`UNREACHABLE:PLAYWRIGHT_THROW:${m}`);
  }

  // waitForLoadState can reject (page already unloaded, context closed mid-crawl).
  // Without .catch(), that rejection would propagate out of Promise.race and
  // abort the crawl even though the page may have loaded successfully.
  await Promise.race([
    page.waitForLoadState('load').catch(() => {}),
    page.waitForTimeout(TIMEOUTS.pageSettle),
  ]);

  // Let post-load JS execute. Race against networkidle so fast pages don't
  // always pay the full TIMEOUTS.jsSettle penalty.
  await Promise.race([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.waitForTimeout(TIMEOUTS.jsSettle),
  ]);
  await detectNavigationFailure(page, response, requests, url, isHomepage);

  const fingerprintSignals = await page.evaluate(() => window.__privacySignals || {}).catch(() => ({}));
  const context            = await detectPageContext(page);

  const scriptData = await page.evaluate(() => ({
    external: [...document.querySelectorAll('script[src]')].map((s) => s.src),
                                                inline:   [...document.querySelectorAll('script:not([src])')].map((s) => ({
                                                  length:              s.innerText.length,
                                                  hasTrackerSignature: /gtag|fbq|_hsq|mixpanel|amplitude|heap\.track|dataLayer/.test(s.innerText),
                                                })),
  })).catch(() => ({ external: [], inline: [] }));

  const storageData = await page.evaluate(() => {
    const ls = {}, ss = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k)?.slice(0, 100); } } catch {}
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k)?.slice(0, 100); } } catch {}
    return { localStorage: ls, sessionStorage: ss };
  }).catch(() => ({ localStorage: {}, sessionStorage: {} }));

  const internalLinks = await page.evaluate((h) =>
  [...document.querySelectorAll('a[href]')]
  .map((a) => { try { return new URL(a.href).href; } catch { return null; } })
  .filter((href) => { try { return href && new URL(href).hostname === h; } catch { return false; } })
  , baseHostname).catch(() => []);

  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) || '').catch(() => '');

  return { url, requests, webSockets, redirectChains, fingerprintSignals, context, sensitivePayloadFound, scriptData, storageData, internalLinks: [...new Set(internalLinks)], pageText };
}

// ─── Parallel sub-page crawler ────────────────────────────────────────────────

async function crawlPagesParallel(pagesToCrawl, context, baseHostname, concurrency) {
  const results = [];
  const queue   = [...pagesToCrawl];
  async function worker() {
    while (queue.length) {
      const pageUrl = queue.shift();
      let page;
      try {
        page         = await context.newPage();
        const result = await crawlSinglePage(page, pageUrl, baseHostname, false);
        results.push(result);
      } catch (err) {
        console.warn(`Skipping ${pageUrl}: ${err.message}`);
      } finally {
        // Always close the page — even when crawlSinglePage throws.
        // Without this, a failed crawl leaks a Playwright Page handle,
        // eventually exhausting the browser context's page limit.
        await page?.close().catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, pagesToCrawl.length)) }, worker));
  return results;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function crawlWebsite(rawUrl) {
  const url      = normalizeUrl(rawUrl);
  const hostname = new URL(url).hostname;
  const dnsResult = await resolveDns(hostname);
  assertNotPrivate(hostname, dnsResult.address);

  const browser = await chromium.launch({
    headless:       true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });

  const ctx = await browser.newContext({
    userAgent:      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                                       serviceWorkers: 'block',
  });

  await ctx.addInitScript(FINGERPRINT_DETECTOR_SCRIPT);

  const allPageResults = [];
  let   responseHeaders = {};

  try {
    // ── Homepage ────────────────────────────────────────────────────────────
    const homePage = await ctx.newPage();

    // Capture the main document's response headers for CSP analysis.
    // Exact URL match misses common redirect patterns:
    //   http://example.com  →  https://example.com
    //   example.com         →  www.example.com
    // Instead, accept the first 2xx response whose hostname matches the base
    // hostname (with or without www), and ignore sub-resource responses.
    let headersCaptured = false;
    homePage.on('response', (res) => {
      if (headersCaptured) return;
      if (res.status() < 200 || res.status() >= 300) return;
      try {
        const resHost = new URL(res.url()).hostname;
        const base    = hostname.replace(/^www./, '');
        if (resHost === base || resHost === `www.${base}`) {
          responseHeaders  = res.headers();
          headersCaptured  = true;
        }
      } catch { /* non-parseable URL — skip */ }
    });

    const homeResult = await crawlSinglePage(homePage, url, hostname, true);
    allPageResults.push(homeResult);

    const cspAnalysis  = analyzeCSP(responseHeaders);
    const sitemapUrls  = await fetchSitemapUrls(url, homePage);
    // Pass the homepage URL so it is excluded from sub-page candidates.
    // Self-referential links (<a href="/">) are nearly universal; without this
    // the homepage would appear in internalLinks and be scored and re-crawled.
    const visitedUrls  = new Set([url, url.replace(/\/$/, ''), url + '/']);
    const pagesToCrawl = selectPagesToCrawl(homeResult.internalLinks, sitemapUrls, hostname, MAX_PAGES - 1, visitedUrls);
    await homePage.close();

    // ── Sub-pages (parallel) ────────────────────────────────────────────────
    const subResults = await crawlPagesParallel(pagesToCrawl, ctx, hostname, CRAWL_CONCURRENCY);
    allPageResults.push(...subResults);

    // ── Aggregate ────────────────────────────────────────────────────────────
    const cookies       = await ctx.cookies();
    const allRequests   = allPageResults.flatMap((p) => p.requests);
    const allScriptSrcs = [...new Set(allPageResults.flatMap((p) => p.scriptData.external))];

    const fp = {
      canvasFingerprint:         allPageResults.some((p) => p.fingerprintSignals.canvasFingerprint),
      webglFingerprint:          allPageResults.some((p) => p.fingerprintSignals.webglFingerprint),
      fontFingerprint:           allPageResults.some((p) => p.fingerprintSignals.fontFingerprint),
      audioFingerprint:          allPageResults.some((p) => p.fingerprintSignals.audioFingerprint),
      hardwareFingerprint:       allPageResults.some((p) => p.fingerprintSignals.hardwareFingerprint),
      mediaDeviceFingerprint:    allPageResults.some((p) => p.fingerprintSignals.mediaDeviceFingerprint),
      batteryFingerprint:        allPageResults.some((p) => p.fingerprintSignals.batteryFingerprint),
      timezoneProbed:            allPageResults.some((p) => p.fingerprintSignals.timezoneProbed),
      combinedFingerprintAttack: allPageResults.some((p) => p.fingerprintSignals.combinedFingerprintAttack),
      fingerprintClusters:       allPageResults.flatMap((p) => p.fingerprintSignals.fingerprintClusters || []),
      entropyBits:               Math.max(...allPageResults.map((p) => p.fingerprintSignals.entropyBits || 0), 0),
      keylogger:                 allPageResults.some((p) => p.fingerprintSignals.keylogger),
      timingKeylogger:           allPageResults.some((p) => p.fingerprintSignals.timingKeylogger),
      mutationKeylogger:         allPageResults.some((p) => p.fingerprintSignals.mutationKeylogger),
      autofillCapture:           allPageResults.some((p) => p.fingerprintSignals.autofillCapture),
      formSnooping:              allPageResults.some((p) => p.fingerprintSignals.formSnooping),
        serviceWorker:             allPageResults.some((p) => p.fingerprintSignals.serviceWorker),
        beaconCalls:               allPageResults.flatMap((p) => p.fingerprintSignals.beaconCalls || []),
    };

    const mergedContext = {
      hasLoginForm:     allPageResults.some((p) => p.context?.hasLoginForm),
      hasPasswordField: allPageResults.some((p) => p.context?.hasPasswordField),
      hasPaymentForm:   allPageResults.some((p) => p.context?.hasPaymentForm),
    };

    const externalDomains = new Set();
    for (const req of allRequests) {
      try { const h = new URL(req.url).hostname; if (h !== hostname && !h.endsWith(`.${hostname}`)) externalDomains.add(h); }
      catch { /* skip */ }
    }

    // ASN lookup for unknown external domains (async, best-effort, max 10)
    const asnResults = {};
    await Promise.allSettled([...externalDomains].slice(0, 10).map(async (d) => {
      const r = await inferCorporateOwnerFromDomain(d).catch(() => null);
      if (r) asnResults[d] = r;
    }));

      return {
        url,
        isHttps:              url.startsWith('https://'),
        scriptSrcs:           allScriptSrcs,
        cookies,
        externalDomains:      [...externalDomains],
        allRequestedUrls:     [...new Set(allRequests.map((r) => r.url))],
        allRequests,
        fingerprinting:       fp,
        context:              mergedContext,
        sensitivePayloads:    allPageResults.flatMap((p) => p.sensitivePayloadFound),
        storageData:          allPageResults[0]?.storageData || {},
        trackingParamsFound:  [...new Set(allRequests.flatMap((r) => r.trackingParams))],
        webSockets:           [...new Set(allPageResults.flatMap((p) => p.webSockets).map((ws) => ws.url))],
        redirectChains:       allPageResults.flatMap((p) => p.redirectChains),
        inlineTrackerScripts: allPageResults.flatMap((p) => p.scriptData.inline.filter((s) => s.hasTrackerSignature)).length,
        cspAnalysis,
        responseHeaders,
        pagesCrawled:         allPageResults.map((p) => p.url),
        pageText:             allPageResults.map((p) => p.pageText).join(' ').slice(0, 15000),
        asnResults,
      };
  } finally {
    await browser.close();
  }
}