// ARAM Mayhem — Augments : catalogue par patch, notes NEX dans un contexte simule, mode manuel
// (depannage, distinct de la lecture automatique) et edition locale de la base editoriale.
import { Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../../app/AppState";
import { useAsync } from "../../app/useAsync";
import { errorMessage, platform } from "../../platform";
import type { MayhemAugment, MayhemAugmentRule, MayhemCardsEvent, MayhemCatalog, MayhemMechanic, MayhemOrientation, MayhemRateResult, MayhemRulesInfo, MayhemTier } from "../../platform/api";
import { Shield, TIER_STYLE } from "../../overlay/MayhemLayer";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { Segmented } from "../../ui/primitives";
import { ChampionPicker, useChampionById, useChampionList } from "../stats/statsShared";
import { AugmentChampions, ChampionPopularity, ComboLines, Credit, PopularityLine, SourcesPanel } from "./sources";
import type { MayhemDataset } from "../../platform/api";

const TIERS: (MayhemTier | "?")[] = ["S+", "S", "A", "B", "C", "D", "?"];
const RARITY: Record<string, { label: string; color: string }> = {
  prismatic: { label: "Prismatique", color: "#c9a2ff" },
  gold: { label: "Or", color: "#e8b65a" },
  silver: { label: "Argent", color: "#b9c0cc" },
  other: { label: "Autre", color: "#8b8fa3" },
};
const MECHANICS: { id: MayhemMechanic; label: string }[] = [
  { id: "immobilisation", label: "Immobilisations" },
  { id: "attaques_de_base", label: "Attaques de base" },
  { id: "effets_a_l_impact", label: "Effets à l'impact" },
  { id: "critique", label: "Critique" },
  { id: "vitesse_d_attaque", label: "Vitesse d'attaque" },
  { id: "degats_de_competences", label: "Dégâts de compétences" },
  { id: "soins", label: "Soins" },
  { id: "boucliers", label: "Boucliers" },
  { id: "mana", label: "Mana" },
  { id: "distance", label: "Distance" },
  { id: "melee", label: "Corps à corps" },
  { id: "resistance", label: "Résistance" },
  { id: "mobilite", label: "Mobilité" },
];
const ORIENTATIONS: { value: MayhemOrientation | ""; label: string }[] = [
  { value: "", label: "Aucune" },
  { value: "degats", label: "Dégâts" },
  { value: "resistance", label: "Résistance" },
  { value: "soutien", label: "Soutien" },
  { value: "mobilite", label: "Mobilité" },
];

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function AugmentSearch({ catalog, value, onChange, placeholder, exclude = [] }: { catalog: MayhemCatalog; value: string | null; onChange: (k: string | null) => void; placeholder: string; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const current = value ? catalog.augments.find((a) => a.key === value) : null;
  const results = useMemo(() => {
    const n = norm(q);
    return catalog.augments.filter((a) => !exclude.includes(a.key) && (!n || norm(a.nameFr).includes(n) || norm(a.nameEn).includes(n))).slice(0, 12);
  }, [q, catalog, exclude]);
  return (
    <div className="mh-search">
      {current && !open ? (
        <button className="mh-chip" onClick={() => setOpen(true)} title="Changer">
          <i style={{ background: RARITY[current.rarity].color }} /> {current.nameFr}
          <X size={12} onClick={(e) => (e.stopPropagation(), onChange(null))} aria-label="Retirer" />
        </button>
      ) : (
        <label className="search-box">
          <Search size={14} aria-hidden="true" />
          <input
            value={q}
            autoFocus={open}
            onChange={(e) => (setQ(e.target.value), setOpen(true))}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={placeholder}
            aria-label={placeholder}
          />
        </label>
      )}
      {open && q && (
        <div className="mh-results" role="listbox">
          {results.map((a) => (
            <button key={a.key} role="option" aria-selected={false} onMouseDown={() => (onChange(a.key), setQ(""), setOpen(false))}>
              <i style={{ background: RARITY[a.rarity].color }} /> {a.nameFr} <span className="muted">{a.nameEn}</span>
            </button>
          ))}
          {results.length === 0 && <span className="muted">Aucun augment</span>}
        </div>
      )}
    </div>
  );
}

export function MayhemPage() {
  const { notify, settings, setSetting } = useAppState();
  const byId = useChampionById();
  const catalog = useAsync<MayhemCatalog>("mayhem-catalog", () => platform.mayhemCatalog(), 3_600_000);
  const rules = useAsync<MayhemRulesInfo>("mayhem-rules", () => platform.mayhemRules(), 60_000);
  const [champ, setChamp] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [offered, setOffered] = useState<(string | null)[]>([null, null, null]);
  const [q, setQ] = useState("");
  const [rarity, setRarity] = useState("");
  const [tierF, setTierF] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"augments" | "champions" | "sources">("augments");
  const [sheet, setSheet] = useState<string | null>(null);
  const champList = useChampionList();
  const dataset = useAsync<MayhemDataset>("mayhem-dataset", () => platform.mayhemDataset(), 3_600_000);
  const orientation = (settings.mayhemOrientation ?? "") as MayhemOrientation | "";
  const champKey = champ ? (byId(champ)?.key ?? null) : null;

  // Notes de tout le catalogue dans le contexte simule (calcul local en Rust).
  const ctxKey = `${champKey}|${orientation}|${confirmed.join(",")}|${rules.data?.local.length ?? 0}|${rules.data?.editorial.version}`;
  const all = useAsync<MayhemRateResult>(
    catalog.data ? `mayhem-rate-all:${ctxKey}` : null,
    () => platform.mayhemRate({ champion: champKey, offered: catalog.data!.augments.map((a) => a.key), confirmed, orientation: orientation || null }),
    300_000,
  );
  const cmp = useAsync<MayhemRateResult>(
    offered.some(Boolean) ? `mayhem-rate-cmp:${ctxKey}:${offered.join(",")}` : null,
    () => platform.mayhemRate({ champion: champKey, offered, confirmed, orientation: orientation || null }),
    300_000,
  );

  const ratingOf = useMemo(() => {
    const m = new Map<string, MayhemRateResult["ratings"][number]>();
    all.data?.ratings.forEach((r) => r.key && m.set(r.key, r));
    return m;
  }, [all.data]);

  if (catalog.error != null && !catalog.data) return <div className="page"><ErrorPanel error={catalog.error} onRetry={() => catalog.reload()} /></div>;
  if (!catalog.data) return <div className="page"><div className="card card-pad muted">Chargement du catalogue ARAM Mayhem…</div></div>;
  const cat = catalog.data;
  const evaluated = cat.augments.filter((a) => ratingOf.get(a.key)?.status === "rated").length;

  const filtered = cat.augments.filter((a) => {
    const n = norm(q);
    if (n && !norm(a.nameFr).includes(n) && !norm(a.nameEn).includes(n)) return false;
    if (rarity && a.rarity !== rarity) return false;
    const t = ratingOf.get(a.key)?.tier ?? "?";
    return !tierF || t === tierF;
  });
  const groups = TIERS.map((t) => ({ t, list: filtered.filter((a) => (ratingOf.get(a.key)?.tier ?? "?") === t) })).filter((g) => g.list.length);

  const showOnOverlay = async () => {
    try {
      await platform.mayhemManual(offered);
      notify("Comparaison manuelle affichée sur l'overlay (source : saisie manuelle).", "info");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };

  return (
    <div className="page mh-page">
      <div className="page-head">
        <h1 className="page-title">
          <Sparkles aria-hidden="true" /> ARAM Mayhem — Augments
        </h1>
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Patch {cat.patch || "?"} · {cat.augments.length} augments · {evaluated} évalués · règles {rules.data?.editorial.version ?? "…"} ({rules.data?.editorial.reviewedAt ?? "…"})
          {rules.data && rules.data.local.length > 0 && ` + ${rules.data.local.length} en édition locale`}
        </span>
      </div>
      <p className="muted mh-disclaimer">
        Appréciation heuristique NEX selon ton contexte : ce n'est ni un taux de victoire ni une garantie. Un augment sans base éditoriale reste « ? » (non évalué) ;
        aucune note n'est inventée. Les recommandations Arena ou ARAM classique ne sont pas transposées.
      </p>

      <div className="mh-row" style={{ marginTop: 0 }}>
        <Segmented
          label="Vue"
          size="md"
          options={[
            { value: "augments", label: "Augments" },
            { value: "champions", label: "Champions (popularité)" },
            { value: "sources", label: "Sources et crédits" },
          ]}
          value={view}
          onChange={(v) => setView(v as typeof view)}
        />
        <span className="spacer" />
        <Credit ds={dataset.data ?? null} />
      </div>

      {view === "sources" &&
        (dataset.data ? (
          <SourcesPanel ds={dataset.data} catalog={cat} />
        ) : dataset.error != null ? (
          <ErrorPanel error={dataset.error} onRetry={() => dataset.reload()} />
        ) : (
          <div className="card card-pad muted">Chargement des données publiques…</div>
        ))}

      {view === "champions" &&
        (dataset.data ? (
          <ChampionPopularity
            ds={dataset.data}
            catalog={cat}
            selected={sheet}
            onSelect={setSheet}
            onPick={(key) => {
              const c = champList.find((x) => x.key === key);
              if (c) setChamp(c.id);
              setView("augments");
            }}
          />
        ) : dataset.error != null ? (
          <ErrorPanel error={dataset.error} onRetry={() => dataset.reload()} />
        ) : (
          <div className="card card-pad muted">Chargement des données publiques…</div>
        ))}

      {view === "augments" && (
        <>
      <LiveSection catalog={cat} />

      <section className="card card-pad mh-context">
        <div className="panel-label">Contexte simulé</div>
        <div className="mh-row">
          <div style={{ minWidth: 220 }}>
            <ChampionPicker value={champ} onChange={setChamp} placeholder="Champion joué" />
          </div>
          <Segmented label="Orientation" options={ORIENTATIONS.map((o) => ({ value: o.value as string, label: o.label }))} value={orientation} onChange={(v) => setSetting("mayhemOrientation", v as MayhemOrientation | "")} />
        </div>
        <div className="mh-row">
          <span className="muted">Augments déjà choisis :</span>
          {confirmed.map((k) => (
            <button key={k} className="mh-chip" onClick={() => setConfirmed(confirmed.filter((x) => x !== k))} aria-label={`Retirer ${k}`}>
              {cat.augments.find((a) => a.key === k)?.nameFr ?? k} <X size={12} />
            </button>
          ))}
          {confirmed.length < 6 && <AugmentSearch catalog={cat} value={null} onChange={(k) => k && setConfirmed([...confirmed, k])} placeholder="Ajouter un augment choisi" exclude={confirmed} />}
        </div>
        {all.data?.profile && (
          <div className="mh-profile muted">
            Mécaniques de {byId(champ!)?.name} ({all.data.profile.source === "editorial" ? "profil édité" : "heuristique d'après les textes Data Dragon"}) :{" "}
            {MECHANICS.filter((m) => (all.data!.profile!.mechanics[m.id] ?? 0) > 0)
              .map((m) => `${m.label}${all.data!.profile!.mechanics[m.id] === 2 ? " ++" : ""}`)
              .join(" · ") || "aucune détectée"}
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="panel-label">Mode manuel — comparaison immédiate (dépannage, distinct de la lecture automatique)</div>
        <div className="mh-manual">
          {offered.map((k, i) => {
            const r = cmp.data?.ratings[i];
            return (
              <div key={i} className={`mh-slot ${cmp.data?.best === i ? "best" : ""}`}>
                <AugmentSearch catalog={cat} value={k} onChange={(v) => setOffered(offered.map((x, j) => (j === i ? v : x)))} placeholder={`Carte ${i + 1}`} />
                {k && r && (
                  <div className="mh-slot-result">
                    <Shield tier={r.tier ?? "?"} size={34} best={cmp.data?.best === i} />
                    <div>
                      {r.reasons.slice(0, 2).map((x, j) => (
                        <span key={j}>{x.text}</span>
                      ))}
                    </div>
                  </div>
                )}
                {k && cmp.data?.context?.[i] && (
                  <div className="mh-slot-context">
                    <PopularityLine pop={cmp.data.context[i].popularity} />
                    <ComboLines
                      key={k}
                      combos={cmp.data.context[i].combos}
                      total={cmp.data.context[i].combosTotal}
                      outside={cmp.data.context[i].combosOutsidePool}
                      nameOf={(x) => cat.augments.find((a) => a.key === x)?.nameFr ?? x}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mh-row">
          <button className="btn btn-sm" disabled={!offered.some(Boolean)} onClick={showOnOverlay}>
            Afficher sur l'overlay
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => (setOffered([null, null, null]), platform.mayhemClear().catch(() => {}))}>
            Effacer
          </button>
          {cmp.data && cmp.data.best == null && offered.filter(Boolean).length >= 2 && <span className="muted">Pas de meilleure affinité nette : évaluations équivalentes ou insuffisantes.</span>}
        </div>
      </section>

      <div className="mh-toolbar">
        <label className="search-box">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un augment" aria-label="Rechercher un augment" />
        </label>
        <select className="select" value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Rareté">
          <option value="">Toutes raretés</option>
          {Object.entries(RARITY).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select className="select" value={tierF} onChange={(e) => setTierF(e.target.value)} aria-label="Note">
          <option value="">Toutes notes</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t === "?" ? "? non évalué" : t}
            </option>
          ))}
        </select>
        <span className="muted num">{filtered.length} augments</span>
      </div>

      <div className="mh-tiers">
        {groups.map((g) => (
          <section key={g.t} className="mh-tier">
            <div className="mh-tier-head">
              <Shield tier={g.t} size={26} />
              <b>{g.t === "?" ? "Non évalués ou non identifiés" : TIER_STYLE[g.t].label}</b>
              <span className="muted num">{g.list.length}</span>
            </div>
            <div className="mh-tier-list">
              {g.list.map((a) => (
                <button key={a.key} className={`mh-aug ${selected === a.key ? "active" : ""}`} onClick={() => setSelected(selected === a.key ? null : a.key)}>
                  <i style={{ background: RARITY[a.rarity].color }} title={RARITY[a.rarity].label} />
                  <span>{a.nameFr}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {selected && (
        <AugmentDetail
          augment={cat.augments.find((a) => a.key === selected)!}
          rating={ratingOf.get(selected)}
          rule={rules.data?.local.find((r) => r.key === selected) ?? rules.data?.editorial.augments.find((r) => r.key === selected) ?? null}
          isLocal={!!rules.data?.local.find((r) => r.key === selected)}
          onClose={() => setSelected(null)}
          onSaved={() => rules.reload()}
          champion={champKey}
          confirmed={confirmed}
          nameOf={(k) => cat.augments.find((a) => a.key === k)?.nameFr ?? k}
          dataset={dataset.data ?? null}
          onChampion={(id) => {
            setSheet(id);
            setView("champions");
          }}
        />
      )}
        </>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { screen_reading: "lecture de l'écran", manual: "saisie manuelle", demo: "démonstration" };

/** Partie en cours : cartes affichees sur l'overlay et confirmation explicite du choix. */
function LiveSection({ catalog }: { catalog: MayhemCatalog }) {
  const { notify } = useAppState();
  const [ev, setEv] = useState<MayhemCardsEvent | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    platform.mayhemState().then((e) => alive && setEv(e)).catch(() => {});
    platform.mayhemConfirmed().then((c) => alive && setConfirmed(c)).catch(() => {});
    platform.on<MayhemCardsEvent | null>("mayhem://cards", (e) => setEv(e)).then((o) => (off = o));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  const name = (k: string) => catalog.augments.find((a) => a.key === k)?.nameFr ?? k;
  const confirm = (k: string, chosen: boolean) =>
    platform
      .mayhemConfirm(k, chosen)
      .then(setConfirmed)
      .catch((e) => notify(errorMessage(e), "error"));
  return (
    <section className="card card-pad">
      <div className="panel-label">Partie en cours</div>
      <div className="mh-row">
        <button className="btn btn-sm btn-primary" onClick={() => platform.mayhemReadNow().catch((e) => notify(errorMessage(e), "error"))}>
          Lire les cartes maintenant
        </button>
        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          En jeu : <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> lit les cartes (assistance déclenchée par toi), <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> affiche le détail.
          Lecture locale de l'écran du jeu, rien n'est envoyé.
        </span>
      </div>
      {ev ? (
        <div className="mh-live">
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {SOURCE_LABEL[ev.source]} · phase {ev.phase} · version {ev.version}
            {ev.readMs != null && ` · lecture ${ev.readMs} ms`}
          </span>
          <div className="mh-manual">
            {ev.cards.map((c, i) => (
              <div key={c.slot} className={`mh-slot ${ev.best === i ? "best" : ""}`}>
                <div className="mh-slot-result">
                  <Shield tier={ev.ratings[i]?.tier ?? "?"} size={30} best={ev.best === i} approx={c.confidence === "approx"} />
                  <div>
                    <b>{c.name ?? (c.text || "Carte non identifiée")}</b>
                    {ev.ratings[i]?.reasons.slice(0, 2).map((r, j) => (
                      <span key={j}>{r.text}</span>
                    ))}
                  </div>
                </div>
                {c.key && !ev.demo && (
                  <button className="btn btn-sm" disabled={confirmed.includes(c.key)} onClick={() => confirm(c.key!, true)}>
                    {confirmed.includes(c.key) ? "Confirmé" : "J'ai choisi celle-ci"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted" style={{ margin: "8px 0 0", fontSize: "var(--fs-sm)" }}>
          Aucune carte affichée. Les badges apparaissent quand les cartes sont lues à l'écran, ou via le mode manuel ci-dessous.
        </p>
      )}
      <div className="mh-row">
        <span className="muted">Augments confirmés dans cette partie :</span>
        {confirmed.length === 0 && <span className="muted">aucun</span>}
        {confirmed.map((k) => (
          <button key={k} className="mh-chip" onClick={() => confirm(k, false)} aria-label={`Retirer ${name(k)}`}>
            {name(k)} <X size={12} />
          </button>
        ))}
      </div>
    </section>
  );
}

function AugmentDetail({
  augment,
  rating,
  rule,
  isLocal,
  onClose,
  onSaved,
  champion,
  confirmed,
  nameOf,
  dataset,
  onChampion,
}: {
  augment: MayhemAugment;
  rating: MayhemRateResult["ratings"][number] | undefined;
  rule: MayhemAugmentRule | null;
  isLocal: boolean;
  onClose: () => void;
  onSaved: () => void;
  champion: string | null;
  confirmed: string[];
  nameOf: (key: string) => string;
  dataset: MayhemDataset | null;
  onChampion: (championId: string) => void;
}) {
  const { notify } = useAppState();
  // Contexte calcule par la meme fonction Rust que l'overlay (popularite, combos du champion).
  const context = useAsync<MayhemRateResult>(`mayhem-detail:${augment.key}:${champion}:${confirmed.join(",")}`, () =>
    platform.mayhemRate({ champion, offered: [augment.key], confirmed, orientation: null }),
  );
  const ctx = context.data?.context?.[0];
  const [draft, setDraft] = useState<MayhemAugmentRule>(rule ?? { key: augment.key, base: "B", requires: [], benefits: [], orientation: [], combos: [], conflicts: [], note: null });
  useEffect(() => setDraft(rule ?? { key: augment.key, base: "B", requires: [], benefits: [], orientation: [], combos: [], conflicts: [], note: null }), [augment.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = async () => {
    try {
      await platform.mayhemSaveRule(draft);
      notify("Base éditoriale locale enregistrée.", "success");
      onSaved();
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };
  const remove = async () => {
    try {
      await platform.mayhemDeleteRule(augment.key);
      onSaved();
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };
  return (
    <aside className="card card-pad mh-detail" aria-label={`Détail : ${augment.nameFr}`}>
      <div className="mh-row">
        <Shield tier={rating?.tier ?? "?"} size={36} />
        <div>
          <b>{augment.nameFr}</b> <span className="muted">{augment.nameEn}</span>
          <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            Rareté du jeu : {RARITY[augment.rarity].label} (indépendante de la note) · clé {augment.key}
          </div>
        </div>
        <span className="spacer" />
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
      </div>
      <ul className="mh-reasons">
        {(rating?.reasons ?? []).map((r, i) => (
          <li key={i}>
            {r.text}
            {r.delta !== 0 && <span className="num muted"> ({r.delta > 0 ? "+" : ""}{r.delta})</span>}
          </li>
        ))}
      </ul>
      <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
        {rating?.status === "rated"
          ? `Score ${rating.score} · ${rating.validation === "local_editorial" ? "édition locale (non relue)" : rating.validation === "editorial" ? "éditorial NEX" : "donnée d'essai"} · moteur v${rating.engine}`
          : "Non évalué : aucune base éditoriale pour cet augment."}
      </div>
      <div className="panel-label" style={{ marginTop: 12 }}>
        Contexte (source publique, n'entre pas dans la note)
      </div>
      {ctx ? (
        <div className="mh-slot-context">
          <PopularityLine pop={ctx.popularity} />
          {champion ? (
            ctx.combos.length ? (
              <ComboLines key={augment.key} combos={ctx.combos} total={ctx.combosTotal} outside={ctx.combosOutsidePool} nameOf={nameOf} />
            ) : (
              <span className="muted">
                Aucun combo documenté par la source pour ce champion avec cet augment
                {ctx.combosOutsidePool > 0 && ` dans le pool actuel (${ctx.combosOutsidePool} masqué${ctx.combosOutsidePool > 1 ? "s" : ""})`}.
              </span>
            )
          ) : (
            <span className="muted">Choisis un champion pour voir les combos documentés.</span>
          )}
        </div>
      ) : (
        <span className="muted">{context.error != null ? "Contexte indisponible." : "Chargement du contexte…"}</span>
      )}
      {dataset && (
        <>
          <div className="panel-label" style={{ marginTop: 12 }}>
            Champions avec un combo documenté contenant cet augment
          </div>
          <AugmentChampions ds={dataset} augmentKey={augment.key} onPick={onChampion} />
        </>
      )}

      <div className="panel-label" style={{ marginTop: 12 }}>
        Base éditoriale locale {isLocal ? "(enregistrée)" : ""}
      </div>
      <div className="mh-row">
        <Segmented label="Base" options={(["S+", "S", "A", "B", "C", "D"] as MayhemTier[]).map((t) => ({ value: t, label: t }))} value={draft.base} onChange={(v) => setDraft({ ...draft, base: v as MayhemTier })} />
      </div>
      <div className="mh-tags">
        <span className="muted">Conditions de déclenchement</span>
        {MECHANICS.map((m) => (
          <label key={m.id} className="check">
            <input type="checkbox" checked={draft.requires.includes(m.id)} onChange={() => setDraft({ ...draft, requires: toggle(draft.requires, m.id) })} /> {m.label}
          </label>
        ))}
      </div>
      <div className="mh-tags">
        <span className="muted">Renforcé par</span>
        {MECHANICS.map((m) => (
          <label key={m.id} className="check">
            <input type="checkbox" checked={draft.benefits.includes(m.id)} onChange={() => setDraft({ ...draft, benefits: toggle(draft.benefits, m.id) })} /> {m.label}
          </label>
        ))}
      </div>
      <div className="mh-tags">
        <span className="muted">Orientation</span>
        {ORIENTATIONS.filter((o) => o.value).map((o) => (
          <label key={o.value} className="check">
            <input type="checkbox" checked={draft.orientation.includes(o.value as MayhemOrientation)} onChange={() => setDraft({ ...draft, orientation: toggle(draft.orientation, o.value as MayhemOrientation) })} /> {o.label}
          </label>
        ))}
      </div>
      <div className="mh-row">
        <button className="btn btn-sm btn-primary" onClick={save}>
          Enregistrer localement
        </button>
        {isLocal && (
          <button className="btn btn-sm btn-ghost" onClick={remove}>
            Supprimer l'édition locale
          </button>
        )}
      </div>
    </aside>
  );
}
