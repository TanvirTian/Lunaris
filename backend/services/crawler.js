import { chromium } from 'playwright';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * ADVANCED Privacy Crawler
 * ─────────────────────────────────────────────────────────────────────────────
 * Features:
 *  1.  URL normalization + validation (no-dot check, protocol check)
 *  2.  DNS pre-resolution (ENOTFOUND before browser launches)
 *  3.  SSRF protection (blocks private IPs + dangerous hostnames)
 *  4.  Multi-signal navigation failure detection (5 signals)
 *  5.  DOM scripts + inline script analysis
 *  6.  Cookie collection + attribute analysis
 *  7.  LocalStorage / SessionStorage extraction
 *  8.  Canvas fingerprinting detection
 *  9.  WebGL fingerprinting detection
 * 10.  Font fingerprinting detection
 * 11.  Keylogger / form snooping detection
 * 12.  Network request + payload inspection
 * 13.  Redirect chain tracking
 * 14.  WebSocket connection monitoring
 * 15.  Beacon API (navigator.sendBeacon) detection
 * 16.  Service Worker detection
 * 17.  CSP header analysis
 * 18.  Multi-page crawling (follows internal links)
 * 19.  Sitemap.xml parsing for smarter page selection
 * ─────────────────────────────────────────────────────────────────────────────
 */

// How many internal pages to crawl beyond the homepage
const MAX_PAGES = 4;

// Timeout constants (ms)
const TIMEOUTS = {
  dns:        5_000,   // DNS lookup — should be fast
  navigation: 25_000,  // Page load per page
  pageSettle: 6_000,   // Wait for JS after domcontentloaded
  jsSettle:   2_000,   // Extra settle time for trackers to fire
};

// ─── Layer 1: URL Normalization ───────────────────────────────────────────────

/**
 * Normalize and validate user-supplied URL input.
 * Throws descriptive errors for invalid input.
 * Called BEFORE DNS lookup or browser launch.
 */
export function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('URL_MISSING: no URL provided');
  }

  let input = raw.trim();
  if (!input) {
    throw new Error('URL_EMPTY: URL cannot be blank');
  }

  // Auto-prepend https:// if no scheme present
  if (!/^https?:\/\//i.test(input)) {
    input = 'https://' + input;
  }

  // Structural parse — catches everything malformed
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`URL_MALFORMED: "${input}" is not a valid URL`);
  }

  // Only http and https are supported
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`URL_INVALID_PROTOCOL: "${parsed.protocol}" is not supported`);
  }

  const hostname = parsed.hostname;

  // Hostname must exist
  if (!hostname || hostname.length < 1) {
    throw new Error('URL_INVALID_HOSTNAME: no hostname found');
  }

  // No dot in hostname = not a real domain (catches all random string inputs)
  // e.g. "ksgdsgfksdgfksdfg", "localhost", "hehehlxzjnlsjzhdflasjb"
  if (!hostname.includes('.')) {
    throw new Error(`URL_NO_TLD: "${hostname}" has no dot — not a valid domain`);
  }

  // Reject IP addresses as direct input (SSRF surface, validated separately)
  if (isIP(hostname)) {
    throw new Error(`URL_RAW_IP: direct IP addresses are not supported`);
  }

  return parsed.href; // canonical, normalized URL
}

// ─── Layer 2: DNS Pre-Resolution ─────────────────────────────────────────────

/**
 * Perform DNS lookup BEFORE launching Playwright.
 * Fails fast on non-existent domains without wasting browser resources.
 * Returns resolved IP address for SSRF validation.
 */
async function resolveDns(hostname) {
  const dnsPromise = lookup(hostname, { family: 0 }); // family:0 = accept IPv4 + IPv6
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('DNS_TIMEOUT: resolution took too long')), TIMEOUTS.dns)
  );

  try {
    const result = await Promise.race([dnsPromise, timeout]);
    return result; // { address: '...', family: 4|6 }
  } catch (err) {
    const msg = err.message || '';
    // ENOTFOUND = domain does not exist
    // ENODATA   = domain exists but has no A/AAAA records
    // ETIMEOUT  = DNS server not responding
    if (msg.includes('DNS_TIMEOUT') || err.code === 'ETIMEOUT') {
      throw new Error(`DNS_TIMEOUT: could not resolve "${hostname}" in time`);
    }
    throw new Error(`DNS_FAILED:${err.code || 'UNKNOWN'}: "${hostname}" does not exist or cannot be resolved`);
  }
}

// ─── Layer 3: SSRF Protection ─────────────────────────────────────────────────

/**
 * Private/reserved IP ranges that must never be crawled.
 * Prevents the crawler from being used to probe internal networks.
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,                                          // 127.0.0.0/8  loopback
  /^10\./,                                           // 10.0.0.0/8   RFC1918
  /^192\.168\./,                                     // 192.168.0.0/16 RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,                     // 172.16.0.0/12 RFC1918
  /^169\.254\./,                                     // 169.254.0.0/16 link-local
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,      // 100.64.0.0/10 CGNAT
  /^0\./,                                            // 0.0.0.0/8 "this" network
  /^::1$/,                                           // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,                               // IPv6 unique local fc00::/7
  /^fe[89ab][0-9a-f]:/i,                            // IPv6 link-local fe80::/10
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',   // GCP metadata service
  '169.254.169.254',             // AWS/GCP/Azure IMDS endpoint
]);

const BLOCKED_HOSTNAME_PATTERNS = [
  /\.local$/i,
  /\.internal$/i,
  /\.corp$/i,
  /\.lan$/i,
  /\.intranet$/i,
];

function assertNotPrivate(hostname, resolvedAddress) {
  // Block by hostname directly
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error(`SSRF_BLOCKED_HOSTNAME: "${hostname}" is a reserved hostname`);
  }

  // Block by hostname pattern
  if (BLOCKED_HOSTNAME_PATTERNS.some((p) => p.test(hostname))) {
    throw new Error(`SSRF_BLOCKED_PATTERN: "${hostname}" matches a private network pattern`);
  }

  // Block by resolved IP
  if (PRIVATE_IP_PATTERNS.some((p) => p.test(resolvedAddress))) {
    throw new Error(`SSRF_PRIVATE_IP: "${hostname}" resolves to private IP "${resolvedAddress}"`);
  }
}

// ─── Layer 4: Navigation Failure Detection ────────────────────────────────────

/**
 * Multi-signal analysis to detect if a page actually loaded real content.
 * Uses 5 independent signals — requires 2+ to declare hard failure,
 * preventing false positives on minimal-but-real pages.
 *
 * Signals:
 *  1. No response object from Playwright (Chromium ate the error)
 *  2. HTTP 4xx/5xx status code
 *  3. Response URL is a chrome-error:// or about: internal page
 *  4. Network request count ≤ 1 (error pages fire no sub-requests)
 *  5. Page content contains Chromium error page markers
 */
async function detectNavigationFailure(page, response, requests, url, isHomepage) {
  const signals = [];

  // Signal 1: No response at all = Chromium swallowed a hard error
  if (!response) {
    signals.push('NO_RESPONSE');
  }

  // Signal 2: HTTP error status
  const status = response?.status() ?? null;
  if (status !== null && status >= 400) {
    signals.push(`HTTP_${status}`);
  }

  // Signal 3: Response URL is an internal Chromium/browser error page
  const responseUrl = response?.url() || '';
  if (
    responseUrl.startsWith('chrome-error://') ||
    responseUrl.startsWith('about:') ||
    responseUrl.startsWith('data:text/html')
  ) {
    signals.push('CHROME_INTERNAL_PAGE');
  }

  // Signal 4: Real sites always load sub-resources (CSS, JS, images, fonts).
  // Chromium error pages fire exactly 1 request — the failed navigation itself.
  // Filter data: URIs which are always present.
  const realRequests = requests.filter((r) => !r.url.startsWith('data:'));
  if (realRequests.length <= 1) {
    signals.push('NO_NETWORK_ACTIVITY');
  }

  // Signal 5: Page content contains Chromium error page markers
  const content = await page.content().catch(() => '');
  const CHROMIUM_ERROR_MARKERS = [
    'ERR_NAME_NOT_RESOLVED',
    'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_TIMED_OUT',
    'ERR_TIMED_OUT',
    'ERR_ADDRESS_UNREACHABLE',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_EMPTY_RESPONSE',
    'chrome-error://',
    'neterror',           // Chromium's error page CSS class
    'jserrorpage',        // Firefox equivalent
    'dns-not-found',      // Some browser error page classes
  ];

  if (CHROMIUM_ERROR_MARKERS.some((marker) => content.includes(marker))) {
    signals.push('CHROMIUM_ERROR_PAGE');
  }

  // Verdict:
  // Homepage: 1+ signals is enough to fail — we need a real page
  // Sub-pages: require 2+ signals to avoid killing the whole scan for one broken sub-page
  const threshold = isHomepage ? 1 : 2;

  if (signals.length >= threshold) {
    throw new Error(`UNREACHABLE:${signals.join(',')}:${url}`);
  }

  if (signals.length > 0) {
    console.warn(`Weak failure signal(s) [${signals.join(', ')}] for ${url} — continuing`);
  }
}

// ─── Fingerprinting injection script ─────────────────────────────────────────
// Injected into every page BEFORE any other script runs.
// Patches browser APIs to silently record fingerprinting attempts.
const FINGERPRINT_DETECTOR_SCRIPT = `
  (function() {
    window.__privacySignals = {
      canvasFingerprint: false,
      webglFingerprint: false,
      fontFingerprint: false,
      keylogger: false,
      formSnooping: false,
      beaconCalls: [],
      serviceWorker: false,
    };

    // ── Canvas fingerprinting ──────────────────────────────────────────────
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      window.__privacySignals.canvasFingerprint = true;
      return origToDataURL.apply(this, args);
    };

    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      window.__privacySignals.canvasFingerprint = true;
      return origGetImageData.apply(this, args);
    };

    // ── WebGL fingerprinting ───────────────────────────────────────────────
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
        window.__privacySignals.webglFingerprint = true;
      }
      return origGetContext.apply(this, [type, ...args]);
    };

    // ── Font fingerprinting (document.fonts enumeration) ──────────────────
    if (document.fonts && document.fonts.check) {
      const origCheck = document.fonts.check.bind(document.fonts);
      document.fonts.check = function(...args) {
        window.__privacySignals.fontFingerprint = true;
        return origCheck(...args);
      };
    }

    // ── Global keylogger detection ─────────────────────────────────────────
    const origAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, ...args) {
      if (type === 'keydown' || type === 'keypress' || type === 'keyup') {
        if (this === document || this === window) {
          window.__privacySignals.keylogger = true;
        }
      }
      return origAddEventListener.apply(this, [type, listener, ...args]);
    };

    // ── Form field snooping (3rd party script accessing inputs) ───────────
    const origValueGetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get;
    if (origValueGetter) {
      Object.defineProperty(HTMLInputElement.prototype, 'value', {
        get: function() {
          window.__privacySignals.formSnooping = true;
          return origValueGetter.call(this);
        },
        configurable: true,
      });
    }

    // ── Beacon API tracking ────────────────────────────────────────────────
    const origSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      window.__privacySignals.beaconCalls.push({
        url: url.toString().slice(0, 200),
        hasData: !!data,
      });
      return origSendBeacon(url, data);
    };

    // ── Service Worker registration ────────────────────────────────────────
    if (navigator.serviceWorker) {
      const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function(...args) {
        window.__privacySignals.serviceWorker = true;
        return origRegister(...args);
      };
    }
  })();
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch and parse sitemap.xml to find real content pages.
 */
async function fetchSitemapUrls(baseUrl, page) {
  try {
    const sitemapUrl = new URL('/sitemap.xml', baseUrl).href;
    const response = await page.request.get(sitemapUrl, { timeout: 5000 });
    if (!response.ok()) return [];
    const xml = await response.text();
    const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)];
    return matches
      .map((m) => m[1].trim())
      .filter((u) => { try { new URL(u); return true; } catch { return false; } });
  } catch {
    return [];
  }
}

/**
 * Pick the best internal pages to crawl.
 * Prefers meaningful paths over query-string-heavy URLs.
 */
function selectPagesToCrawl(internalLinks, sitemapUrls, baseHostname, max) {
  const candidates = new Set([...sitemapUrls, ...internalLinks]);
  const scored = [];

  for (const url of candidates) {
    try {
      const u = new URL(url);
      if (u.hostname !== baseHostname) continue;
      const path = u.pathname.toLowerCase();
      if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|css|js|xml|json|ico|woff2?)$/.test(path)) continue;
      const score = (u.search ? -2 : 0) + (path.split('/').filter(Boolean).length * -1);
      scored.push({ url, score });
    } catch { /* skip */ }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.url);
}

/**
 * Analyze CSP header for script execution policy.
 */
function analyzeCSP(headers) {
  const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
  if (!csp) return { present: false, trustedDomains: [], allowsUnsafeInline: false, allowsUnsafeEval: false };
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) || '';
  const trustedDomains = [...scriptSrc.matchAll(/https?:\/\/([^\s'"]+)/g)].map((m) => m[1]);
  return {
    present: true,
    trustedDomains,
    allowsUnsafeInline: scriptSrc.includes("'unsafe-inline'"),
    allowsUnsafeEval: scriptSrc.includes("'unsafe-eval'"),
    rawPolicy: csp.slice(0, 500),
  };
}

/**
 * Inspect request URL and POST body for tracking parameters.
 */
function inspectRequestPayload(url, postData) {
  const trackingParams = [
    'uid', 'user_id', 'userid', 'cid', 'client_id', 'tid', 'tracking_id',
    'fbclid', 'gclid', '_ga', 'utm_source', 'utm_medium', 'utm_campaign',
    'pixel_id', 'event_id', 'visitor_id', 'session_id',
  ];
  try {
    const u = new URL(url);
    const foundParams = [];
    for (const param of trackingParams) {
      if (u.searchParams.has(param)) foundParams.push(param);
    }
    if (postData) {
      const body = typeof postData === 'string' ? postData : '';
      for (const param of trackingParams) {
        if (body.includes(param + '=') || body.includes(`"${param}"`)) {
          if (!foundParams.includes(param)) foundParams.push(param);
        }
      }
    }
    return foundParams;
  } catch {
    return [];
  }
}

// ─── Single page crawler ──────────────────────────────────────────────────────

async function crawlSinglePage(page, url, baseHostname, isHomepage = false) {
  const requests = [];
  const webSockets = [];
  const redirectChains = [];

  // ── Network interception ───────────────────────────────────────────────────
  page.on('request', (req) => {
    const reqUrl = req.url();
    const method = req.method();
    const postData = method === 'POST' ? req.postData() : null;
    requests.push({
      url: reqUrl,
      method,
      resourceType: req.resourceType(),
      trackingParams: inspectRequestPayload(reqUrl, postData),
      hasPostData: !!postData,
    });
  });

  // ── Redirect chain tracking ────────────────────────────────────────────────
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 300 && status < 400) {
      redirectChains.push({ from: res.url(), to: res.headers()['location'] || '?', status });
    }
  });

  // ── WebSocket monitoring ───────────────────────────────────────────────────
  page.on('websocket', (ws) => {
    webSockets.push({ url: ws.url() });
  });

  // ── Navigation ────────────────────────────────────────────────────────────
  // When Playwright itself throws (DNS error, connection refused, timeout),
  // there is no response object — this is the most reliable hard failure signal.
  let response = null;

  try {
    response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.navigation,
    });
  } catch (err) {
    // Playwright threw before any response — definite hard failure.
    // Don't swallow this — re-throw immediately as UNREACHABLE.
    throw new Error(`UNREACHABLE:PLAYWRIGHT_THROW:${err.message}`);
  }

  // Wait for JS to settle before checking signals
  await Promise.race([
    page.waitForLoadState('load'),
    page.waitForTimeout(TIMEOUTS.pageSettle),
  ]);
  await page.waitForTimeout(TIMEOUTS.jsSettle);

  // ── Multi-signal failure detection ────────────────────────────────────────
  // Run AFTER waiting so all network requests have been collected.
  await detectNavigationFailure(page, response, requests, url, isHomepage);

  // ── Collect fingerprinting signals ────────────────────────────────────────
  const fingerprintSignals = await page.evaluate(() =>
    window.__privacySignals || {}
  ).catch(() => ({}));

  // ── Extract scripts ───────────────────────────────────────────────────────
  const scriptData = await page.evaluate(() => {
    const external = [...document.querySelectorAll('script[src]')].map((s) => s.src);
    const inline = [...document.querySelectorAll('script:not([src])')].map((s) => ({
      length: s.innerText.length,
      hasTrackerSignature: /gtag|fbq|_hsq|mixpanel|amplitude|heap\.track|dataLayer/.test(s.innerText),
    }));
    return { external, inline };
  }).catch(() => ({ external: [], inline: [] }));

  // ── LocalStorage / SessionStorage ─────────────────────────────────────────
  const storageData = await page.evaluate(() => {
    const ls = {};
    const ss = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        ls[key] = localStorage.getItem(key)?.slice(0, 100);
      }
    } catch {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        ss[key] = sessionStorage.getItem(key)?.slice(0, 100);
      }
    } catch {}
    return { localStorage: ls, sessionStorage: ss };
  }).catch(() => ({ localStorage: {}, sessionStorage: {} }));

  // ── Internal links ────────────────────────────────────────────────────────
  const internalLinks = await page.evaluate((hostname) => {
    return [...document.querySelectorAll('a[href]')]
      .map((a) => { try { return new URL(a.href).href; } catch { return null; } })
      .filter((href) => {
        if (!href) return false;
        try { return new URL(href).hostname === hostname; } catch { return false; }
      });
  }, baseHostname).catch(() => []);

  // ── Page text ─────────────────────────────────────────────────────────────
  const pageText = await page.evaluate(() =>
    document.body?.innerText?.slice(0, 5000) || ''
  ).catch(() => '');

  return {
    url,
    requests,
    webSockets,
    redirectChains,
    fingerprintSignals,
    scriptData,
    storageData,
    internalLinks: [...new Set(internalLinks)],
    pageText,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Full crawl pipeline with all validation layers.
 *
 * Flow:
 *   normalizeUrl → DNS lookup → SSRF check → Playwright crawl → aggregate
 *
 * Throws on any failure — never returns empty/poisoned data silently.
 */
export async function crawlWebsite(rawUrl) {
  // ── Layer 1: URL Normalization ─────────────────────────────────────────────
  // normalizeUrl throws URL_* errors for bad input before any network call.
  const url = normalizeUrl(rawUrl);
  const hostname = new URL(url).hostname;

  // ── Layer 2: DNS Pre-Resolution ───────────────────────────────────────────
  // Fails fast with DNS_FAILED before spending 500ms+ launching Chromium.
  const dnsResult = await resolveDns(hostname);

  // ── Layer 3: SSRF Protection ──────────────────────────────────────────────
  // Blocks private IPs, localhost, internal hostnames.
  assertNotPrivate(hostname, dnsResult.address);

  // ── Browser setup ─────────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    serviceWorkers: 'block',
  });

  // Inject fingerprint detector before any page script runs
  await context.addInitScript(FINGERPRINT_DETECTOR_SCRIPT);

  const baseHostname = hostname;
  const allPageResults = [];
  let responseHeaders = {};
  let cspAnalysis = {};

  try {
    // ── Page 1: Homepage ───────────────────────────────────────────────────
    const homePage = await context.newPage();

    // Capture response headers from the main document
    homePage.on('response', (res) => {
      if (res.url() === url || res.url() === url + '/') {
        responseHeaders = res.headers();
      }
    });

    // isHomepage=true: any failure throws immediately, no soft landing
    const homeResult = await crawlSinglePage(homePage, url, baseHostname, true);
    allPageResults.push(homeResult);

    // ── CSP analysis from homepage headers ────────────────────────────────
    cspAnalysis = analyzeCSP(responseHeaders);

    // ── Discover sub-pages ────────────────────────────────────────────────
    const sitemapUrls = await fetchSitemapUrls(url, homePage);
    const pagesToCrawl = selectPagesToCrawl(
      homeResult.internalLinks,
      sitemapUrls,
      baseHostname,
      MAX_PAGES - 1
    );

    await homePage.close();

    // ── Crawl sub-pages (soft failures allowed) ───────────────────────────
    for (const pageUrl of pagesToCrawl) {
      try {
        const subPage = await context.newPage();
        const result = await crawlSinglePage(subPage, pageUrl, baseHostname, false);
        allPageResults.push(result);
        await subPage.close();
      } catch (err) {
        console.warn(`Skipping sub-page ${pageUrl}: ${err.message}`);
      }
    }

    // ── Aggregate results ─────────────────────────────────────────────────
    const cookies = await context.cookies();
    const allRequests = allPageResults.flatMap((p) => p.requests);
    const allScriptSrcs = [...new Set(allPageResults.flatMap((p) => p.scriptData.external))];

    // Merge fingerprinting signals: true if ANY page triggered it
    const mergedFingerprinting = {
      canvasFingerprint: allPageResults.some((p) => p.fingerprintSignals.canvasFingerprint),
      webglFingerprint:  allPageResults.some((p) => p.fingerprintSignals.webglFingerprint),
      fontFingerprint:   allPageResults.some((p) => p.fingerprintSignals.fontFingerprint),
      keylogger:         allPageResults.some((p) => p.fingerprintSignals.keylogger),
      formSnooping:      allPageResults.some((p) => p.fingerprintSignals.formSnooping),
      serviceWorker:     allPageResults.some((p) => p.fingerprintSignals.serviceWorker),
      beaconCalls:       allPageResults.flatMap((p) => p.fingerprintSignals.beaconCalls || []),
    };

    const storageData = allPageResults[0]?.storageData || {};

    const externalDomains = new Set();
    for (const req of allRequests) {
      try {
        const reqHostname = new URL(req.url).hostname;
        if (reqHostname !== baseHostname && !reqHostname.endsWith(`.${baseHostname}`)) {
          externalDomains.add(reqHostname);
        }
      } catch { /* skip */ }
    }

    const trackingParamsFound = [...new Set(allRequests.flatMap((r) => r.trackingParams))];
    const webSockets = [...new Set(allPageResults.flatMap((p) => p.webSockets).map((ws) => ws.url))];
    const redirectChains = allPageResults.flatMap((p) => p.redirectChains);
    const inlineTrackerScripts = allPageResults.flatMap((p) =>
      p.scriptData.inline.filter((s) => s.hasTrackerSignature)
    ).length;
    const pageText = allPageResults.map((p) => p.pageText).join(' ').slice(0, 15000);

    return {
      url,
      isHttps: url.startsWith('https://'),
      scriptSrcs: allScriptSrcs,
      cookies,
      externalDomains: [...externalDomains],
      allRequestedUrls: [...new Set(allRequests.map((r) => r.url))],
      fingerprinting: mergedFingerprinting,
      storageData,
      trackingParamsFound,
      webSockets,
      redirectChains,
      inlineTrackerScripts,
      cspAnalysis,
      responseHeaders,
      pagesCrawled: allPageResults.map((p) => p.url),
      pageText,
    };
  } finally {
    await browser.close();
  }
}
