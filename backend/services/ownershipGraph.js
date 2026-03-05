const DOMAIN_OWNERSHIP = {
  // ── Alphabet / Google ──────────────────────────────────────────────────────
  'google-analytics.com':    { parent: 'Alphabet (Google)', brand: 'Google Analytics',       color: '#4285F4', category: 'Analytics',     riskTier: 'medium'   },
  'googletagmanager.com':    { parent: 'Alphabet (Google)', brand: 'Google Tag Manager',     color: '#4285F4', category: 'Analytics',     riskTier: 'medium'   },
  'doubleclick.net':         { parent: 'Alphabet (Google)', brand: 'Google DoubleClick',     color: '#EA4335', category: 'Advertising',   riskTier: 'high'     },
  'googlesyndication.com':   { parent: 'Alphabet (Google)', brand: 'Google AdSense',         color: '#EA4335', category: 'Advertising',   riskTier: 'high'     },
  'googleadservices.com':    { parent: 'Alphabet (Google)', brand: 'Google Ads',             color: '#EA4335', category: 'Advertising',   riskTier: 'high'     },
  'youtube.com':             { parent: 'Alphabet (Google)', brand: 'YouTube',                color: '#FF0000', category: 'Media',         riskTier: 'low'      },
  'ytimg.com':               { parent: 'Alphabet (Google)', brand: 'YouTube CDN',            color: '#FF0000', category: 'Infrastructure',riskTier: 'low'      },
  'ggpht.com':               { parent: 'Alphabet (Google)', brand: 'Google',                 color: '#4285F4', category: 'Infrastructure',riskTier: 'low'      },

  // ── Meta Platforms ────────────────────────────────────────────────────────
  'facebook.net':            { parent: 'Meta Platforms',    brand: 'Meta Pixel',             color: '#1877F2', category: 'Advertising',   riskTier: 'high'     },
  'facebook.com':            { parent: 'Meta Platforms',    brand: 'Facebook',               color: '#1877F2', category: 'Social',        riskTier: 'medium'   },
  'instagram.com':           { parent: 'Meta Platforms',    brand: 'Instagram',              color: '#E4405F', category: 'Social',        riskTier: 'medium'   },
  'fbcdn.net':               { parent: 'Meta Platforms',    brand: 'Facebook CDN',           color: '#1877F2', category: 'Infrastructure',riskTier: 'low'      },

  // ── Microsoft ─────────────────────────────────────────────────────────────
  'bing.com':                { parent: 'Microsoft',         brand: 'Bing Ads',               color: '#00A4EF', category: 'Advertising',   riskTier: 'high'     },
  'clarity.ms':              { parent: 'Microsoft',         brand: 'Microsoft Clarity',      color: '#00A4EF', category: 'Session Replay',riskTier: 'high'     },
  'linkedin.com':            { parent: 'Microsoft',         brand: 'LinkedIn',               color: '#0A66C2', category: 'Social',        riskTier: 'medium'   },
  'licdn.com':               { parent: 'Microsoft',         brand: 'LinkedIn CDN',           color: '#0A66C2', category: 'Infrastructure',riskTier: 'low'      },
  'bat.bing.com':            { parent: 'Microsoft',         brand: 'Bing Tracking',          color: '#00A4EF', category: 'Advertising',   riskTier: 'high'     },

  // ── X Corp ────────────────────────────────────────────────────────────────
  'twitter.com':             { parent: 'X Corp',            brand: 'Twitter/X',              color: '#1DA1F2', category: 'Social',        riskTier: 'medium'   },
  'ads-twitter.com':         { parent: 'X Corp',            brand: 'Twitter/X Ads',          color: '#1DA1F2', category: 'Advertising',   riskTier: 'high'     },
  'twimg.com':               { parent: 'X Corp',            brand: 'Twitter CDN',            color: '#1DA1F2', category: 'Infrastructure',riskTier: 'low'      },

  // ── Amazon ────────────────────────────────────────────────────────────────
  'amazon-adsystem.com':     { parent: 'Amazon',            brand: 'Amazon Ads',             color: '#FF9900', category: 'Advertising',   riskTier: 'high'     },
  'advertising.amazon.com':  { parent: 'Amazon',            brand: 'Amazon DSP',             color: '#FF9900', category: 'Advertising',   riskTier: 'high'     },

  // ── Session Replay ────────────────────────────────────────────────────────
  'hotjar.com':              { parent: 'Hotjar Ltd',        brand: 'Hotjar',                 color: '#FD3A5C', category: 'Session Replay',riskTier: 'high'     },
  'static.hotjar.com':       { parent: 'Hotjar Ltd',        brand: 'Hotjar',                 color: '#FD3A5C', category: 'Session Replay',riskTier: 'high'     },
  'fullstory.com':           { parent: 'FullStory Inc',     brand: 'FullStory',              color: '#1ABC9C', category: 'Session Replay',riskTier: 'high'     },
  'logrocket.com':           { parent: 'LogRocket Inc',     brand: 'LogRocket',              color: '#764ABC', category: 'Session Replay',riskTier: 'high'     },
  'mouseflow.com':           { parent: 'Mouseflow ApS',     brand: 'Mouseflow',              color: '#E91E63', category: 'Session Replay',riskTier: 'high'     },
  'smartlook.com':           { parent: 'Smartlook s.r.o.',  brand: 'Smartlook',              color: '#00B4D8', category: 'Session Replay',riskTier: 'high'     },
  'luckyorange.com':         { parent: 'Lucky Orange LLC',  brand: 'Lucky Orange',           color: '#FFA500', category: 'Session Replay',riskTier: 'high'     },

  // ── Identity Resolution / Data Brokers ────────────────────────────────────
  'criteo.com':              { parent: 'Criteo SA',         brand: 'Criteo',                 color: '#F5A623', category: 'Identity Resolution', riskTier: 'high' },
  'criteo.net':              { parent: 'Criteo SA',         brand: 'Criteo',                 color: '#F5A623', category: 'Identity Resolution', riskTier: 'high' },
  'adsrvr.org':              { parent: 'The Trade Desk',    brand: 'The Trade Desk',         color: '#2B6CB0', category: 'Identity Resolution', riskTier: 'high' },
  'id5-sync.com':            { parent: 'ID5',               brand: 'ID5 Identity',           color: '#7B2FBE', category: 'Identity Resolution', riskTier: 'high' },
  'liveramp.com':            { parent: 'LiveRamp',          brand: 'LiveRamp',               color: '#E53935', category: 'Data Broker',   riskTier: 'critical' },
  'adnxs.com':               { parent: 'Xandr (Microsoft)', brand: 'Xandr/AppNexus',         color: '#0078D4', category: 'Advertising',   riskTier: 'high'     },
  'rubiconproject.com':      { parent: 'Magnite',           brand: 'Rubicon Project',        color: '#E63946', category: 'Advertising',   riskTier: 'high'     },
  'pubmatic.com':            { parent: 'PubMatic',          brand: 'PubMatic',               color: '#457B9D', category: 'Advertising',   riskTier: 'high'     },

  // ── Behavioral Analytics ──────────────────────────────────────────────────
  'segment.io':              { parent: 'Twilio (Segment)',  brand: 'Segment',                color: '#52BD94', category: 'Analytics',     riskTier: 'medium'   },
  'segment.com':             { parent: 'Twilio (Segment)',  brand: 'Segment',                color: '#52BD94', category: 'Analytics',     riskTier: 'medium'   },
  'mixpanel.com':            { parent: 'Mixpanel Inc',      brand: 'Mixpanel',               color: '#7856FF', category: 'Analytics',     riskTier: 'medium'   },
  'amplitude.com':           { parent: 'Amplitude Inc',     brand: 'Amplitude',              color: '#2E86AB', category: 'Analytics',     riskTier: 'medium'   },
  'cdn.amplitude.com':       { parent: 'Amplitude Inc',     brand: 'Amplitude',              color: '#2E86AB', category: 'Analytics',     riskTier: 'medium'   },
  'heap.io':                 { parent: 'Heap Inc',          brand: 'Heap Analytics',         color: '#6B48FF', category: 'Analytics',     riskTier: 'medium'   },

  // ── Advertising ───────────────────────────────────────────────────────────
  'outbrain.com':            { parent: 'Outbrain Inc',      brand: 'Outbrain',               color: '#FF6B35', category: 'Advertising',   riskTier: 'medium'   },
  'taboola.com':             { parent: 'Taboola Inc',       brand: 'Taboola',                color: '#5B4FE9', category: 'Advertising',   riskTier: 'medium'   },
  'quantserve.com':          { parent: 'Quantcast Corp',    brand: 'Quantcast',              color: '#00B4D8', category: 'Advertising',   riskTier: 'high'     },
  'scorecardresearch.com':   { parent: 'Comscore Inc',      brand: 'Comscore',               color: '#2C3E50', category: 'Analytics',     riskTier: 'medium'   },
  'moatads.com':             { parent: 'Oracle Data Cloud', brand: 'Moat Analytics',         color: '#F80000', category: 'Analytics',     riskTier: 'medium'   },

  // ── Marketing / Functional ─────────────────────────────────────────────────
  'hubspot.com':             { parent: 'HubSpot Inc',       brand: 'HubSpot',                color: '#FF7A59', category: 'Marketing',     riskTier: 'low'      },
  'hs-scripts.com':          { parent: 'HubSpot Inc',       brand: 'HubSpot',                color: '#FF7A59', category: 'Marketing',     riskTier: 'low'      },
  'intercom.io':             { parent: 'Intercom Inc',      brand: 'Intercom',               color: '#6AFDEF', category: 'Support',       riskTier: 'low'      },
  'intercomcdn.com':         { parent: 'Intercom Inc',      brand: 'Intercom CDN',           color: '#6AFDEF', category: 'Infrastructure',riskTier: 'low'      },
  'zendesk.com':             { parent: 'Zendesk Inc',       brand: 'Zendesk',                color: '#03363D', category: 'Support',       riskTier: 'low'      },
  'zdassets.com':            { parent: 'Zendesk Inc',       brand: 'Zendesk CDN',            color: '#03363D', category: 'Infrastructure',riskTier: 'low'      },
};

// Risk tier color for graph nodes
const RISK_TIER_BORDER = {
  critical: '#c85a3a',
  high:     '#d4a040',
  medium:   '#c4a869',
  low:      '#5a9e6a',
};

function findOwnership(hostname) {
  if (DOMAIN_OWNERSHIP[hostname]) return DOMAIN_OWNERSHIP[hostname];
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (DOMAIN_OWNERSHIP[candidate]) return DOMAIN_OWNERSHIP[candidate];
  }
  return null;
}

/**
 * Build the ownership graph from external domains.
 * Optionally enriches unknown domains with ASN-based corporate inference.
 *
 * @param {string[]}  externalDomains   - All external hostnames from the crawl
 * @param {string}    siteUrl           - The site being analyzed
 * @param {Object}    asnResults        - Pre-computed ASN results from crawler
 *                                        (Map of domain → { asn, corporation })
 */
export function buildOwnershipGraph(externalDomains, siteUrl, asnResults = {}) {
  const siteHostname = (() => { try { return new URL(siteUrl).hostname; } catch { return siteUrl; } })();
  const companyMap   = new Map();

  for (const domain of externalDomains) {
    let ownership = findOwnership(domain);

    // Fallback: use ASN-based corporate inference from crawler
    if (!ownership && asnResults[domain]) {
      const asn = asnResults[domain];
      if (asn.corporation && asn.corporation !== 'Unknown') {
        ownership = {
          parent:    asn.corporation,
          brand:     domain,
          color:     '#888888',
          category:  'Infrastructure',
          riskTier:  'low',
          asnInferred: true,
          asn:       asn.asn,
        };
      }
    }

    if (!ownership) continue;

    if (!companyMap.has(ownership.parent)) {
      companyMap.set(ownership.parent, {
        parent:      ownership.parent,
        color:       ownership.color,
        riskTier:    ownership.riskTier || 'low',
        domains:     [],
        categories:  new Set(),
        asnInferred: ownership.asnInferred || false,
      });
    }

    const entry = companyMap.get(ownership.parent);
    entry.domains.push({ domain, brand: ownership.brand, category: ownership.category, riskTier: ownership.riskTier });
    entry.categories.add(ownership.category);
    // Upgrade riskTier to highest seen for this parent
    const tierOrder = { critical: 3, high: 2, medium: 1, low: 0 };
    if ((tierOrder[ownership.riskTier] || 0) > (tierOrder[entry.riskTier] || 0)) {
      entry.riskTier = ownership.riskTier;
    }
  }

  const nodes = [
    { id: 'site', label: siteHostname, type: 'site', color: '#00ff88', size: 20 },
    ...[...companyMap.entries()].map(([parent, info], i) => ({
      id:          `company_${i}`,
      label:       parent,
      type:        'company',
      color:       info.color,
      borderColor: RISK_TIER_BORDER[info.riskTier] || '#c4a869',
      size:        10 + info.domains.length * 3,
      domains:     info.domains,
      categories:  [...info.categories],
      domainCount: info.domains.length,
      riskTier:    info.riskTier,
      asnInferred: info.asnInferred || false,
    })),
  ];

  const edges = nodes
    .filter((n) => n.type === 'company')
    .map((n) => ({ source: 'site', target: n.id, label: n.domains.map((d) => d.brand).join(', ') }));

  const sorted      = [...companyMap.values()].sort((a, b) => b.domains.length - a.domains.length);
  const totalDomains = [...companyMap.values()].reduce((s, c) => s + c.domains.length, 0);
  const top3Domains  = sorted.slice(0, 3).reduce((s, c) => s + c.domains.length, 0);

  const categoryCount = {};
  const riskTierCount = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const company of companyMap.values()) {
    for (const cat of company.categories) categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    riskTierCount[company.riskTier] = (riskTierCount[company.riskTier] || 0) + 1;
  }

  return {
    nodes,
    edges,
    stats: {
      totalCompanies:         companyMap.size,
      identifiedDomains:      totalDomains,
      unknownDomains:         externalDomains.length - totalDomains,
      corporateConcentration: totalDomains > 0 ? Math.round((top3Domains / totalDomains) * 100) : 0,
      topCompanies:           sorted.slice(0, 3).map((c) => ({ name: c.parent, domains: c.domains.length, riskTier: c.riskTier })),
      categoryBreakdown:      categoryCount,
      riskTierBreakdown:      riskTierCount,
      asnInferredCount:       [...companyMap.values()].filter((c) => c.asnInferred).length,
    },
  };
}
