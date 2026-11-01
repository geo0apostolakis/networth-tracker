// Orbit's drawn pieces, after the illustrated space scene on
// secure-the-unknown.cyera.com: flat purple rocks with an ink outline and one
// lit facet, lilac shards, lime crystals, and a layered planet surface.
// Each is its own small SVG so the floating motion stays on the compositor.

export function Rock({ size = 80, tone = 0 }: { size?: number; tone?: 0 | 1 }) {
  const body = tone ? "#4a2470" : "#2a1340";
  const lit = tone ? "#6a3596" : "#3e1d5e";
  const side = tone ? "#56287f" : "#341850";
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 100 90" aria-hidden>
      <polygon points="12,30 30,8 62,4 88,22 96,52 78,80 44,88 14,72 4,50" fill={body} stroke="#160823" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points="30,8 62,4 88,22 70,34 40,30 22,26" fill={lit} />
      <polygon points="70,34 88,22 96,52 78,62" fill={side} />
      <polyline points="22,26 40,30 70,34 78,62" fill="none" stroke="#160823" strokeWidth="1.5" strokeLinejoin="round" opacity=".7" />
      <ellipse cx="44" cy="58" rx="9" ry="5" fill="#1d0c2e" />
    </svg>
  );
}

export function Shard({ size = 34 }: { size?: number }) {
  return (
    <svg width={size * 0.5} height={size} viewBox="0 0 40 80" aria-hidden>
      <polygon points="12,0 34,8 28,80 6,72" fill="#c98cf2" stroke="#6c2f99" strokeWidth="2" strokeLinejoin="round" />
      <polygon points="12,0 34,8 24,16" fill="#efd8ff" />
      <polygon points="24,16 34,8 28,80" fill="#b06fe0" />
    </svg>
  );
}

export function Crystal({ size = 90 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <polygon points="30,6 72,4 96,36 84,78 44,96 8,70 4,30" fill="#b6ee7a" stroke="#4d7d27" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points="30,28 66,24 76,56 46,74 22,58" fill="#d2fb9e" stroke="#4d7d27" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M30,6 30,28 M72,4 66,24 M96,36 76,56 M84,78 46,74 M44,96 46,74 M8,70 22,58 M4,30 30,28" stroke="#4d7d27" strokeWidth="1.5" />
      <polygon points="66,24 72,4 96,36 76,56" fill="#9fdc62" opacity=".8" />
    </svg>
  );
}

/** The planet's edge along the bottom: four rock strata, each outlined. */
export function Planet({ className }: { className?: string }) {
  const band = (dy: number, fill: string) => (
    <path
      d={`M0,${120 + dy} C220,${50 + dy} 520,${30 + dy} 780,${92 + dy} C980,${140 + dy} 1180,${120 + dy} 1440,${170 + dy} L1440,320 L0,320Z`}
      fill={fill}
      stroke="#1d0a2e"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
  );
  return (
    <svg className={className} viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden>
      {band(0, "#8d4cc4")}
      {band(26, "#723a9f")}
      {band(64, "#4f2178")}
      {band(110, "#2c0f47")}
      <ellipse cx="300" cy="104" rx="38" ry="9" fill="#7a3fb0" stroke="#1d0a2e" strokeWidth="2" />
      <ellipse cx="610" cy="88" rx="22" ry="6" fill="#7a3fb0" stroke="#1d0a2e" strokeWidth="2" />
      <ellipse cx="1010" cy="148" rx="30" ry="7" fill="#663193" stroke="#1d0a2e" strokeWidth="2" />
    </svg>
  );
}

/** Dotted orbits around the hero, with one lit lime ring. */
export function Orbits({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-400 -400 800 800" aria-hidden>
      <circle r="168" fill="none" stroke="#9be86a" strokeWidth="2.5" opacity=".75" />
      <circle r="250" fill="none" stroke="#e7c9ff" strokeWidth="1.2" strokeDasharray="1.5 7" strokeLinecap="round" opacity=".55" />
      <circle r="360" fill="none" stroke="#e7c9ff" strokeWidth="1.2" strokeDasharray="1.5 9" strokeLinecap="round" opacity=".3" />
    </svg>
  );
}
