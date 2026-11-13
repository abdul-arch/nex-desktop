// Donnees publiques arammayhem.com (CC BY 4.0) : popularite, combos, provenance et credits.
// Ces informations sont du contexte : elles ne decident jamais d'une note NEX.
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { platform } from "../../platform";
import type { MayhemCardContext, MayhemCatalog, MayhemComboNote, MayhemDataset } from "../../platform/api";

const COMBO_TYPE: Record<string, string> = {
  god: "« god » (éditorial)",
  strong: "« strong » (éditorial)",
  trap: "« trap » : piège (éditorial)",
  blackTech: "« black tech » (éditorial)",
  entertainment: "amusant (éditorial)",
  bug: "bug signalé : à vérifier",
};

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const signed = (v: number | null | undefined, unit: string) => (v == null ? "" : `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${unit}`);
const date = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR") : "date inconnue");

export function ExtLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      className="mh-ext"
      onClick={(e) => {
        e.preventDefault();
        platform.openExternal(href).catch(() => window.open(href, "_blank", "noopener"));
      }}
    >
      {children} <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}

export function Credit({ ds }: { ds: MayhemDataset | null }) {
  return (
    <span className="mh-credit">
      <ExtLink href={ds?.provenance.attributionUrl ?? "https://arammayhem.com/data/"}>{ds?.provenance.attribution ?? "Data: arammayhem.com"}</ExtLink> ·{" "}
      <ExtLink href={ds?.provenance.licenseUrl ?? "https://creativecommons.org/licenses/by/4.0/"}>{ds?.provenance.license ?? "CC BY 4.0"}</ExtLink> · non approuvé par Riot Games
    </span>
  );
}

/** Popularite d'un augment, avec son perimetre et sa date. Jamais presentee comme une qualite. */
export function PopularityLine({ pop }: { pop: MayhemCardContext["popularity"] }) {
  if (!pop) return <span className="muted">Popularité : aucune donnée de la source pour cet augment.</span>;
  return (
    <span className="mh-pop">
      Choisi dans {pct(pop.pickRate)} des cas (pick rate de la source)
      {pop.pickRateRank != null && ` · rang ${pop.pickRateRank} sur ${pop.rankScope} (tous les augments de l'export)`}
      {pop.pickRateChange != null && ` · ${signed(pop.pickRateChange, "pt")}`}
      {pop.presence === "new" && " · nouveau ce patch"}
      {pop.retiredPatch && ` · retiré au patch ${pop.retiredPatch} selon la source (écart à vérifier)`}
      <span className="muted">
        {" "}
        — {pop.attribution}, patch {pop.patch ?? "?"}, statistiques du {date(pop.statsDate)}
        {pop.statsDateSource === "estimated" ? " (date estimée)" : ""}. Une fréquence n'est ni une qualité ni une probabilité de victoire.
      </span>
    </span>
  );
}

function comboTitle(c: MayhemComboNote): string {
  if (c.needsVerification) return "Interaction à vérifier pour ce patch";
  if (c.status === "project") return "Projet de combo";
  return c.size === 1 ? "Combo documenté avec cet augment seul" : "Combo réalisable avec tes augments";
}

/** Combos deja tries par le moteur ; les projets lointains restent replies par defaut. */
export function ComboLines({ combos, total, outside = 0, nameOf }: { combos: MayhemComboNote[]; total?: number; outside?: number; nameOf: (key: string) => string }) {
  const [all, setAll] = useState(false);
  if (!combos.length) return outside > 0 ? <OutsidePool n={outside} /> : null;
  const shown = all ? combos : combos.slice(0, 3);
  const folded = combos.length - shown.length;
  const beyond = Math.max(0, (total ?? combos.length) - combos.length);
  return (
    <ul className="mh-combos">
      {shown.map((c) => (
        <li key={c.comboId} className={c.needsVerification ? "verify" : ""}>
          <b>{comboTitle(c)}</b>
          {c.status === "project" && c.missing.length > 0 && <> : il manque encore {c.missing.map(nameOf).join(", ")} (tirages incertains)</>}
          <span className="muted"> · {c.types.map((t) => COMBO_TYPE[t] ?? t).join(", ") || "sans étiquette"} · </span>
          <ExtLink href={c.url}>fiche</ExtLink>
        </li>
      ))}
      {folded > 0 && (
        <li className="mh-more">
          <button type="button" className="link-btn" onClick={() => setAll(true)}>
            Voir {folded} autre{folded > 1 ? "s" : ""} combo{folded > 1 ? "s" : ""}
          </button>
        </li>
      )}
      {all && beyond > 0 && (
        <li className="mh-more muted">
          + {beyond} projet{beyond > 1 ? "s" : ""} plus lointain{beyond > 1 ? "s" : ""} non affiché{beyond > 1 ? "s" : ""} ({total} documentés au total)
        </li>
      )}
      {outside > 0 && (
        <li className="mh-more">
          <OutsidePool n={outside} />
        </li>
      )}
      <li className="mh-more muted">Combos de la source : information, aucun bonus de note.</li>
    </ul>
  );
}

function OutsidePool({ n }: { n: number }) {
  return (
    <span className="muted">
      {n} combo{n > 1 ? "s" : ""} masqué{n > 1 ? "s" : ""} : un augment absent du patch actuel ou non relié au catalogue.
    </span>
  );
}

const TYPE_ORDER = ["god", "strong", "blackTech", "entertainment", "trap", "bug", ""];

/** Nom affichable d'un augment de la source : nom francais du catalogue si relie, sinon anglais. */
function useProviderNames(ds: MayhemDataset, catalog: MayhemCatalog) {
  return useMemo(() => {
    const fr = new Map(catalog.augments.map((a) => [a.key, a.nameFr]));
    const m = new Map<string, string>();
    ds.augments.forEach((a) => m.set(a.providerId, (a.nexKey && fr.get(a.nexKey)) || a.nameEn));
    return (id: string) => m.get(id) ?? id;
  }, [ds, catalog]);
}

/** Fiche champion : popularite et combos documentes du pool actuel, groupes par etiquette. */
export function ChampionSheet({ ds, catalog, championId, onUse, onClose }: { ds: MayhemDataset; catalog: MayhemCatalog; championId: string; onUse: () => void; onClose: () => void }) {
  const nameOf = useProviderNames(ds, catalog);
  const champ = ds.champions.find((c) => c.championId === championId);
  const all = ds.combos.filter((c) => c.championId === championId);
  const pool = all.filter((c) => c.inPool);
  const groups = TYPE_ORDER.map((t) => ({ t, list: pool.filter((c) => (t ? c.types.includes(t) : c.types.length === 0)) })).filter((g) => g.list.length);
  return (
    <section className="card card-pad mh-sheet" aria-label={`Fiche ${champ?.nameEn ?? championId}`}>
      <div className="mh-row" style={{ marginTop: 0 }}>
        <b style={{ fontSize: "var(--fs-lg)" }}>{champ?.nameEn ?? championId}</b>
        {champ && (
          <span className="muted">
            pick rate {pct(champ.pickRate, 2)} · rang {champ.pickRateRank ?? "—"} sur {ds.champions.length} (popularité, pas un tier)
          </span>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={onUse}>
          Utiliser dans le contexte simulé
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Fermer
        </button>
      </div>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Augments conseillés</dt>
        <dd className="muted">Indisponible : la source ne publie pas de tiers champion–augment sous licence. Les notes NEX viennent des règles NEX.</dd>
        <dt>Builds</dt>
        <dd className="muted">Indisponible : capacité non fournie par la source.</dd>
        <dt>Combos documentés</dt>
        <dd>
          {pool.length} dans le pool actuel
          {all.length > pool.length && <span className="muted"> · {all.length - pool.length} masqués (augment absent du patch actuel ou non relié)</span>}
        </dd>
      </dl>
      {groups.map(({ t, list }) => (
        <div key={t || "none"} className="mh-sheet-group">
          <div className="panel-label">
            {t ? (COMBO_TYPE[t] ?? t) : "sans étiquette"} · {list.length}
          </div>
          <ul className="mh-combos">
            {list.map((c) => (
              <li key={c.comboId} className={t === "bug" ? "verify" : ""}>
                {c.augmentIds.map(nameOf).join(" + ")} <span className="muted">· </span>
                <ExtLink href={c.url}>fiche</ExtLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "8px 0 0" }}>
        Étiquettes éditoriales de la source, sans conditions publiées : information, aucun bonus de note. « bug signalé » : interaction à vérifier pour ce patch.
      </p>
      <Credit ds={ds} />
    </section>
  );
}

/** Champions pour lesquels la source documente un combo (pool actuel) contenant cet augment. */
export function AugmentChampions({ ds, augmentKey, onPick }: { ds: MayhemDataset; augmentKey: string; onPick: (championId: string) => void }) {
  const ids = useMemo(() => new Set(ds.augments.filter((a) => a.nexKey === augmentKey).map((a) => a.providerId)), [ds, augmentKey]);
  const rows = useMemo(() => {
    const m = new Map<string, { n: number; types: Set<string> }>();
    ds.combos
      .filter((c) => c.inPool && c.augmentIds.some((a) => ids.has(a)))
      .forEach((c) => {
        const r = m.get(c.championId) ?? { n: 0, types: new Set<string>() };
        r.n += 1;
        c.types.forEach((t) => r.types.add(t));
        m.set(c.championId, r);
      });
    const name = new Map(ds.champions.map((c) => [c.championId, c.nameEn]));
    return [...m.entries()].map(([id, r]) => ({ id, name: name.get(id) ?? id, ...r })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [ds, ids]);
  if (!ids.size) return <span className="muted">Augment absent de l'export de la source.</span>;
  if (!rows.length) return <span className="muted">Aucun combo documenté par la source avec cet augment.</span>;
  return (
    <div className="mh-tags" style={{ marginTop: 4 }}>
      {rows.map((r) => (
        <button key={r.id} className="mh-aug" onClick={() => onPick(r.id)} title={[...r.types].map((t) => COMBO_TYPE[t] ?? t).join(", ") || "sans étiquette"}>
          {r.name} <span className="muted">{r.n}</span>
        </button>
      ))}
    </div>
  );
}

const CAP_LABEL: [keyof MayhemDataset["capabilities"], string][] = [
  ["catalog", "Catalogue (identifiants, noms, rareté)"],
  ["popularity", "Popularité (pick rate, rang par pick rate)"],
  ["combos", "Combos avec étiquettes éditoriales"],
  ["history", "Fichiers par patch (historique)"],
  ["globalTiers", "Tiers globaux des augments"],
  ["championAugmentTiers", "Tiers champion–augment"],
  ["builds", "Builds"],
];

export function SourcesPanel({ ds, catalog }: { ds: MayhemDataset; catalog: MayhemCatalog }) {
  const p = ds.provenance;
  const counts = useMemo(() => {
    const c = { exact: 0, alias: 0, ambiguous: 0, unmapped: 0 };
    ds.augments.forEach((a) => (c[a.mapping] += 1));
    const mapped = new Set(ds.augments.map((a) => a.nexKey).filter(Boolean));
    return { ...c, riotWithout: catalog.augments.filter((a) => !mapped.has(a.key)).length };
  }, [ds, catalog]);
  return (
    <section className="card card-pad mh-sources">
      <div className="panel-label">Sources et crédits</div>
      <p style={{ margin: "0 0 8px" }}>
        <Credit ds={ds} />
      </p>
      <dl className="kv">
        <dt>Fournisseur</dt>
        <dd>
          <ExtLink href={p.attributionUrl}>{p.provider}</ExtLink>
        </dd>
        <dt>Patch de la source</dt>
        <dd>
          {p.patch ?? "inconnu"} (publié le {date(p.patchReleaseDate)}), comparé à {p.comparedToPatch ?? "—"}
        </dd>
        <dt>Statistiques</dt>
        <dd>
          du {date(p.statsDate)} {p.statsDateSource === "estimated" ? "(date estimée par la source)" : "(date enregistrée)"} · échantillon limité, pas des données mondiales
        </dd>
        <dt>Publication</dt>
        <dd>
          {p.releaseId ?? "inconnue"} · récupérée le {new Date(p.fetchedAt).toLocaleString("fr-FR")}
        </dd>
        <dt>Périmètre déclaré</dt>
        <dd>{p.scope ?? "non précisé"}</dd>
        <dt>Correspondance</dt>
        <dd>
          {counts.exact} exactes, {counts.alias} alias contrôlés, {counts.ambiguous} ambiguës, {counts.unmapped} non reliées (sur {ds.augments.length}) ·{" "}
          {counts.riotWithout} augments du client sans donnée de la source
        </dd>
      </dl>
      <div className="mh-caps">
        {CAP_LABEL.map(([k, label]) => (
          <span key={k} className={ds.capabilities[k] ? "on" : "off"}>
            {ds.capabilities[k] ? "✓" : "✗"} {label}
          </span>
        ))}
      </div>
      <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "8px 0 0" }}>
        Les tiers, taux de victoire et rangs fondés sur les victoires ne sont pas publiés sous licence par la source : NEX ne les importe pas. Les notes NEX viennent
        uniquement des règles NEX ; la popularité et les combos sont affichés comme contexte.
      </p>
      {ds.anomalies.length > 0 && (
        <>
          <div className="panel-label" style={{ marginTop: 10 }}>
            Écarts à vérifier ({ds.anomalies.length})
          </div>
          <ul className="mh-anomalies">
            {ds.anomalies.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Popularite des champions : classement par pick rate, pas un tier ni un classement de puissance. */
export function ChampionPopularity({
  ds,
  catalog,
  selected,
  onSelect,
  onPick,
}: {
  ds: MayhemDataset;
  catalog: MayhemCatalog;
  selected: string | null;
  onSelect: (championId: string | null) => void;
  onPick: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const rows = ds.champions.filter((c) => !q || c.nameEn.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
    {selected && <ChampionSheet ds={ds} catalog={catalog} championId={selected} onUse={() => onPick(selected)} onClose={() => onSelect(null)} />}
    <section className="card">
      <div className="card-pad" style={{ paddingBottom: 0 }}>
        <div className="panel-label">Champions — popularité en ARAM Mayhem</div>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: "var(--fs-xs)" }}>
          Classés par pick rate (patch {ds.provenance.patch ?? "?"}). Ce n'est ni un tier ni un classement de puissance : les tiers et taux de victoire ne sont pas
          publiés sous licence. Les champions réellement disponibles dans ton lobby ne sont pas connus de la source.
        </p>
        <label className="search-box" style={{ maxWidth: 280, marginBottom: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un champion" aria-label="Rechercher un champion" />
        </label>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th className="num">Rang (pick rate)</th>
            <th>Champion</th>
            <th className="num">Pick rate</th>
            <th className="num">Variation</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((c) => (
            <tr key={c.championId} className={`clickable ${selected === c.championId ? "active" : ""}`} onClick={() => onSelect(c.championId)}>
              <td className="num muted">{c.pickRateRank ?? "—"}</td>
              <td>{c.nameEn}</td>
              <td className="num">{pct(c.pickRate, 2)}</td>
              <td className="num muted">
                {signed(c.pickRateChange, "pt")}
                {c.pickRateRankChange ? ` (${c.pickRateRankChange > 0 ? "+" : ""}${c.pickRateRankChange} places)` : ""}
              </td>
              <td>
                <ExtLink href={c.url}>source</ExtLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card-pad">
        <Credit ds={ds} />
      </div>
    </section>
    </>
  );
}
