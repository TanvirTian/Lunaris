const SIGNAL_WEIGHTS = {
  // ── Combined fingerprinting attack ────────────────────────────────────────
  combined_fingerprint_attack:  0.21, // 3+ APIs in 500ms — deliberate, not incidental

  // ── Individual fingerprinting (weighted by entropy bits) ──────────────────
  audio_fingerprint:            0.09, // ~5.5 bits
  canvas_fingerprint:           0.10, // ~7.0 bits
  webgl_fingerprint:            0.08, // ~6.5 bits
  font_fingerprint:             0.07, // ~8.0 bits (often part of combined attack)
  hardware_fingerprint:         0.05, // ~3.0 bits
  media_device_fingerprint:     0.07, // ~4.5 bits
  battery_fingerprint:          0.05, // ~4.0 bits (deprecated but still attempted)
  timing_fingerprint:           0.06, // rAF timing attack

  // ── Active data capture ───────────────────────────────────────────────────
  keylogger_behavioral:         0.18, // global key listener (context amplifies heavily)
  keylogger_timing:             0.14, // rAF-based timing capture
  form_snooping_autofill:       0.12, // reads inputs before user interaction
  form_snooping_hidden:         0.08, // reads hidden/pre-filled fields
  mutation_observer_harvesting: 0.10, // watches DOM for new input fields
  session_replay:               0.17, // records full interaction stream

  // ── Network exfiltration — confirmed data leaving the device ─────────────
  // These weights are highest because they confirm ACTUAL transmission of
  // sensitive data, not just capability. PII in a POST body is a smoking gun.
  pii_in_payload:               0.36,
  canvas_hash_in_request:       0.34, // fingerprint hash confirmed sent to server
  hashed_email_transmission:    0.28, // SHA256/MD5 email for cross-site matching
  session_id_leakage:           0.12,
  behavioral_payload:           0.09, // mouse/scroll event streams
  beacon_exfiltration:          0.07, // sendBeacon bypasses standard blocking

  // ── Tracker presence by category ─────────────────────────────────────────
  data_broker_tracker:          0.18, // companies that sell consumer profiles
  identity_resolution_tracker:  0.16, // cross-site user matching without cookies
  session_replay_tracker:       0.17, // confirmed session replay script loaded
  behavioral_analytics_tracker: 0.06,
  ad_network_tracker:           0.08,
  functional_tracker:           0.02, // Intercom, Zendesk — low risk

  // ── Infrastructure / headers ──────────────────────────────────────────────
  no_https:                     0.12,
  no_csp:                       0.05,
  csp_unsafe_inline:            0.04,
  csp_unsafe_eval:              0.03,
  obfuscated_script_high_risk:  0.09,
  obfuscated_script_medium_risk:0.05,
  service_worker:               0.04,
  websocket_connections:        0.03,
  tracking_params_in_requests:  0.06,
};

// No single signal can reduce privacy remaining by more than this fraction,
// regardless of context multiplier. Prevents one signal dominating the score.
const MAX_SINGLE_SIGNAL = 0.45;

export const TRACKER_CATEGORY_SIGNAL = {
  data_broker:         'data_broker_tracker',
  identity_resolution: 'identity_resolution_tracker',
  session_replay:      'session_replay_tracker',
  behavioral:          'behavioral_analytics_tracker',
  advertising:         'ad_network_tracker',
  functional:          'functional_tracker',
};

/**
 * Context multipliers amplify certain signals based on page type.
 * A keylogger on a page with no sensitive forms is concerning.
 * A keylogger on a page with a password field is a credential theft risk.
 *
 * Multipliers are halved vs the additive model because in multiplicative
 * compounding even a 2× multiplier has a large effect on the final product.
 */
function severityMultiplier(signalKey, context) {
  const { hasLoginForm, hasPasswordField, hasPaymentForm, isHttps } = context;

  switch (signalKey) {
    case 'session_replay':
    case 'session_replay_tracker':
      if (hasLoginForm || hasPasswordField) return 1.8;
      if (hasPaymentForm)                   return 1.5;
      return 1.0;

    case 'keylogger_behavioral':
    case 'keylogger_timing':
      if (hasPasswordField) return 2.0;
      if (hasLoginForm)     return 1.6;
      return 1.0;

    case 'form_snooping_autofill':
    case 'form_snooping_hidden':
    case 'mutation_observer_harvesting':
      if (hasPaymentForm)   return 1.7;
      if (hasPasswordField) return 1.4;
      return 1.0;

    case 'pii_in_payload':
    case 'hashed_email_transmission':
      // PII transmitted over plain HTTP is visible to any network observer
      return isHttps === false ? 1.5 : 1.0;

    default:
      return 1.0;
  }
}

/**
 * Confidence factor: how much should we trust the absence of signals?
 *
 * A 1-page crawl starts at 0.60 — we can confirm what WAS found, but
 * not confidently assert that nothing else exists. Additional pages,
 * high request volume, and confirmed detector-script execution each
 * add to confidence. Max 1.0 = full confidence.
 *
 * This means a clean 1-page crawl gets 60, not 100 — appropriate given
 * we only saw the homepage. A 4-page crawl with 100+ requests gets 90.
 */
function confidenceFactor(crawlData) {
  let c = 0.60;

  const pages = crawlData.pagesCrawled?.length ?? 1;
  if (pages >= 2) c += 0.08;
  if (pages >= 3) c += 0.06;
  if (pages >= 4) c += 0.06;

  const reqs = crawlData.allRequestedUrls?.length ?? 0;
  if (reqs > 20)  c += 0.04;
  if (reqs > 50)  c += 0.03;
  if (reqs > 100) c += 0.03;

  // Confirmed signals from detector script (not just URL matching)
  const fp = crawlData.fingerprinting || {};
  if (typeof fp.canvasFingerprint === 'boolean') c += 0.03;
  if (typeof fp.webglFingerprint  === 'boolean') c += 0.02;
  if (typeof fp.keylogger         === 'boolean') c += 0.02;
  if (crawlData.cspAnalysis?.present)            c += 0.03;

  return Math.min(1.0, Math.round(c * 100) / 100);
}

/**
 * Exploitability: how bad would it be if this data were misused?
 * Independent of the privacy score — answers a different question.
 * A site with 20 benign trackers may score low on privacy but low on exploitability.
 * A site with one keylogger on a login form may score mid on privacy but critical exploitability.
 */
function calculateExploitability(signals, crawlData) {
  let score = 0;
  const fp = crawlData.fingerprinting || {};

  if (signals.combined_fingerprint_attack)                          score += 40;
  else if (signals.canvas_fingerprint && signals.webgl_fingerprint) score += 25;
  else if (signals.canvas_fingerprint || signals.audio_fingerprint) score += 15;

  if (fp.keylogger || signals.keylogger_behavioral) score += 35;
  if (signals.keylogger_timing)                     score += 25;
  if (signals.pii_in_payload)                       score += 32;
  if (signals.canvas_hash_in_request)               score += 30;
  if (signals.session_replay || fp.sessionReplay)   score += 22;
  if (signals.hashed_email_transmission)            score += 20;
  if (signals.form_snooping_autofill)               score += 18;
  if (signals.data_broker_tracker)                  score += 20;
  if (signals.identity_resolution_tracker)          score += 25;

  if (!crawlData.isHttps && score > 0) score = Math.round(score * 1.4);

  const capped = Math.min(100, score);
  return {
    score: capped,
    label: capped >= 70 ? 'Critical' : capped >= 45 ? 'High' : capped >= 20 ? 'Medium' : 'Low',
  };
}

export function calculateWeightedScore(signals, crawlData) {
  const context = {
    hasLoginForm:     crawlData.context?.hasLoginForm     ?? false,
    hasPasswordField: crawlData.context?.hasPasswordField ?? false,
    hasPaymentForm:   crawlData.context?.hasPaymentForm   ?? false,
    isHttps:          crawlData.isHttps                   ?? true,
    adTrackerCount:   crawlData.context?.adTrackerCount   ?? 0,
  };

  // Multiplicative accumulation: each active signal independently reduces
  // the privacy remaining. Signals compound — no single cap collapses the score.
  let privacyRemaining = 1.0;
  const breakdown = [];

  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    const val = signals[key];
    if (!val) continue;

    const multiplier     = severityMultiplier(key, context);
    const effectiveWeight = Math.min(weight * multiplier, MAX_SINGLE_SIGNAL);
    const factor         = 1 - effectiveWeight;

    privacyRemaining *= factor;

    breakdown.push({
      signal:          key,
      baseWeight:      Math.round(weight * 1000) / 1000,
      multiplier:      Math.round(multiplier * 100) / 100,
      effectiveWeight: Math.round(effectiveWeight * 1000) / 1000,
      factor:          Math.round(factor * 1000) / 1000,
    });
  }

  const confidence    = confidenceFactor(crawlData);
  // Floor at 1 — no site ever gets exactly 0. 0 implies infinite risk, which is meaningless.
  const score         = Math.max(1, Math.min(100, Math.round(privacyRemaining * confidence * 100)));
  const exploitability = calculateExploitability(signals, crawlData);

  return {
    score,
    confidence:    Math.round(confidence * 100),
    exploitability,
    riskBreakdown: breakdown.sort((a, b) => b.effectiveWeight - a.effectiveWeight),
    // privacyRemaining exposed for debugging — the raw pre-confidence fraction
    privacyRemaining: Math.round(privacyRemaining * 1000) / 1000,
  };
}
