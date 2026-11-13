// Badges NEX sur les cartes d'augments ARAM Mayhem. Aucune interaction : la fenetre d'overlay
// laisse passer les clics (cartes et relances restent utilisables). Rendu uniquement quand un
// evenement arrive ; aucune animation en boucle.
import { useEffect, useState } from "react";
import { platform, type Settings } from "../platform";
import type { MayhemCardsEvent, MayhemRating } from "../platform/api";

export const TIER_STYLE: Record<string, { fill: string; stroke: string; label: string }> = {
  "S+": { fill: "#7a5a12", stroke: "#f2c94c", label: "Synergie exceptionnelle dans ce contexte" },
  S: { fill: "#4b2a7a", stroke: "#b98cff", label: "Excellente synergie" },
  A: { fill: "#174a6b", stroke: "#6cc8ff", label: "Très bon choix" },
  B: { fill: "#1d5a35", stroke: "#5fd38d", label: "Choix correct" },
  C: { fill: "#6b3c10", stroke: "#ffa24c", label: "Choix situationnel ou peu adapté" },
  D: { fill: "#6b1a22", stroke: "#ff6b7a", label: "Faible intérêt dans ce contexte" },
  "?": { fill: "#2a2c36", stroke: "#9aa0b4", label: "Augment non identifié ou pas encore évalué" },
};

/** Geometrie par defaut des cartes (fractions de la zone client), mesuree en 2560x1440. */
const DEFAULT_TITLE_Y = 0.404;
const DEFAULT_TITLE_H = 0.0139;
const DEFAULT_SPACING = 0.191;

export function letterOf(r: MayhemRating | undefined): string {
  return r?.tier ?? "?";
}

/** Ecusson SVG compact : la lettre reste lisible sans la couleur. */
export function Shield({ tier, size, best, approx }: { tier: string; size: number; best?: boolean; approx?: boolean }) {
  const s = TIER_STYLE[tier] ?? TIER_STYLE["?"];
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" aria-label={`Note NEX ${tier} : ${s.label}`} className={best ? "mh-shield best" : "mh-shield"}>
      <path d="M20 2 L37 8 V22 C37 33 29 40 20 44 C11 40 3 33 3 22 V8 Z" fill={s.fill} stroke={s.stroke} strokeWidth="2.5" />
      <text x="20" y={tier.length > 1 ? 28.5 : 29.5} textAnchor="middle" fontSize={tier.length > 1 ? 15 : 18} fontWeight="800" fill="#fff" fontFamily="Inter Variable, Segoe UI, sans-serif">
        {tier}
      </text>
      {approx && (
        <text x="35" y="12" textAnchor="middle" fontSize="10" fontWeight="800" fill={s.stroke}>
          ≈
        </text>
      )}
    </svg>
  );
}

interface Style {
  offset: number;
  scale: number;
  opacity: number;
  show: boolean;
}

function styleOf(s: Settings | null): Style {
  return {
    offset: (s?.mayhemBadgeOffset ?? 118) / 10,
    scale: (s?.mayhemBadgeScale ?? 100) / 100,
    opacity: (s?.mayhemBadgeOpacity ?? 95) / 100,
    show: s?.mayhemBadges ?? true,
  };
}

export function MayhemLayer() {
  const [ev, setEv] = useState<MayhemCardsEvent | null>(null);
  const [panel, setPanel] = useState(false);
  const [style, setStyle] = useState<Style>(styleOf(null));

  useEffect(() => {
    const offs: (() => void)[] = [];
    let alive = true;
    (async () => {
      const [cur, st] = await Promise.all([platform.mayhemState().catch(() => null), platform.getSettings().catch(() => null)]);
      if (!alive) return;
      // Apercu navigateur en developpement uniquement (`?overlay&mayhemdemo`) : evenement DEMO.
      setEv(import.meta.env.DEV && new URLSearchParams(location.search).has("mayhemdemo") ? devDemo() : cur);
      setStyle(styleOf(st));
      offs.push(
        await platform.on<MayhemCardsEvent | null>("mayhem://cards", (p) => {
          // Une observation plus ancienne ne remplace jamais une plus recente.
          setEv((prev) => (p && prev && p.version < prev.version && p.phase === prev.phase ? prev : p));
          if (p) platform.getSettings().then((s) => alive && setStyle(styleOf(s))).catch(() => {});
        }),
      );
      offs.push(await platform.on<boolean>("mayhem://panel", (p) => setPanel(p)));
    })();
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, []);

  if (!ev || !style.show || ev.cards.length === 0) return null;

  // Zone client du jeu -> pixels CSS de la fenetre d'overlay.
  const dpr = window.devicePixelRatio || 1;
  const g = ev.game ?? { x: window.screenX * dpr, y: window.screenY * dpr, w: window.innerWidth * dpr, h: window.innerHeight * dpr };
  const toX = (fx: number) => (g.x + fx * g.w) / dpr - window.screenX;
  const toY = (fy: number) => (g.y + fy * g.h) / dpr - window.screenY;
  const n = ev.cards.length;
  // Sans position lue (saisie manuelle, demonstration) : emplacements par defaut, resserres
  // si le mode propose plus de trois cartes.
  const spacing = Math.min(DEFAULT_SPACING, 0.84 / Math.max(1, n));
  const rects = ev.cards.map((c, i) => c.rect ?? [0.5 + (i - (n - 1) / 2) * spacing - 0.03, DEFAULT_TITLE_Y, 0.06, DEFAULT_TITLE_H]);
  const titleH = [...rects.map((r) => r[3])].sort((a, b) => a - b)[Math.floor(n / 2)];
  const badgeH = Math.max(28, (3.6 * titleH * g.h * style.scale) / dpr);

  return (
    <div className="mh-layer" style={{ opacity: style.opacity }}>
      {ev.cards.map((c, i) => {
        const r = rects[i];
        const rating = ev.ratings[i];
        const tier = letterOf(rating);
        const cx = toX(r[0] + r[2] / 2);
        const cy = toY(r[1] + style.offset * titleH);
        return (
          <div key={`${ev.version}-${c.slot}`} className="mh-badge" style={{ left: cx - badgeH / 2.3, top: cy - badgeH / 2 }}>
            <Shield tier={tier} size={badgeH / 1.15} best={ev.best === i} approx={c.confidence === "approx"} />
          </div>
        );
      })}
      {ev.demo && (
        <div className="mh-demo" style={{ left: toX(0.5) - 60, top: toY(DEFAULT_TITLE_Y) - 40 }}>
          DÉMO : notes d'essai
        </div>
      )}
      {panel && <MayhemPanel ev={ev} left={toX(Math.min(0.97, Math.max(...rects.map((r) => r[0] + r[2] / 2)) + spacing / 2))} top={toY(0.18)} />}
    </div>
  );
}

/** Evenement de demonstration pour l'apercu navigateur (developpement). Toutes les notes. */
function devDemo(): MayhemCardsEvent {
  const tiers = new URLSearchParams(location.search).get("tiers")?.split(",") ?? ["S+", "B", "?"];
  const n = tiers.length;
  const rating = (t: string) => ({
    key: "demo",
    tier: t === "?" ? null : (t as MayhemRating["tier"]),
    score: t === "?" ? null : 60,
    status: t === "?" ? ("not_evaluated" as const) : ("rated" as const),
    reasons: [{ text: t === "?" ? "pas encore évalué" : "donnée d'essai", delta: 0 }],
    validation: t === "?" ? null : ("fixture" as const),
    engine: 1,
    rulesVersion: "fixtures",
  });
  return {
    version: 1,
    phase: 1,
    source: "demo",
    demo: true,
    game: null,
    champion: null,
    cards: tiers.map((t, i) => ({ slot: i, key: null, name: `Carte ${t}`, rarity: null, text: "", confidence: i === n - 1 ? "approx" : "exact", rect: null })),
    ratings: tiers.map(rating),
    best: 0,
    rulesVersion: "fixtures",
    context: [],
    at: 0,
    readMs: null,
  };
}

const VALIDATION: Record<string, string> = {
  fixture: "donnée d'essai",
  local_editorial: "édition locale",
  editorial: "éditorial NEX",
};
const SOURCE: Record<string, string> = {
  screen_reading: "lecture de l'écran",
  manual: "saisie manuelle",
  demo: "démonstration",
};

function MayhemPanel({ ev, left, top }: { ev: MayhemCardsEvent; left: number; top: number }) {
  const w = 300;
  const x = left + w > window.innerWidth ? Math.max(8, window.innerWidth - w - 8) : left;
  return (
    <div className="mh-panel" style={{ left: x, top, width: w }}>
      <div className="ov-title">Augments · détail NEX</div>
      {ev.cards.map((c, i) => {
        const r = ev.ratings[i];
        return (
          <div key={c.slot} className="mh-panel-row">
            <Shield tier={letterOf(r)} size={22} best={ev.best === i} approx={c.confidence === "approx"} />
            <div>
              <b>{c.name ?? c.text ?? "Carte non identifiée"}</b>
              {r?.reasons.slice(0, 2).map((x, j) => (
                <span key={j} className="ov-sub">
                  {x.text}
                </span>
              ))}
              <span className="ov-sub">
                {c.confidence === "approx" ? "lecture approchée · " : c.confidence === "ambiguous" ? "lecture ambiguë · " : ""}
                {r?.validation ? VALIDATION[r.validation] : "non évalué"}
              </span>
              {ev.context?.[i]?.popularity?.pickRate != null && (
                <span className="ov-sub">
                  Popularité (contexte) : {ev.context[i].popularity!.pickRate!.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %, rang{" "}
                  {ev.context[i].popularity!.pickRateRank ?? "?"}/{ev.context[i].popularity!.rankScope}
                </span>
              )}
              {ev.context?.[i]?.combos.slice(0, 2).map((cb) => (
                <span key={cb.comboId} className="ov-sub">
                  {cb.needsVerification
                    ? "Interaction à vérifier"
                    : cb.status === "project"
                      ? `Projet de combo (il manque ${cb.missing.length})`
                      : cb.size === 1
                        ? "Combo documenté pour ce champion"
                        : "Combo réalisable"}{" "}
                  · info, sans bonus
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <span className="ov-sub">
        {SOURCE[ev.source]} · règles {ev.rulesVersion} · appréciation NEX, pas un taux de victoire
        {ev.context?.some((c) => c.popularity || c.combos.length) && " · contexte : Data: arammayhem.com (CC BY 4.0)"}
      </span>
    </div>
  );
}
