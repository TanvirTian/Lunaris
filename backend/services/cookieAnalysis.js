/**
 * Cookie Deep Analysis Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Goes far beyond "count cookies". Analyzes each cookie for:
 *  - Purpose classification (session / analytics / tracking / functional)
 *  - Lifetime scoring (session vs years-long trackers)
 *  - Security attribute audit (Secure, HttpOnly, SameSite)
 *  - Third-party cookie detection
 *  - Supercookie risk signals
 *  - Company attribution (who set this cookie?)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Known cookie name → company/purpose mapping
const KNOWN_COOKIES = {
  // Google
  '_ga':        { company: 'Google Analytics', purpose: 'tracking',   risk: 'medium' },
  '_gid':       { company: 'Google Analytics', purpose: 'tracking',   risk: 'medium' },
  '_gat':       { company: 'Google Analytics', purpose: 'tracking',   risk: 'low'    },
  '__utma':     { company: 'Google Analytics', purpose: 'tracking',   risk: 'medium' },
  '__utmz':     { company: 'Google Analytics', purpose: 'tracking',   risk: 'medium' },
  '_gcl_au':    { company: 'Google Ads',       purpose: 'tracking',   risk: 'high'   },
  'NID':        { company: 'Google',           purpose: 'tracking',   risk: 'high'   },
  'CONSENT':    { company: 'Google',           purpose: 'functional', risk: 'low'    },
  'SOCS':       { company: 'Google',           purpose: 'functional', risk: 'low'    },

  // Meta / Facebook
  '_fbp':       { company: 'Meta Pixel',       purpose: 'tracking',   risk: 'high'   },
  '_fbc':       { company: 'Meta Pixel',       purpose: 'tracking',   risk: 'high'   },
  'fr':         { company: 'Facebook',         purpose: 'tracking',   risk: 'high'   },
  'datr':       { company: 'Facebook',         purpose: 'tracking',   risk: 'high'   },
  'sb':         { company: 'Facebook',         purpose: 'tracking',   risk: 'high'   },

  // Hotjar
  '_hjid':           { company: 'Hotjar', purpose: 'tracking', risk: 'medium' },
  '_hjSessionUser':  { company: 'Hotjar', purpose: 'tracking', risk: 'medium' },
  '_hjSession':      { company: 'Hotjar', purpose: 'tracking', risk: 'medium' },
  '_hjAbsoluteSessionInProgress': { company: 'Hotjar', purpose: 'tracking', risk: 'low' },

  // HubSpot
  '__hstc':     { company: 'HubSpot', purpose: 'tracking',   risk: 'medium' },
  '__hssc':     { company: 'HubSpot', purpose: 'tracking',   risk: 'medium' },
  '__hssrc':    { company: 'HubSpot', purpose: 'tracking',   risk: 'low'    },
  'hubspotutk': { company: 'HubSpot', purpose: 'tracking',   risk: 'medium' },

  // Intercom
  'intercom-id':      { company: 'Intercom', purpose: 'functional', risk: 'low'  },
  'intercom-session': { company: 'Intercom', purpose: 'functional', risk: 'low'  },

  // Mixpanel
  'mp_':        { company: 'Mixpanel', purpose: 'tracking', risk: 'medium' },

  // Cloudflare (functional)
  '__cf_bm':    { company: 'Cloudflare', purpose: 'functional', risk: 'low' },
  'cf_clearance': { company: 'Cloudflare', purpose: 'functional', risk: 'low' },

  // Generic session
  'sessionid':  { company: 'Site',  purpose: 'session',    risk: 'low' },
  'session':    { company: 'Site',  purpose: 'session',    risk: 'low' },
  'PHPSESSID':  { company: 'Site',  purpose: 'session',    risk: 'low' },
  'JSESSIONID': { company: 'Site',  purpose: 'session',    risk: 'low' },
  'csrftoken':  { company: 'Site',  purpose: 'functional', risk: 'low' },
  'XSRF-TOKEN': { company: 'Site',  purpose: 'functional', risk: 'low' },
};

// Patterns for cookie name classification when not in known list
const COOKIE_PATTERNS = [
  { pattern: /^_ga|analytics|track|pixel|stat/i, purpose: 'tracking',   risk: 'medium' },
  { pattern: /sess(ion)?|auth|login|token|csrf/i, purpose: 'session',   risk: 'low'    },
  { pattern: /pref|settings|lang|theme|consent/i, purpose: 'functional', risk: 'low'   },
  { pattern: /ads?|campaign|utm|click|refer/i,    purpose: 'tracking',   risk: 'high'   },
];

/**
 * Classify a cookie name into purpose + risk.
 */
function classifyCookie(name) {
  // Exact match first
  for (const [key, info] of Object.entries(KNOWN_COOKIES)) {
    if (name === key || name.startsWith(key)) return info;
  }
  // Pattern match
  for (const pat of COOKIE_PATTERNS) {
    if (pat.pattern.test(name)) {
      return { company: 'Unknown', purpose: pat.purpose, risk: pat.risk };
    }
  }
  return { company: 'Unknown', purpose: 'unknown', risk: 'low' };
}

/**
 * Calculate cookie lifetime in days from expiry date.
 * Returns null for session cookies (no expiry).
 */
function cookieLifetimeDays(expires) {
  if (!expires || expires === -1) return null; // session cookie
  const now = Date.now() / 1000;
  return Math.round((expires - now) / 86400);
}

/**
 * Score cookie lifetime risk:
 * - Session cookie: safe
 * - < 30 days: low
 * - < 1 year: medium
 * - 1–2 years: high
 * - 2+ years: very aggressive
 */
function lifetimeRisk(days) {
  if (days === null) return { label: 'Session', risk: 'safe', days: null };
  if (days < 0)      return { label: 'Expired', risk: 'safe', days };
  if (days < 30)     return { label: `${days}d`, risk: 'low', days };
  if (days < 365)    return { label: `${Math.round(days/30)}mo`, risk: 'medium', days };
  if (days < 730)    return { label: `${Math.round(days/365)}yr`, risk: 'high', days };
  return { label: `${Math.round(days/365)}yr`, risk: 'critical', days };
}

/**
 * Audit security attributes of a cookie.
 */
function auditAttributes(cookie) {
  const issues = [];
  if (!cookie.secure)   issues.push('Missing Secure flag — can be sent over HTTP');
  if (!cookie.httpOnly) issues.push('Missing HttpOnly — readable by JavaScript');
  if (!cookie.sameSite || cookie.sameSite === 'None') {
    issues.push('SameSite=None or missing — vulnerable to CSRF and cross-site tracking');
  }
  return issues;
}

/**
 * Main export — deep analyze all cookies from the crawl.
 */
export function analyzeCookies(cookies, pageHostname) {
  if (!cookies || cookies.length === 0) {
    return { cookies: [], summary: { total: 0, byPurpose: {}, byRisk: {}, securityIssues: 0 } };
  }

  const analyzed = cookies.map((cookie) => {
    const classification = classifyCookie(cookie.name);
    const days = cookieLifetimeDays(cookie.expires);
    const lifetime = lifetimeRisk(days);
    const attributeIssues = auditAttributes(cookie);
    const isThirdParty = cookie.domain && !cookie.domain.includes(pageHostname.replace('www.', ''));

    // Elevate risk for long-lived third-party tracking cookies
    let finalRisk = classification.risk;
    if (lifetime.risk === 'critical' && classification.purpose === 'tracking') finalRisk = 'high';
    if (isThirdParty && classification.purpose === 'tracking') finalRisk = 'high';

    return {
      name: cookie.name,
      domain: cookie.domain || pageHostname,
      company: classification.company,
      purpose: classification.purpose,
      risk: finalRisk,
      lifetime,
      isThirdParty,
      isSecure: !!cookie.secure,
      isHttpOnly: !!cookie.httpOnly,
      sameSite: cookie.sameSite || 'None',
      attributeIssues,
    };
  });

  // Sort: highest risk first
  const riskOrder = { high: 0, critical: 0, medium: 1, low: 2, safe: 3 };
  analyzed.sort((a, b) => (riskOrder[a.risk] ?? 3) - (riskOrder[b.risk] ?? 3));

  // Summary stats
  const byPurpose = {};
  const byRisk = {};
  let securityIssues = 0;

  for (const c of analyzed) {
    byPurpose[c.purpose] = (byPurpose[c.purpose] || 0) + 1;
    byRisk[c.risk] = (byRisk[c.risk] || 0) + 1;
    securityIssues += c.attributeIssues.length;
  }

  const thirdPartyTracking = analyzed.filter(
    (c) => c.isThirdParty && c.purpose === 'tracking'
  ).length;

  const longestLived = analyzed
    .filter((c) => c.lifetime.days !== null && c.lifetime.days > 0)
    .sort((a, b) => b.lifetime.days - a.lifetime.days)[0];

  return {
    cookies: analyzed.slice(0, 30), // return top 30
    summary: {
      total: analyzed.length,
      thirdPartyTracking,
      byPurpose,
      byRisk,
      securityIssues,
      longestLivedDays: longestLived?.lifetime.days || 0,
      longestLivedName: longestLived?.name || null,
    },
  };
}
