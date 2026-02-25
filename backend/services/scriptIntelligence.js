/**
 * Script Intelligence Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Downloads and deeply analyzes external JavaScript files to detect:
 *  - Obfuscation (hex encoding, string arrays, control flow flattening)
 *  - eval() and dynamic code execution
 *  - Data exfiltration patterns
 *  - Known bad actor signatures (hashes)
 *  - Entropy analysis (high entropy = likely obfuscated)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'crypto';

// Known malicious/tracker script hashes (SHA256 of minified content).
// In production you'd pull this from a threat intel feed.
const KNOWN_BAD_HASHES = new Set([
  // Placeholder — in a real system you'd populate from a database
  // e.g. known cryptominers, aggressive fingerprinters, etc.
]);

// Obfuscation signatures — regex patterns found in obfuscated code
const OBFUSCATION_SIGNATURES = [
  { pattern: /eval\s*\(/g,                          label: 'eval() usage',              severity: 'high'   },
  { pattern: /new\s+Function\s*\(/g,                label: 'new Function() (eval-like)', severity: 'high'   },
  { pattern: /\\x[0-9a-fA-F]{2}/g,                 label: 'Hex-encoded strings',        severity: 'medium' },
  { pattern: /\\u[0-9a-fA-F]{4}/g,                 label: 'Unicode escape sequences',   severity: 'medium' },
  { pattern: /atob\s*\(/g,                          label: 'Base64 decoding (atob)',     severity: 'medium' },
  { pattern: /String\.fromCharCode/g,               label: 'String.fromCharCode',        severity: 'medium' },
  { pattern: /\[\s*(['"])\w+\1\s*\]\s*\(/g,        label: 'Bracket notation calls',     severity: 'low'    },
  { pattern: /setTimeout\s*\(\s*['"`][^'"]+['"`]/g, label: 'setTimeout with string arg', severity: 'high'   },
  { pattern: /document\['write'\]/g,                label: 'document.write obfuscated',  severity: 'medium' },
  { pattern: /window\[(['"`])\w+\1\]/g,             label: 'window property obfuscation',severity: 'low'    },
];

// Data exfiltration patterns — what suspicious scripts look for
const EXFIL_PATTERNS = [
  { pattern: /document\.cookie/g,          label: 'Cookie access'           },
  { pattern: /localStorage\.(get|set)/g,   label: 'LocalStorage access'     },
  { pattern: /navigator\.(userAgent|platform|languages|plugins)/g, label: 'Browser fingerprinting' },
  { pattern: /screen\.(width|height|colorDepth)/g, label: 'Screen fingerprinting' },
  { pattern: /XMLHttpRequest|fetch\s*\(/g, label: 'Network requests'        },
  { pattern: /sendBeacon/g,                label: 'Beacon exfiltration'     },
  { pattern: /WebSocket/g,                 label: 'WebSocket usage'         },
  { pattern: /geolocation/g,               label: 'Geolocation access'      },
  { pattern: /getBattery/g,                label: 'Battery fingerprinting'  },
  { pattern: /getClientRects|getBoundingClientRect/g, label: 'Layout fingerprinting' },
];

/**
 * Calculate Shannon entropy of a string.
 * High entropy (>4.5) strongly suggests obfuscation or minification.
 * Very high entropy (>5.5) is almost certainly obfuscated.
 */
function shannonEntropy(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  const len = str.length;
  return -Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum + p * Math.log2(p);
  }, 0);
}

/**
 * Estimate obfuscation likelihood from code characteristics.
 */
function estimateObfuscation(code) {
  const entropy = shannonEntropy(code);

  // Long unbroken strings of seemingly random chars
  const longStrings = (code.match(/['"`][^'"`\n]{200,}['"`]/g) || []).length;

  // Ratio of non-alphanumeric characters (obfuscated code is symbol-heavy)
  const nonAlphaRatio = (code.match(/[^a-zA-Z0-9\s]/g) || []).length / code.length;

  // Very short variable names across large code = minified at minimum
  const shortVarRatio = (code.match(/\bvar [a-z]\b|\blet [a-z]\b|\bconst [a-z]\b/g) || []).length;

  let score = 0;
  if (entropy > 5.5) score += 40;
  else if (entropy > 4.8) score += 20;
  else if (entropy > 4.2) score += 10;

  if (longStrings > 5) score += 30;
  else if (longStrings > 2) score += 15;

  if (nonAlphaRatio > 0.35) score += 20;
  else if (nonAlphaRatio > 0.25) score += 10;

  if (shortVarRatio > 50) score += 10;

  return {
    entropy: Math.round(entropy * 100) / 100,
    longStrings,
    nonAlphaRatio: Math.round(nonAlphaRatio * 100) / 100,
    obfuscationScore: Math.min(100, score), // 0-100
    isLikelyObfuscated: score >= 40,
  };
}

/**
 * Fetch a script URL and analyze its content.
 * Returns null if the script can't be fetched.
 */
async function analyzeScript(scriptUrl, fetchFn) {
  try {
    const response = await fetchFn(scriptUrl);
    if (!response || !response.ok) return null;

    const code = await response.text();
    if (!code || code.length < 50) return null;

    const truncated = code.slice(0, 100000); // analyze first 100kb max
    const hash = createHash('sha256').update(code).digest('hex');
    const isKnownBad = KNOWN_BAD_HASHES.has(hash);

    // Run obfuscation analysis
    const obfuscation = estimateObfuscation(truncated);

    // Find obfuscation signatures
    const signatures = [];
    for (const sig of OBFUSCATION_SIGNATURES) {
      const matches = truncated.match(sig.pattern);
      if (matches) {
        signatures.push({
          label: sig.label,
          severity: sig.severity,
          count: matches.length,
        });
      }
    }

    // Find data exfiltration patterns
    const exfilPatterns = [];
    for (const pat of EXFIL_PATTERNS) {
      const matches = truncated.match(pat.pattern);
      if (matches) {
        exfilPatterns.push({ label: pat.label, count: matches.length });
      }
    }

    // Overall risk assessment
    let risk = 'low';
    const highSigs = signatures.filter((s) => s.severity === 'high');
    if (isKnownBad || obfuscation.obfuscationScore >= 60 || highSigs.length >= 2) risk = 'high';
    else if (obfuscation.obfuscationScore >= 30 || highSigs.length >= 1 || signatures.length >= 3) risk = 'medium';

    return {
      url: scriptUrl.slice(0, 120),
      hash: hash.slice(0, 16) + '…',
      sizeKb: Math.round(code.length / 1024),
      isKnownBad,
      obfuscation,
      signatures,
      exfilPatterns,
      risk,
    };
  } catch {
    return null;
  }
}

/**
 * Main export — analyze a batch of script URLs.
 * Only analyzes external, non-CDN scripts (skip known safe ones).
 * Limits to top 8 scripts to keep scan time reasonable.
 */
export async function analyzeScripts(scriptUrls, isCDNFn) {
  // Filter: external scripts only, skip CDNs
  const candidates = scriptUrls.filter((url) => {
    try {
      const hostname = new URL(url).hostname;
      return !isCDNFn(hostname);
    } catch {
      return false;
    }
  }).slice(0, 8);

  if (!candidates || candidates.length === 0) return [];

  // Use native fetch (Node 18+)
  const fetchFn = async (url) => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrivacyAnalyzer/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      return res;
    } catch {
      return null; // network error — skip this script
    }
  };

  // Analyze all in parallel
  const results = await Promise.allSettled(
    candidates.map((url) => analyzeScript(url, fetchFn))
  );

  return results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value)
    .sort((a, b) => {
      // Sort by risk: high → medium → low
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.risk] - order[b.risk];
    });
}
