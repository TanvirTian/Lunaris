import { createHash } from 'crypto';

const KNOWN_BAD_HASHES = new Set([
  // Populated from threat intel feed in production
]);

// ── Obfuscation signatures ────────────────────────────────────────────────────
const OBFUSCATION_SIGNATURES = [
  { pattern: /eval\s*\(/g,                           label: 'eval() usage',                  severity: 'high'   },
  { pattern: /new\s+Function\s*\(/g,                 label: 'new Function() (eval-like)',     severity: 'high'   },
  { pattern: /\\x[0-9a-fA-F]{2}/g,                  label: 'Hex-encoded strings',            severity: 'medium' },
  { pattern: /\\u[0-9a-fA-F]{4}/g,                  label: 'Unicode escape sequences',       severity: 'medium' },
  { pattern: /atob\s*\(/g,                           label: 'Base64 decoding (atob)',         severity: 'medium' },
  { pattern: /String\.fromCharCode/g,                label: 'String.fromCharCode',            severity: 'medium' },
  { pattern: /\[\s*(['"])\w+\1\s*\]\s*\(/g,         label: 'Bracket notation calls',         severity: 'low'    },
  { pattern: /setTimeout\s*\(\s*['"`][^'"]+['"`]/g,  label: 'setTimeout with string arg',     severity: 'high'   },
  { pattern: /document\['write'\]/g,                 label: 'document.write obfuscated',      severity: 'medium' },
  { pattern: /window\[(['"`])\w+\1\]/g,              label: 'window property obfuscation',    severity: 'low'    },
  // New obfuscation signatures
  { pattern: /Proxy\s*\(\s*\{/g,                    label: 'Proxy trap (anti-debug)',         severity: 'high'   },
  { pattern: /debugger\s*;/g,                        label: 'Anti-debugger statement',        severity: 'medium' },
  { pattern: /Function\s*\(\s*['"]return this['"]/g, label: 'Sandbox escape attempt',         severity: 'high'   },
  { pattern: /\(function\(\w,\w,\w,\w,\w\)\{/g,     label: 'Control flow obfuscation',       severity: 'high'   },
  { pattern: /var\s+_0x[a-f0-9]+\s*=/g,             label: 'JsFuck/obfuscator.io pattern',   severity: 'high'   },
  { pattern: /\]\s*\(\s*!\s*\[\s*\]\s*\+\s*\[\s*\]/g, label: 'JSFuck encoding',             severity: 'high'   },
];

// ── Data exfiltration patterns ────────────────────────────────────────────────
const EXFIL_PATTERNS = [
  { pattern: /document\.cookie/g,                      label: 'Cookie access'                 },
  { pattern: /localStorage\.(get|set)/g,               label: 'LocalStorage access'           },
  { pattern: /navigator\.(userAgent|platform|languages|plugins)/g, label: 'Browser fingerprinting' },
  { pattern: /screen\.(width|height|colorDepth)/g,     label: 'Screen fingerprinting'         },
  { pattern: /XMLHttpRequest|fetch\s*\(/g,             label: 'Network requests'              },
  { pattern: /sendBeacon/g,                            label: 'Beacon exfiltration'           },
  { pattern: /WebSocket/g,                             label: 'WebSocket usage'               },
  { pattern: /geolocation/g,                           label: 'Geolocation access'            },
  { pattern: /getBattery/g,                            label: 'Battery fingerprinting'        },
  { pattern: /getClientRects|getBoundingClientRect/g,  label: 'Layout fingerprinting'         },
  // New exfil patterns
  { pattern: /enumerateDevices/g,                      label: 'Media device enumeration'      },
  { pattern: /AudioContext|OfflineAudioContext/g,       label: 'Audio fingerprinting'          },
  { pattern: /deviceMemory|hardwareConcurrency/g,       label: 'Hardware fingerprinting'       },
  { pattern: /performance\.now\(\)/g,                  label: 'High-resolution timing'        },
  { pattern: /toDataURL|getImageData/g,                label: 'Canvas data extraction'        },
  { pattern: /getParameter\s*\(\s*\d+\s*\)/g,         label: 'WebGL parameter reading'       },
];

// ── Keystroke exfiltration patterns ──────────────────────────────────────────
// These distinguish passive analytics from active credential/input harvesting.
const KEYSTROKE_EXFIL_PATTERNS = [
  { pattern: /\["[a-z]",\s*\d+\]/g,                   label: 'Timestamped keystroke array',    severity: 'critical' },
  { pattern: /keylog|keystroke|typingdata|kl=/gi,      label: 'Keystroke identifier',           severity: 'critical' },
  { pattern: /delta.*key|key.*delta/gi,                label: 'Keystroke timing (delta)',       severity: 'high'     },
  { pattern: /keydown.*performance\.now|performance\.now.*keydown/g, label: 'Keystroke timing capture', severity: 'high' },
  { pattern: /charCode.*send|send.*charCode/g,         label: 'Character code exfiltration',   severity: 'critical' },
  { pattern: /inputBuffer|keyBuffer|charBuffer/gi,     label: 'Keystroke buffer accumulation', severity: 'high'     },
];

// ── Fingerprint transmission patterns ────────────────────────────────────────
const FINGERPRINT_TRANSMIT_PATTERNS = [
  { pattern: /canvas[_-]?(hash|fp|id|print).*(?:fetch|XHR|beacon)/gi, label: 'Canvas hash transmission', severity: 'critical' },
  { pattern: /(?:fetch|XHR|beacon).*canvas[_-]?(hash|fp|id|print)/gi, label: 'Canvas hash transmission', severity: 'critical' },
  { pattern: /sha256.*email|email.*sha256/gi,          label: 'Hashed email transmission',     severity: 'high'     },
  { pattern: /md5.*email|email.*md5/gi,                label: 'MD5 email transmission',        severity: 'high'     },
  { pattern: /"rrweb"|rrwebRecord|addEvent.*snapshot/g, label: 'Session replay (rrweb)',       severity: 'critical' },
  { pattern: /fingerprintjs|FingerprintJS|fpPromise/g, label: 'FingerprintJS library',         severity: 'high'     },
];

// ── Shannon entropy ───────────────────────────────────────────────────────────

function shannonEntropy(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  const len = str.length;
  return -Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum + p * Math.log2(p);
  }, 0);
}

function estimateObfuscation(code) {
  const entropy         = shannonEntropy(code);
  const longStrings     = (code.match(/['"`][^'"`\n]{200,}['"`]/g) || []).length;
  const nonAlphaRatio   = (code.match(/[^a-zA-Z0-9\s]/g) || []).length / code.length;
  const shortVarRatio   = (code.match(/\bvar [a-z]\b|\blet [a-z]\b|\bconst [a-z]\b/g) || []).length;

  let score = 0;
  if      (entropy > 5.5) score += 40;
  else if (entropy > 4.8) score += 20;
  else if (entropy > 4.2) score += 10;

  if      (longStrings > 5) score += 30;
  else if (longStrings > 2) score += 15;

  if      (nonAlphaRatio > 0.35) score += 20;
  else if (nonAlphaRatio > 0.25) score += 10;

  if (shortVarRatio > 50) score += 10;

  return {
    entropy:            Math.round(entropy * 100) / 100,
    longStrings,
    nonAlphaRatio:      Math.round(nonAlphaRatio * 100) / 100,
    obfuscationScore:   Math.min(100, score),
    isLikelyObfuscated: score >= 40,
  };
}

// ── ML feature vector ─────────────────────────────────────────────────────────
// Extracts a numeric feature vector for future Random Forest classification.
// Features chosen based on Caporusso et al. (2020) malicious JS analysis.
function extractMLFeatures(code, obfuscation) {
  const len = code.length || 1;
  return {
    // Entropy
    shannonEntropy:      obfuscation.entropy,
    // Character ratios
    nonAlphaRatio:       obfuscation.nonAlphaRatio,
    digitRatio:          (code.match(/\d/g) || []).length / len,
    symbolRatio:         (code.match(/[!@#$%^&*();,{}[\]]/g) || []).length / len,
    // Token characteristics
    avgTokenLength:      code.split(/\s+/).reduce((s, t) => s + t.length, 0) / (code.split(/\s+/).length || 1),
    longStringCount:     obfuscation.longStrings,
    // API call counts
    evalCount:           (code.match(/\beval\s*\(/g) || []).length,
    fetchCount:          (code.match(/\bfetch\s*\(/g) || []).length,
    xhrCount:            (code.match(/XMLHttpRequest/g) || []).length,
    documentWriteCount:  (code.match(/document\s*\.\s*write/g) || []).length,
    base64Count:         (code.match(/atob\s*\(|btoa\s*\(/g) || []).length,
    timingCount:         (code.match(/performance\.now\(\)|Date\.now\(\)/g) || []).length,
    // URL count in strings
    urlCount:            (code.match(/https?:\/\/[^\s'"]{5,}/g) || []).length,
    // Obfuscation score (0-100)
    obfuscationScore:    obfuscation.obfuscationScore,
  };
}

// ── Per-script analysis ───────────────────────────────────────────────────────

async function analyzeScript(scriptUrl, fetchFn) {
  try {
    const response = await fetchFn(scriptUrl);
    if (!response || !response.ok) return null;

    const code = await response.text();
    if (!code || code.length < 50) return null;

    const truncated   = code.slice(0, 100_000);
    const hash        = createHash('sha256').update(code).digest('hex');
    const isKnownBad  = KNOWN_BAD_HASHES.has(hash);
    const obfuscation = estimateObfuscation(truncated);
    const mlFeatures  = extractMLFeatures(truncated, obfuscation);

    // Obfuscation signatures
    const signatures = [];
    for (const sig of OBFUSCATION_SIGNATURES) {
      const matches = truncated.match(sig.pattern);
      if (matches) signatures.push({ label: sig.label, severity: sig.severity, count: matches.length });
    }

    // Standard exfil patterns
    const exfilPatterns = [];
    for (const pat of EXFIL_PATTERNS) {
      const matches = truncated.match(pat.pattern);
      if (matches) exfilPatterns.push({ label: pat.label, count: matches.length });
    }

    // Keystroke exfil (higher severity — shown separately in UI)
    const keystrokePatterns = [];
    for (const pat of KEYSTROKE_EXFIL_PATTERNS) {
      const matches = truncated.match(pat.pattern);
      if (matches) keystrokePatterns.push({ label: pat.label, severity: pat.severity, count: matches.length });
    }

    // Fingerprint transmission patterns
    const fingerprintTransmit = [];
    for (const pat of FINGERPRINT_TRANSMIT_PATTERNS) {
      const matches = truncated.match(pat.pattern);
      if (matches) fingerprintTransmit.push({ label: pat.label, severity: pat.severity, count: matches.length });
    }

    // Risk assessment
    const highSigs          = signatures.filter((s) => s.severity === 'high');
    const criticalKeystroke = keystrokePatterns.some((p) => p.severity === 'critical');
    const criticalFP        = fingerprintTransmit.some((p) => p.severity === 'critical');

    let risk = 'low';
    if (isKnownBad || criticalKeystroke || criticalFP || obfuscation.obfuscationScore >= 60 || highSigs.length >= 2) {
      risk = 'high';
    } else if (obfuscation.obfuscationScore >= 30 || highSigs.length >= 1 || signatures.length >= 3 ||
               keystrokePatterns.length > 0 || fingerprintTransmit.length > 0) {
      risk = 'medium';
    }

    return {
      url:                scriptUrl.slice(0, 120),
      hash:               hash.slice(0, 16) + '…',
      sizeKb:             Math.round(code.length / 1024),
      isKnownBad,
      obfuscation,
      signatures,
      exfilPatterns,
      keystrokePatterns,
      fingerprintTransmit,
      mlFeatures,
      risk,
    };
  } catch {
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeScripts(scriptUrls, isCDNFn) {
  const candidates = scriptUrls.filter((url) => {
    try { return !isCDNFn(new URL(url).hostname); } catch { return false; }
  }).slice(0, 8);

  if (!candidates.length) return [];

  const fetchFn = async (url) => {
    try {
      return await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrivacyAnalyzer/1.0)' },
        signal:  AbortSignal.timeout(8000),
      });
    } catch { return null; }
  };

  const results = await Promise.allSettled(
    candidates.map((url) => analyzeScript(url, fetchFn))
  );

  const riskOrder = { high: 0, medium: 1, low: 2 };
  return results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value)
    .sort((a, b) => (riskOrder[a.risk] ?? 3) - (riskOrder[b.risk] ?? 3));
}
