// Composants d'interface reutilisables (partageables avec un futur site NEX :
// aucune dependance a Tauri ni a la plateforme).
import { useId, useState, type ReactNode } from "react";
import { championIcon, championName, positionIcon, rankEmblem, rankMiniCrest } from "../data/assets";

export function Tip({
  text,
  children,
  placement = "top",
  align = "center",
}: {
  text: ReactNode;
  children: ReactNode;
  placement?: "top" | "bottom";
  align?: "center" | "end";
}) {
  const id = useId();
  return (
    <span className="tip" data-placement={placement} data-align={align} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className="tip-bubble">
        {text}
      </span>
    </span>
  );
}

/** Image distante avec repli lisible (initiales) si elle echoue ou si l'URL est inconnue. */
export function RemoteImg({
  src,
  alt,
  className,
  fallback,
}: {
  src: string | null;
  alt: string;
  className?: string;
  fallback?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className={`img-fallback ${className ?? ""}`} role="img" aria-label={alt}>
        {(fallback ?? alt).slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function ChampIcon({
  version,
  champion,
  size = 32,
  rounded = 8,
}: {
  version: string | null;
  champion: string;
  size?: number;
  rounded?: number;
}) {
  return (
    <span className="champ-icon" style={{ width: size, height: size, borderRadius: rounded }}>
      <RemoteImg src={championIcon(version, champion)} alt={championName(champion)} />
    </span>
  );
}

/** Mini-courbe SVG legere (pas de bibliotheque de graphes pour 8 sparklines). */
export function Sparkline({
  values,
  width = 76,
  height = 30,
  tone = "neutral",
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "neutral" | "pos" | "neg";
  label: string;
}) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} role="img" aria-label={`${label} : pas assez de parties`}>
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="var(--border)" strokeDasharray="3 3" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 6)] as const);
  // Lissage simple (courbe quadratique par points milieux).
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  const color = tone === "pos" ? "var(--text)" : tone === "neg" ? "var(--red)" : "var(--text-2)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

/** Variation signee : couleur + signe + libelle (jamais la couleur seule). */
export function DeltaChip({ value, unit, higherIsBetter = true }: { value: number | null; unit: "abs" | "pts"; higherIsBetter?: boolean }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="delta delta-none" title="Échantillon insuffisant pour comparer">—</span>;
  }
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  const good = rounded === 0 ? null : (rounded > 0) === higherIsBetter;
  const cls = good === null ? "delta-flat" : good ? "delta-pos" : "delta-neg";
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  const txt = `${sign}${Math.abs(rounded)}${unit === "pts" ? " pts" : ""}`;
  return (
    <span className={`delta ${cls}`}>
      <span className="delta-dot" aria-hidden="true">
        {rounded > 0 ? "▲" : rounded < 0 ? "▼" : "•"}
      </span>
      <span className="num">{txt}</span>
      <span className="sr-only">{good === null ? "stable" : good ? "en amélioration" : "en baisse"}</span>
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "sm",
}: {
  options: { value: T; label: string; disabled?: boolean; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const enabled = options.filter((x) => !x.disabled);
            const i = enabled.findIndex((x) => x.value === value);
            const next = enabled[(i + (e.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
            onChange(next.value);
            (e.currentTarget.parentElement?.querySelector(`[data-v="${next.value}"]`) as HTMLElement | null)?.focus();
          }}
          data-v={o.value}
          tabIndex={o.value === value ? 0 : -1}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Anneau de score 0-100. */
/** `rank` : « MVP », « ACE » ou « 9e », legende sous l'anneau. Omis quand il est inconnu. */
export function ScoreRing({ value, size = 34, label, rank = null }: { value: number | null; size?: number; label: string; rank?: string | null }) {
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const color = value === null ? "var(--dim)" : v >= 65 ? "var(--blue)" : v >= 45 ? "var(--text-2)" : "var(--red)";
  const ring = (
    <span className="score-ring" style={{ width: size, height: size }} role="img" aria-label={`${label} : ${value === null ? "indisponible" : Math.round(v)}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="num">{value === null ? "—" : Math.round(v)}</span>
    </span>
  );
  if (!rank) return ring;
  const top = rank === "MVP" || rank === "ACE";
  return (
    <span className="score-cell">
      {ring}
      <span className={`score-rank${top ? " top" : ""}`} title={top ? `${rank} : meilleur indice de contribution de son équipe` : `${rank} sur les 10 joueurs, à l'indice de contribution`}>
        {rank}
      </span>
    </span>
  );
}

export function DemoTag({ compact = false }: { compact?: boolean }) {
  return (
    <Tip text="Données fictives du mode démonstration. Désactivable dans Paramètres.">
      <span className="demo-tag" tabIndex={0}>
        {compact ? "DÉMO" : "DONNÉES DÉMO"}
      </span>
    </Tip>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/**
 * Zoom de l'embleme officiel : l'image source (16:9) n'utilise qu'environ un quart de sa
 * largeur (mesure sur les dix rangs : 15 % pour Fer, 25 % pour Challenger). Un zoom commun
 * garde les proportions voulues par le jeu entre les rangs ; le plus large remplit ~95 % de la case.
 */
const EMBLEM_ZOOM = "scale(3.8) translateY(1%)";

/** Embleme de rang officiel du jeu ; repli dessine si l'image est indisponible (hors ligne ou CSP). */
export function RankCrest({ tier, size = 64, mini = false }: { tier: string; size?: number; mini?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = mini ? rankMiniCrest(tier) : rankEmblem(tier);
  if (src && !failed) {
    return (
      <span className="rank-emblem" style={{ width: size, height: size }}>
        <img
          src={src}
          alt={`Rang ${tier}`}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          style={mini ? undefined : { transform: EMBLEM_ZOOM }}
        />
      </span>
    );
  }
  return <DrawnCrest tier={tier} size={size} />;
}

/** Position (poste) avec l'icone officielle du jeu. */
export function PositionIcon({ position, size = 16 }: { position: string | null | undefined; size?: number }) {
  const src = positionIcon(position);
  if (!src) return null;
  return <img className="position-icon" src={src} alt={position ?? ""} width={size} height={size} loading="lazy" decoding="async" draggable={false} />;
}

function DrawnCrest({ tier, size }: { tier: string; size: number }) {
  const colors: Record<string, [string, string]> = {
    IRON: ["#6b6461", "#3a3534"],
    BRONZE: ["#b0784f", "#5e3b25"],
    SILVER: ["#a8b4bf", "#5a6670"],
    GOLD: ["#e8b65a", "#8a6420"],
    PLATINUM: ["#4fc2b5", "#1f6660"],
    EMERALD: ["#3fcf8e", "#16704a"],
    DIAMOND: ["#7aa6ff", "#3346a8"],
    MASTER: ["#b77cf2", "#5c2c8e"],
    GRANDMASTER: ["#f0596b", "#7a1f2b"],
    CHALLENGER: ["#ffd88a", "#4b7bd6"],
  };
  const [a, b] = colors[tier] ?? ["#8b8fa3", "#3a3d4e"];
  const gid = `crest-${tier}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`Rang ${tier}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <path d="M32 4 L54 16 L54 36 C54 48 44 56 32 60 C20 56 10 48 10 36 L10 16 Z" fill={`url(#${gid})`} opacity="0.9" />
      <path d="M32 12 L46 20 L46 35 C46 43 40 48 32 51 C24 48 18 43 18 35 L18 20 Z" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
      <path d="M32 20 L38 32 L32 44 L26 32 Z" fill="rgba(255,255,255,0.85)" />
    </svg>
  );
}
