import { useEffect, useRef } from 'react';

/**
 * Company Ownership Graph
 * Force-directed graph using pure Canvas (no D3 dependency).
 * Shows which corporations collect data from the analyzed site.
 */

const NODE_RADIUS = { site: 18, company: 12 };

function useForceGraph(canvasRef, nodes, edges) {
  useEffect(() => {
    if (!canvasRef.current || !nodes.length) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // Initialize positions
    const positions = nodes.map((n, i) => {
      if (n.type === 'site') return { x: W / 2, y: H / 2, vx: 0, vy: 0 };
      const angle = (i / (nodes.length - 1)) * Math.PI * 2;
      const r = Math.min(W, H) * 0.32;
      return { x: W / 2 + Math.cos(angle) * r, y: H / 2 + Math.sin(angle) * r, vx: 0, vy: 0 };
    });

    let frame;
    let tick = 0;

    const simulate = () => {
      tick++;
      const alpha = Math.max(0.01, 1 - tick / 200);

      // Repulsion between nodes
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dx = positions[j].x - positions[i].x;
          const dy = positions[j].y - positions[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (3000 / (dist * dist)) * alpha;
          positions[i].vx -= (dx / dist) * force;
          positions[i].vy -= (dy / dist) * force;
          positions[j].vx += (dx / dist) * force;
          positions[j].vy += (dy / dist) * force;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const si = nodes.findIndex((n) => n.id === edge.source);
        const ti = nodes.findIndex((n) => n.id === edge.target);
        if (si < 0 || ti < 0) continue;
        const dx = positions[ti].x - positions[si].x;
        const dy = positions[ti].y - positions[si].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = Math.min(W, H) * 0.3;
        const force = ((dist - target) * 0.05) * alpha;
        positions[si].vx += (dx / dist) * force;
        positions[si].vy += (dy / dist) * force;
        positions[ti].vx -= (dx / dist) * force;
        positions[ti].vy -= (dy / dist) * force;
      }

      // Center gravity
      for (let i = 0; i < positions.length; i++) {
        positions[i].vx += ((W / 2 - positions[i].x) * 0.01) * alpha;
        positions[i].vy += ((H / 2 - positions[i].y) * 0.01) * alpha;
      }

      // Apply velocity + damping + bounds
      for (const p of positions) {
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.x = Math.max(30, Math.min(W - 30, p.x + p.vx));
        p.y = Math.max(30, Math.min(H - 30, p.y + p.vy));
      }

      // Draw
      ctx.clearRect(0, 0, W, H);

      // Edges
      for (const edge of edges) {
        const si = nodes.findIndex((n) => n.id === edge.source);
        const ti = nodes.findIndex((n) => n.id === edge.target);
        if (si < 0 || ti < 0) continue;
        ctx.beginPath();
        ctx.moveTo(positions[si].x, positions[si].y);
        ctx.lineTo(positions[ti].x, positions[ti].y);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Nodes
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const pos = positions[i];
        const r = node.type === 'site' ? NODE_RADIUS.site : NODE_RADIUS.company;

        // Glow
        const grd = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r * 2.5);
        grd.addColorStop(0, node.color + '33');
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Node circle
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Label
        ctx.font = node.type === 'site' ? 'bold 11px Space Mono, monospace' : '10px Space Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(
          node.label.length > 20 ? node.label.slice(0, 18) + '…' : node.label,
          pos.x,
          pos.y + r + 14
        );
      }

      if (tick < 250) frame = requestAnimationFrame(simulate);
    };

    frame = requestAnimationFrame(simulate);
    return () => cancelAnimationFrame(frame);
  }, [nodes, edges]);
}

export default function OwnershipGraph({ ownershipGraph }) {
  const canvasRef = useRef(null);

  if (!ownershipGraph) return null;
  const { nodes, edges, stats } = ownershipGraph;

  useForceGraph(canvasRef, nodes, edges);

  if (stats.totalCompanies === 0) return (
    <div className="section">
      <div className="section-header">
        <span className="section-title"><span>◈</span> Company Ownership Graph</span>
        <span className="section-count">0 companies</span>
      </div>
      <div className="empty-state"><span className="check">✓</span> No known data collectors identified</div>
    </div>
  );

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title"><span>⬡</span> Company Ownership Graph</span>
        <span className="section-count">{stats.totalCompanies} companies</span>
      </div>

      {/* Graph canvas */}
      <div style={{ background: 'var(--bg)', padding: '8px' }}>
        <canvas
          ref={canvasRef}
          width={860}
          height={400}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      {/* Stats row */}
      <div className="ownership-stats">
        <div className="ownership-stat">
          <span className="ownership-stat-value">{stats.totalCompanies}</span>
          <span className="ownership-stat-label">Companies identified</span>
        </div>
        <div className="ownership-stat">
          <span className="ownership-stat-value">{stats.corporateConcentration}%</span>
          <span className="ownership-stat-label">Data to top 3</span>
        </div>
        <div className="ownership-stat">
          <span className="ownership-stat-value">{stats.identifiedDomains}</span>
          <span className="ownership-stat-label">Domains mapped</span>
        </div>
        <div className="ownership-stat">
          <span className="ownership-stat-value">{stats.unknownDomains}</span>
          <span className="ownership-stat-label">Unknown domains</span>
        </div>
      </div>

      {/* Top companies */}
      {stats.topCompanies.length > 0 && (
        <div style={{ padding: '4px 24px 16px', borderTop: '1px solid var(--border)' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', marginBottom: 8 }}>
            TOP DATA COLLECTORS
          </p>
          {stats.topCompanies.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '12px', marginBottom: 4 }}>
              <span>{c.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{c.domains} domain(s)</span>
            </div>
          ))}
        </div>
      )}

      {/* Category breakdown */}
      {Object.keys(stats.categoryBreakdown).length > 0 && (
        <div className="domains-grid" style={{ borderTop: '1px solid var(--border)' }}>
          {Object.entries(stats.categoryBreakdown).map(([cat, count]) => (
            <span key={cat} className="domain-tag">
              {cat} ({count})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
