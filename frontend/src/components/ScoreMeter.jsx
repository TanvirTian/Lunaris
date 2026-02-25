import { useEffect, useState } from 'react';

// Circumference of circle with r=54: 2 * π * 54 ≈ 339.29
const CIRCUMFERENCE = 2 * Math.PI * 54;

function scoreColor(score) {
  if (score >= 75) return 'var(--safe)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--danger)';
}

export default function ScoreMeter({ score }) {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    // Animate from 0 to score
    const timer = setTimeout(() => setAnimated(score), 50);
    return () => clearTimeout(timer);
  }, [score]);

  const offset = CIRCUMFERENCE - (animated / 100) * CIRCUMFERENCE;
  const color = scoreColor(score);

  return (
    <div className="score-ring">
      <svg width="140" height="140" viewBox="0 0 140 140">
        {/* Background track */}
        <circle
          className="score-ring-bg"
          cx="70" cy="70" r="54"
          fill="none"
          strokeWidth="8"
        />
        {/* Animated fill */}
        <circle
          className="score-ring-fill"
          cx="70" cy="70" r="54"
          fill="none"
          strokeWidth="8"
          stroke={color}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="score-label">
        <span className="score-number" style={{ color }}>{score}</span>
        <span className="score-unit">/100</span>
      </div>
    </div>
  );
}
