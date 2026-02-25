/**
 * Company Ownership Graph Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps tracker domains → parent companies and builds a graph showing
 * which corporate entities are collecting data and how they're connected.
 *
 * Reveals the hidden truth: visiting one site often means data flows to
 * a handful of massive companies (Google, Meta, Alphabet subsidiaries, etc.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Domain → parent company + data category mapping
// Each entry represents who REALLY owns/operates this domain
const DOMAIN_OWNERSHIP = {
  // ── Google / Alphabet ──────────────────────────────────────────────────────
  'google-analytics.com':    { parent: 'Alphabet (Google)', brand: 'Google Analytics',   color: '#4285F4', category: 'Analytics'    },
  'googletagmanager.com':    { parent: 'Alphabet (Google)', brand: 'Google Tag Manager', color: '#4285F4', category: 'Analytics'    },
  'doubleclick.net':         { parent: 'Alphabet (Google)', brand: 'Google DoubleClick', color: '#EA4335', category: 'Advertising'  },
  'googlesyndication.com':   { parent: 'Alphabet (Google)', brand: 'Google AdSense',     color: '#EA4335', category: 'Advertising'  },
  'googleadservices.com':    { parent: 'Alphabet (Google)', brand: 'Google Ads',         color: '#EA4335', category: 'Advertising'  },
  'youtube.com':             { parent: 'Alphabet (Google)', brand: 'YouTube',            color: '#FF0000', category: 'Media'        },
  'ytimg.com':               { parent: 'Alphabet (Google)', brand: 'YouTube',            color: '#FF0000', category: 'Media'        },
  'ggpht.com':               { parent: 'Alphabet (Google)', brand: 'Google',             color: '#4285F4', category: 'Infrastructure'},

  // ── Meta ──────────────────────────────────────────────────────────────────
  'facebook.net':            { parent: 'Meta Platforms',    brand: 'Meta Pixel',         color: '#1877F2', category: 'Advertising'  },
  'facebook.com':            { parent: 'Meta Platforms',    brand: 'Facebook',           color: '#1877F2', category: 'Social'       },
  'instagram.com':           { parent: 'Meta Platforms',    brand: 'Instagram',          color: '#E4405F', category: 'Social'       },
  'whatsapp.com':            { parent: 'Meta Platforms',    brand: 'WhatsApp',           color: '#25D366', category: 'Messaging'    },
  'fbcdn.net':               { parent: 'Meta Platforms',    brand: 'Facebook CDN',       color: '#1877F2', category: 'Infrastructure'},

  // ── Microsoft ─────────────────────────────────────────────────────────────
  'bing.com':                { parent: 'Microsoft',         brand: 'Bing Ads',           color: '#00A4EF', category: 'Advertising'  },
  'clarity.ms':              { parent: 'Microsoft',         brand: 'Microsoft Clarity',  color: '#00A4EF', category: 'Analytics'    },
  'linkedin.com':            { parent: 'Microsoft',         brand: 'LinkedIn',           color: '#0A66C2', category: 'Social'       },
  'licdn.com':               { parent: 'Microsoft',         brand: 'LinkedIn CDN',       color: '#0A66C2', category: 'Infrastructure'},
  'bat.bing.com':            { parent: 'Microsoft',         brand: 'Bing Tracking',      color: '#00A4EF', category: 'Advertising'  },

  // ── Twitter / X ───────────────────────────────────────────────────────────
  'twitter.com':             { parent: 'X Corp',            brand: 'Twitter/X',          color: '#1DA1F2', category: 'Social'       },
  'ads-twitter.com':         { parent: 'X Corp',            brand: 'Twitter Ads',        color: '#1DA1F2', category: 'Advertising'  },
  'twimg.com':               { parent: 'X Corp',            brand: 'Twitter CDN',        color: '#1DA1F2', category: 'Infrastructure'},

  // ── Amazon ────────────────────────────────────────────────────────────────
  'amazon-adsystem.com':     { parent: 'Amazon',            brand: 'Amazon Ads',         color: '#FF9900', category: 'Advertising'  },
  'advertising.amazon.com':  { parent: 'Amazon',            brand: 'Amazon DSP',         color: '#FF9900', category: 'Advertising'  },

  // ── Hotjar ────────────────────────────────────────────────────────────────
  'hotjar.com':              { parent: 'Hotjar Ltd',        brand: 'Hotjar',             color: '#FD3A5C', category: 'Session Replay'},
  'static.hotjar.com':       { parent: 'Hotjar Ltd',        brand: 'Hotjar',             color: '#FD3A5C', category: 'Session Replay'},

  // ── Segment / Twilio ──────────────────────────────────────────────────────
  'segment.io':              { parent: 'Twilio (Segment)',  brand: 'Segment',            color: '#52BD94', category: 'Analytics'    },
  'segment.com':             { parent: 'Twilio (Segment)',  brand: 'Segment',            color: '#52BD94', category: 'Analytics'    },

  // ── Mixpanel ──────────────────────────────────────────────────────────────
  'mixpanel.com':            { parent: 'Mixpanel Inc',      brand: 'Mixpanel',           color: '#7856FF', category: 'Analytics'    },

  // ── Amplitude ─────────────────────────────────────────────────────────────
  'amplitude.com':           { parent: 'Amplitude Inc',     brand: 'Amplitude',          color: '#2E86AB', category: 'Analytics'    },
  'cdn.amplitude.com':       { parent: 'Amplitude Inc',     brand: 'Amplitude',          color: '#2E86AB', category: 'Analytics'    },

  // ── Criteo ────────────────────────────────────────────────────────────────
  'criteo.com':              { parent: 'Criteo SA',         brand: 'Criteo',             color: '#F5A623', category: 'Advertising'  },
  'criteo.net':              { parent: 'Criteo SA',         brand: 'Criteo',             color: '#F5A623', category: 'Advertising'  },

  // ── The Trade Desk ────────────────────────────────────────────────────────
  'adsrvr.org':              { parent: 'The Trade Desk',    brand: 'The Trade Desk',     color: '#2B6CB0', category: 'Advertising'  },

  // ── Outbrain / Taboola ────────────────────────────────────────────────────
  'outbrain.com':            { parent: 'Outbrain Inc',      brand: 'Outbrain',           color: '#FF6B35', category: 'Advertising'  },
  'taboola.com':             { parent: 'Taboola Inc',       brand: 'Taboola',            color: '#5B4FE9', category: 'Advertising'  },

  // ── Quantcast ─────────────────────────────────────────────────────────────
  'quantserve.com':          { parent: 'Quantcast Corp',    brand: 'Quantcast',          color: '#00B4D8', category: 'Advertising'  },

  // ── Comscore ──────────────────────────────────────────────────────────────
  'scorecardresearch.com':   { parent: 'Comscore Inc',      brand: 'Comscore',           color: '#2C3E50', category: 'Analytics'    },

  // ── Hubspot ───────────────────────────────────────────────────────────────
  'hubspot.com':             { parent: 'HubSpot Inc',       brand: 'HubSpot',            color: '#FF7A59', category: 'Marketing'    },
  'hs-scripts.com':          { parent: 'HubSpot Inc',       brand: 'HubSpot',            color: '#FF7A59', category: 'Marketing'    },

  // ── FullStory ─────────────────────────────────────────────────────────────
  'fullstory.com':           { parent: 'FullStory Inc',     brand: 'FullStory',          color: '#1ABC9C', category: 'Session Replay'},
  'rs6.net':                 { parent: 'Constant Contact',  brand: 'Constant Contact',   color: '#5BA4CF', category: 'Marketing'    },

  // ── Intercom ──────────────────────────────────────────────────────────────
  'intercom.io':             { parent: 'Intercom Inc',      brand: 'Intercom',           color: '#6AFDEF', category: 'Support'      },
  'intercomcdn.com':         { parent: 'Intercom Inc',      brand: 'Intercom CDN',       color: '#6AFDEF', category: 'Infrastructure'},
};

/**
 * Find ownership info for a given hostname.
 * Checks exact match and suffix match (e.g. sub.domain.com → domain.com).
 */
function findOwnership(hostname) {
  if (DOMAIN_OWNERSHIP[hostname]) return DOMAIN_OWNERSHIP[hostname];

  // Try stripping subdomains
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (DOMAIN_OWNERSHIP[candidate]) return DOMAIN_OWNERSHIP[candidate];
  }
  return null;
}

/**
 * Build the ownership graph from a list of external domains.
 *
 * Returns:
 *  - nodes: companies + the site itself
 *  - edges: site → company connections
 *  - corporateConcentration: % of trackers owned by top 3 companies
 */
export function buildOwnershipGraph(externalDomains, siteUrl) {
  const siteHostname = (() => { try { return new URL(siteUrl).hostname; } catch { return siteUrl; } })();

  // Map parent company → their domains found on this site
  const companyMap = new Map();

  for (const domain of externalDomains) {
    const ownership = findOwnership(domain);
    if (!ownership) continue;

    if (!companyMap.has(ownership.parent)) {
      companyMap.set(ownership.parent, {
        parent: ownership.parent,
        color: ownership.color,
        domains: [],
        categories: new Set(),
      });
    }
    const entry = companyMap.get(ownership.parent);
    entry.domains.push({ domain, brand: ownership.brand, category: ownership.category });
    entry.categories.add(ownership.category);
  }

  // Build nodes array
  // Node 0 is always the site being analyzed
  const nodes = [
    {
      id: 'site',
      label: siteHostname,
      type: 'site',
      color: '#00ff88',
      size: 20,
    },
    ...[...companyMap.entries()].map(([parent, info], i) => ({
      id: `company_${i}`,
      label: parent,
      type: 'company',
      color: info.color,
      size: 10 + info.domains.length * 3,
      domains: info.domains,
      categories: [...info.categories],
      domainCount: info.domains.length,
    })),
  ];

  // Build edges: site → each company
  const edges = nodes
    .filter((n) => n.type === 'company')
    .map((n) => ({
      source: 'site',
      target: n.id,
      label: n.domains.map((d) => d.brand).join(', '),
    }));

  // Corporate concentration: what % of identified companies are top 3?
  const sorted = [...companyMap.values()].sort((a, b) => b.domains.length - a.domains.length);
  const totalDomains = [...companyMap.values()].reduce((s, c) => s + c.domains.length, 0);
  const top3Domains = sorted.slice(0, 3).reduce((s, c) => s + c.domains.length, 0);

  // Category breakdown
  const categoryCount = {};
  for (const company of companyMap.values()) {
    for (const cat of company.categories) {
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }
  }

  return {
    nodes,
    edges,
    stats: {
      totalCompanies: companyMap.size,
      identifiedDomains: totalDomains,
      unknownDomains: externalDomains.length - totalDomains,
      corporateConcentration: totalDomains > 0 ? Math.round((top3Domains / totalDomains) * 100) : 0,
      topCompanies: sorted.slice(0, 3).map((c) => ({ name: c.parent, domains: c.domains.length })),
      categoryBreakdown: categoryCount,
    },
  };
}
