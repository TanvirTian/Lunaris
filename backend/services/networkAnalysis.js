/**
 * Network Analysis Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Analyzes outbound network requests at payload level — not just where data
 * goes, but WHAT is being sent. Detects:
 *  - PII in request bodies (email, hashed email, session IDs)
 *  - Canvas/fingerprint hashes being transmitted
 *  - Behavioral analytics payloads (mouse/scroll/interaction streams)
 *  - Session replay data transmission (rrweb and equivalents)
 *  - Keystroke data exfiltration
 *  - Corporate tracker category classification
 *
 * Called from analyzer.js after crawl completes.
 * Input: raw allRequests array from crawler
 * Output: structured network findings used by scoring + signals
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Payload-level sensitive data patterns ─────────────────────────────────────
// Checked against both URL params and POST body of every outbound request.
const PAYLOAD_PATTERNS = [
  {
    pattern:  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    label:    'Email address in request payload',
    risk:     'high',
    category: 'PII',
    signal:   'pii_in_payload',
  },
  {
    // SHA256-hashed email — used by ad tech for "privacy-safe" cross-site matching
    pattern:  /(?:em|email|hashed_email|sha256|h_em)=[a-f0-9]{64}/i,
    label:    'Hashed email (SHA256) — ad identity matching across sites',
    risk:     'high',
    category: 'Identity',
    signal:   'hashed_email_transmission',
  },
  {
    // Canvas fingerprint hash being sent to a server
    pattern:  /canvas[_-]?(hash|fp|print|id)=[a-zA-Z0-9+/=_-]{20,}/i,
    label:    'Canvas fingerprint transmitted in request',
    risk:     'critical',
    category: 'Fingerprinting',
    signal:   'canvas_hash_in_request',
  },
  {
    pattern:  /session[_-]?id=[a-zA-Z0-9%_-]{16,}/i,
    label:    'Session identifier in outbound request',
    risk:     'high',
    category: 'Identity',
    signal:   'session_id_leakage',
  },
  {
    // rrweb session replay JSON chunks
    pattern:  /"(rrweb|recording|replay|snapshot|events)":/i,
    label:    'Session replay data transmission detected',
    risk:     'critical',
    category: 'Session Replay',
    signal:   'session_replay',
  },
  {
    pattern:  /user[_-]?id=[a-zA-Z0-9%\-]{8,36}/i,
    label:    'Cross-site user identifier in request',
    risk:     'high',
    category: 'Identity',
    signal:   'pii_in_payload',
  },
  {
    // Timestamped keystroke array — [key, deltaMs] pairs
    pattern:  /\["[a-z]",\s*\d+\]/,
    label:    'Keystroke timing data detected in payload',
    risk:     'critical',
    category: 'Keylogging',
    signal:   'pii_in_payload',
  },
  {
    pattern:  /keylog|keystroke|typingdata|kl=/i,
    label:    'Keystroke identifier in outbound request',
    risk:     'critical',
    category: 'Keylogging',
    signal:   'pii_in_payload',
  },
  {
    // Behavioral analytics — mouse/scroll event stream
    pattern:  /"(events|interactions|mouse_moves|scrolls|clicks)":\s*\[/,
    label:    'Behavioral analytics payload (interaction stream)',
    risk:     'medium',
    category: 'Behavioral',
    signal:   'behavioral_payload',
  },
  {
    // MD5 hash — older ad tech sometimes uses MD5 of email
    pattern:  /(?:em_md5|email_md5|md5email)=[a-f0-9]{32}/i,
    label:    'MD5-hashed email in request (ad identity matching)',
    risk:     'high',
    category: 'Identity',
    signal:   'hashed_email_transmission',
  },
];

// ── Corporate tracker classification ─────────────────────────────────────────
// Maps domain substrings to data categories with different risk profiles.
// Goes beyond "is this a tracker" to "what kind of data collector is this."
const CORPORATE_TRACKER_CATEGORIES = {
  // Data brokers — aggregate + resell consumer profiles to third parties
  data_broker: [
    'acxiom', 'experian', 'oracle-data', 'liveramp', 'neustar',
    'transunion', 'epsilon', 'datalogix', 'lotame', 'bombora',
    'zeta-global', 'merkle', 'exacttarget',
  ],
  // Session replay — record full page interaction including typing + mouse
  session_replay: [
    'hotjar', 'fullstory', 'logrocket', 'mouseflow', 'smartlook',
    'clarity.ms', 'inspectlet', 'sessioncam', 'luckyorange', 'crazyegg',
    'heatmap.com', 'ptengine',
  ],
  // Identity resolution — match users across sites without cookies
  identity_resolution: [
    'liveramp', 'id5-sync', 'criteo', 'thetradedesk', 'adsrvr',
    'pubmatic', 'openx', 'triplelift', 'index.exchange', 'rubicon',
    'appnexus', 'rubiconproject', 'tapad', 'adnxs',
  ],
  // Behavioral analytics — infer user intent from interaction patterns
  behavioral: [
    'mixpanel', 'amplitude', 'heap.io', 'segment.io', 'pendo',
    'kissmetrics', 'woopra', 'clicky', 'chartbeat',
  ],
  // Standard advertising — impression/click tracking
  advertising: [
    'doubleclick', 'googlesyndication', 'googleadservices', 'adservice',
    'moatads', 'scorecardresearch', 'quantserve', 'outbrain', 'taboola',
    'criteo', 'adsrvr', 'amazon-adsystem', 'bat.bing', 'ads.twitter',
    'linkedin.com/px',
  ],
  // Functional tools (lower risk — legitimate business purpose)
  functional: [
    'intercom', 'zendesk', 'drift', 'freshdesk', 'hubspot', 'marketo',
  ],
};

// Risk level per category
const CATEGORY_RISK = {
  data_broker:          'critical',
  session_replay:       'high',
  identity_resolution:  'high',
  behavioral:           'medium',
  advertising:          'medium',
  functional:           'low',
};

/**
 * Classify a request URL into a corporate tracker category.
 * Returns null if not recognized.
 */
function classifyTrackerCategory(url) {
  const lower = url.toLowerCase();
  for (const [category, patterns] of Object.entries(CORPORATE_TRACKER_CATEGORIES)) {
    if (patterns.some((p) => lower.includes(p))) {
      return { category, risk: CATEGORY_RISK[category] };
    }
  }
  return null;
}

/**
 * Analyze all outbound network requests for payload-level privacy violations
 * and corporate tracker classifications.
 *
 * @param {Array} requests - Raw request objects from crawler
 *   Each has: { url, method, hasPostData, sensitivePayload?, trackingParams? }
 *
 * @returns {{
 *   payloadFindings:    Array of { url, label, risk, category, signal }
 *   trackerCategories:  Array of { url, category, risk }
 *   signals:            Object — flat signal map for scoring
 *   summary:            Object — counts per category
 * }}
 */
export function analyzeNetworkPayloads(requests) {
  const payloadFindings   = [];
  const trackerCategories = [];

  // Flat signal map — keys match SIGNAL_WEIGHTS in scoring.js
  const signals = {
    pii_in_payload:              false,
    hashed_email_transmission:   false,
    canvas_hash_in_request:      false,
    session_id_leakage:          false,
    session_replay:              false,
    behavioral_payload:          false,
    beacon_exfiltration:         false,
    data_broker_tracker:         false,
    session_replay_tracker:      false,
    identity_resolution_tracker: false,
    behavioral_analytics_tracker:false,
    ad_network_tracker:          false,
    functional_tracker:          false,
  };

  // Count ad trackers for diminishing-returns multiplier in scoring
  let adTrackerCount = 0;

  for (const req of requests) {
    const targetUrl = req.url || '';
    if (!targetUrl || targetUrl.startsWith('data:')) continue;

    // ── Corporate category classification ──────────────────────────────────
    const classification = classifyTrackerCategory(targetUrl);
    if (classification) {
      const { category, risk } = classification;
      trackerCategories.push({ url: targetUrl.slice(0, 120), category, risk });

      // Map category → signal key
      switch (category) {
        case 'data_broker':          signals.data_broker_tracker          = true; break;
        case 'session_replay':       signals.session_replay_tracker       = true; break;
        case 'identity_resolution':  signals.identity_resolution_tracker  = true; break;
        case 'behavioral':           signals.behavioral_analytics_tracker = true; break;
        case 'advertising':          signals.ad_network_tracker           = true; adTrackerCount++; break;
        case 'functional':           signals.functional_tracker           = true; break;
      }
    }

    // ── Payload-level pattern scanning ─────────────────────────────────────
    // Use pre-computed sensitivePayload from crawler if available (faster)
    // Otherwise re-scan the URL (POST body was already scanned in crawler)
    const precomputed = req.sensitivePayload || [];
    if (precomputed.length > 0) {
      for (const finding of precomputed) {
        payloadFindings.push({ url: targetUrl.slice(0, 120), ...finding });
        if (finding.label === 'hashed_email' || finding.label === 'email') signals.pii_in_payload = true;
        if (finding.label === 'canvas_hash')  signals.canvas_hash_in_request = true;
        if (finding.label === 'session_id')   signals.session_id_leakage     = true;
        if (finding.label === 'session_replay') signals.session_replay        = true;
        if (finding.label === 'behavioral_data') signals.behavioral_payload   = true;
        if (finding.label === 'keystroke_array' || finding.label === 'keystroke_id') signals.pii_in_payload = true;
      }
    } else {
      // Fallback: scan URL params only (body was capped in crawler)
      for (const p of PAYLOAD_PATTERNS) {
        if (p.pattern.test(targetUrl)) {
          payloadFindings.push({ url: targetUrl.slice(0, 120), label: p.label, risk: p.risk, category: p.category });
          signals[p.signal] = true;
        }
      }
    }

    // sendBeacon requests are always a network exfiltration signal
    if (req.resourceType === 'ping' || (req.method === 'POST' && targetUrl.includes('beacon'))) {
      signals.beacon_exfiltration = true;
    }
  }

  // Deduplicate findings by label+url combination
  const seen = new Set();
  const uniqueFindings = payloadFindings.filter((f) => {
    const key = `${f.label}:${f.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by risk: critical first
  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  uniqueFindings.sort((a, b) => (riskOrder[a.risk] ?? 4) - (riskOrder[b.risk] ?? 4));

  // Summary counts
  const categoryCounts = {};
  for (const t of trackerCategories) {
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  }

  return {
    payloadFindings:    uniqueFindings,
    trackerCategories:  trackerCategories.slice(0, 50), // cap for response size
    signals,
    adTrackerCount,
    summary: {
      totalPayloadFindings: uniqueFindings.length,
      criticalFindings:     uniqueFindings.filter((f) => f.risk === 'critical').length,
      highFindings:         uniqueFindings.filter((f) => f.risk === 'high').length,
      categoryCounts,
    },
  };
}
