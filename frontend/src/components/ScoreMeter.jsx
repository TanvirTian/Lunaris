/**
 * ScoreMeter — Planetary Threat Observatory
 *
 * Visual language:
 *   SECURE   (80-100) — cool teal moon, 1 slow peaceful orbit, crater surface, steady glow
 *   MODERATE (60-79)  — warm gold planet, 2 orbits, gentle pulse
 *   ELEVATED (40-59)  — hot amber world, 2 fast orbits, agitated pulse, heat surface
 *   CRITICAL  (0-39)  — burning red sphere, 3 frantic orbits, radar sweep, lava surface, alarm pulse
 *
 * The outer ring shows 40 tick dots (lit = scored), a continuous arc fill, and
 * three tier boundary markers at 40/60/80 — so users always see where they sit.
 */

import { useEffect, useRef, useState } from 'react';

/* ─── Tier configs ───────────────────────────────────────────────────────── */
const TIERS = {
  secure: {
    label:       'SECURE',
    rgb:         [79, 195, 160],
    core:        ['#1a4a3c', '#0c2420', '#061510'],
    orbitCount:  1,
    ppOrbit:     [2],
    basePeriod:  11,     // seconds for inner orbit full rotation
    pulseFreq:   0,      // Hz — 0 = no pulse
    pulseAmp:    0,
    glowBase:    14,
  },
  moderate: {
    label:       'MODERATE',
    rgb:         [196, 168, 105],
    core:        ['#3d2f12', '#1e1808', '#0e0d04'],
    orbitCount:  2,
    ppOrbit:     [2, 1],
    basePeriod:  7,
    pulseFreq:   0.18,
    pulseAmp:    8,
    glowBase:    18,
  },
  elevated: {
    label:       'ELEVATED',
    rgb:         [218, 128, 28],
    core:        ['#3d1e05', '#1e0f03', '#0f0802'],
    orbitCount:  2,
    ppOrbit:     [3, 2],
    basePeriod:  4,
    pulseFreq:   0.33,
    pulseAmp:    16,
    glowBase:    22,
  },
  critical: {
    label:       'CRITICAL',
    rgb:         [200, 88, 56],
    core:        ['#3d1206', '#200802', '#100401'],
    orbitCount:  3,
    ppOrbit:     [3, 2, 2],
    basePeriod:  2.2,
    pulseFreq:   0.67,
    pulseAmp:    24,
    glowBase:    28,
  },
};

function getTier(s) {
  if (s >= 80) return TIERS.secure;
  if (s >= 60) return TIERS.moderate;
  if (s >= 40) return TIERS.elevated;
  return TIERS.critical;
}

/* ─── Geometry constants ─────────────────────────────────────────────────── */
const CX = 100, CY = 100;

// Three elliptical orbit planes, each slightly tilted for the 3-D perspective illusion
const ORBITS = [
  { rx: 50, ry: 17, tilt: -0.42 },
  { rx: 62, ry: 21, tilt:  0.28 },
  { rx: 74, ry: 26, tilt: -0.18 },
];

// Deterministic star field (golden-angle distribution, excludes the core region)
const STARS = (() => {
  const out = [];
  for (let i = 0; i < 44; i++) {
    const ang = ((i * 137.508) % 360) * Math.PI / 180;
    const d   = 22 + (i * 53 % 68);
    const x   = CX + d * Math.cos(ang);
    const y   = CY + d * Math.sin(ang);
    if ((x - CX) ** 2 + (y - CY) ** 2 > 42 ** 2)
      out.push({ x, y, r: 0.35 + (i % 3) * 0.3, a: 0.1 + (i % 6) * 0.055 });
  }
  return out;
})();

// Moon crater geometry (only shown in SECURE tier)
const CRATERS = [
  { dx: -8,  dy: -5,  r: 4.5 },
  { dx: +10, dy: +8,  r: 3.0 },
  { dx: -3,  dy: +12, r: 4.0 },
  { dx: +6,  dy: -14, r: 2.5 },
  { dx: -14, dy: +4,  r: 2.0 },
];

// Hot spots for CRITICAL tier (lava surface)
const HOT_SPOTS = [
  [CX + 8,  CY - 10, 3.0, 0.0 ],
  [CX - 12, CY + 8,  2.5, 1.1 ],
  [CX + 4,  CY + 14, 2.0, 2.2 ],
  [CX - 6,  CY - 14, 1.8, 0.7 ],
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

/* ─── ScoreMeter component ───────────────────────────────────────────────── */
export default function ScoreMeter({ score: raw }) {
  const score     = Math.max(0, Math.min(100, raw ?? 0));
  const tier      = getTier(score);
  const canvasRef = useRef(null);
  const frameRef  = useRef(null);
  const arcScore  = useRef(0);   // animated score value read by canvas loop
  const [display, setDisplay] = useState(0);

  /* ── Count-up animation: drives the number AND the arc fill ── */
  useEffect(() => {
    let raf;
    let start = null;
    const dur = 1400;

    function step(ts) {
      if (!start) start = ts;
      const p    = Math.min((ts - start) / dur, 1);
      const ease = 1 - (1 - p) ** 3;          // ease-out-cubic
      const v    = Math.round(score * ease);
      arcScore.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  /* ── Canvas animation loop ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W   = 200, H = 200;
    const dpr = window.devicePixelRatio || 1;
    canvas.width         = W * dpr;
    canvas.height        = H * dpr;
    canvas.style.width   = `${W}px`;
    canvas.style.height  = `${H}px`;
    ctx.scale(dpr, dpr);

    /* Init particles — evenly distributed along each orbit */
    const particles = [];
    tier.ppOrbit.forEach((n, oi) => {
      const period = tier.basePeriod * (1 + oi * 0.40);
      for (let i = 0; i < n; i++) {
        particles.push({
          oi,
          theta: (i / n) * Math.PI * 2,
          spd:   (Math.PI * 2) / (period * 60),   // rad/frame at 60fps
          sz:    1.7 + Math.random() * 1.4,
          phase: Math.random() * Math.PI * 2,
        });
      }
    });

    let t = 0;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      t += 1 / 60;
      const sc = arcScore.current;
      const pv = tier.pulseFreq > 0
        ? Math.sin(t * tier.pulseFreq * Math.PI * 2)
        : 0;

      /* ── Background stars ── */
      STARS.forEach(s => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240,232,210,${s.a})`;
        ctx.fill();
      });

      /* ── Orbit ellipses ── */
      for (let oi = 0; oi < tier.orbitCount; oi++) {
        const { rx, ry, tilt } = ORBITS[oi];
        ctx.save();
        ctx.translate(CX, CY);
        ctx.rotate(tilt);
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(tier.rgb, 0.12 + oi * 0.04);
        ctx.lineWidth   = 0.6;
        ctx.stroke();
        ctx.restore();
      }

      /* ── Orbiting particles (with depth illusion) ── */
      particles.forEach(p => {
        p.theta += p.spd;
        const { rx, ry, tilt } = ORBITS[p.oi];
        const lx = rx * Math.cos(p.theta);
        const ly = ry * Math.sin(p.theta);
        const c  = Math.cos(tilt), s_ = Math.sin(tilt);
        const wx = CX + lx * c - ly * s_;
        const wy = CY + lx * s_ + ly * c;

        // depth: 0 = behind sphere, 1 = directly in front
        const depth  = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(p.theta));
        const twinkle = 0.82 + 0.18 * Math.sin(t * 2.4 + p.phase);
        const sz     = p.sz * (0.55 + 0.45 * depth);

        ctx.beginPath();
        ctx.arc(wx, wy, sz, 0, Math.PI * 2);
        ctx.fillStyle = rgba(tier.rgb, depth * twinkle);
        if (depth > 0.6) {
          ctx.shadowColor = rgba(tier.rgb, 0.85);
          ctx.shadowBlur  = 5 + 4 * depth;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      /* ── Radar sweep (CRITICAL only) — threat-monitoring aesthetic ── */
      if (tier.label === 'CRITICAL') {
        const sweepA = (t * tier.pulseFreq * Math.PI * 4) % (Math.PI * 2);
        const fan = 0.5;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, 80, sweepA - fan, sweepA);
        ctx.closePath();
        ctx.fillStyle = rgba(tier.rgb, 0.07 + 0.04 * Math.abs(pv));
        ctx.fill();
        ctx.restore();
      }

      /* ── Atmospheric haze around core ── */
      const haze = ctx.createRadialGradient(CX, CY, 22, CX, CY, 48);
      haze.addColorStop(0,    rgba(tier.rgb, 0));
      haze.addColorStop(0.55, rgba(tier.rgb, 0.04 + 0.03 * Math.abs(pv)));
      haze.addColorStop(1,    rgba(tier.rgb, 0));
      ctx.beginPath();
      ctx.arc(CX, CY, 48, 0, Math.PI * 2);
      ctx.fillStyle = haze;
      ctx.fill();

      /* ── Central planetary sphere ── */
      const glowRadius = tier.glowBase + tier.pulseAmp * pv;
      const sphereGrad = ctx.createRadialGradient(CX - 9, CY - 9, 1, CX, CY, 28);
      sphereGrad.addColorStop(0,    tier.core[0]);
      sphereGrad.addColorStop(0.55, tier.core[1]);
      sphereGrad.addColorStop(1,    tier.core[2]);

      ctx.beginPath();
      ctx.arc(CX, CY, 28, 0, Math.PI * 2);
      ctx.fillStyle   = sphereGrad;
      ctx.shadowColor = rgba(tier.rgb, 0.75);
      ctx.shadowBlur  = Math.max(0, glowRadius);
      ctx.fill();
      ctx.shadowBlur = 0;

      /* ── Surface detail (clipped to sphere) ── */
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, 28, 0, Math.PI * 2);
      ctx.clip();

      if (tier.label === 'SECURE') {
        // Moon craters
        CRATERS.forEach(({ dx, dy, r }) => {
          ctx.beginPath();
          ctx.arc(CX + dx, CY + dy, r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(240,232,210,0.07)';
          ctx.lineWidth   = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(CX + dx, CY + dy, r * 0.65, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.13)';
          ctx.fill();
        });
      } else if (tier.label === 'ELEVATED') {
        // Heat band across the equator
        const bandGrad = ctx.createLinearGradient(CX - 28, CY + 4, CX + 28, CY + 4);
        bandGrad.addColorStop(0,   'rgba(255,140,30,0)');
        bandGrad.addColorStop(0.5, 'rgba(255,140,30,0.09)');
        bandGrad.addColorStop(1,   'rgba(255,140,30,0)');
        ctx.fillStyle = bandGrad;
        ctx.fillRect(CX - 28, CY, 56, 12);
      } else if (tier.label === 'CRITICAL') {
        // Lava hot spots that pulse
        HOT_SPOTS.forEach(([x, y, r, phase]) => {
          const hp = Math.abs(Math.sin(t * 1.8 + phase));
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,140,40,${0.14 + 0.22 * hp})`;
          ctx.shadowColor = 'rgba(255,100,20,0.9)';
          ctx.shadowBlur  = 3 + 5 * hp;
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      }
      ctx.restore();

      /* ── Specular highlight (light from upper-left) ── */
      const hlGrad = ctx.createRadialGradient(CX - 11, CY - 11, 0, CX - 7, CY - 7, 16);
      hlGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
      hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(CX, CY, 28, 0, Math.PI * 2);
      ctx.fillStyle = hlGrad;
      ctx.fill();

      /* ── Sphere rim light ── */
      ctx.beginPath();
      ctx.arc(CX, CY, 28, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(tier.rgb, 0.22);
      ctx.lineWidth   = 1;
      ctx.stroke();

      /* ── Score tick ring (40 dots, lit = within score) ── */
      const R_TICK = 91;
      for (let i = 0; i < 40; i++) {
        const frac  = i / 40;
        const angle = -Math.PI / 2 + frac * Math.PI * 2;
        const lit   = frac <= sc / 100;
        const tx    = CX + R_TICK * Math.cos(angle);
        const ty    = CY + R_TICK * Math.sin(angle);
        ctx.beginPath();
        ctx.arc(tx, ty, 1.25, 0, Math.PI * 2);
        ctx.fillStyle = lit ? rgba(tier.rgb, 0.88) : 'rgba(196,168,105,0.10)';
        ctx.fill();
      }

      /* ── Score arc fill ── */
      const R_ARC = 85;
      if (sc > 0) {
        ctx.beginPath();
        ctx.arc(CX, CY, R_ARC, -Math.PI / 2, -Math.PI / 2 + (sc / 100) * Math.PI * 2);
        ctx.strokeStyle = rgba(tier.rgb, 0.85);
        ctx.lineWidth   = 2.5;
        ctx.lineCap     = 'round';
        ctx.shadowColor = rgba(tier.rgb, 0.5);
        ctx.shadowBlur  = 6;
        ctx.stroke();
        ctx.shadowBlur  = 0;
      }

      /* ── Tier boundary markers ── */
      // Three marks at 40, 60, 80 showing where the risk tiers change.
      // Users can instantly see which zone they're in.
      [
        [0.40, [200, 88,  56]],
        [0.60, [218, 128, 28]],
        [0.80, [79,  195, 160]],
      ].forEach(([frac, rgb]) => {
        const angle = -Math.PI / 2 + frac * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(CX + (R_ARC - 5) * Math.cos(angle), CY + (R_ARC - 5) * Math.sin(angle));
        ctx.lineTo(CX + (R_TICK + 3) * Math.cos(angle), CY + (R_TICK + 3) * Math.sin(angle));
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`;
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      });

      frameRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  }, [score]); // restart when score changes (new tier = new particles)

  const [r, g, b] = tier.rgb;

  return (
    <div style={{ position: 'relative', width: 200, height: 200, flexShrink: 0 }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />

      {/* Score number + label overlay */}
      <div style={{
        position:       'absolute',
        inset:          0,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        pointerEvents:  'none',
        gap:            2,
      }}>
        <span style={{
          fontFamily:  'Orbitron, monospace',
          fontSize:    40,
          fontWeight:  800,
          lineHeight:  1,
          letterSpacing: '-0.02em',
          color:       `rgb(${r},${g},${b})`,
          textShadow:  `0 0 18px rgba(${r},${g},${b},0.5)`,
          transition:  'color 0.7s, text-shadow 0.7s',
        }}>
          {display}
        </span>
        <span style={{
          fontFamily:    'JetBrains Mono, monospace',
          fontSize:      9,
          letterSpacing: '0.12em',
          color:         '#524838',
        }}>
          /100
        </span>
        <span style={{
          fontFamily:    'JetBrains Mono, monospace',
          fontSize:      8,
          letterSpacing: '0.20em',
          marginTop:     4,
          color:         `rgba(${r},${g},${b},0.65)`,
          transition:    'color 0.7s',
        }}>
          {tier.label}
        </span>
      </div>
    </div>
  );
}