import { ChevronLeft, ChevronRight, Gem, RotateCw, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { useAsync } from "../../app/useAsync";
import { championLoading, championSplash } from "../../data/assets";
import { groupKey, RARITIES, summarize, viewSkins, type GroupBy, type SkinView } from "../../domain/skins";
import { platform } from "../../platform";
import type { SkinCatalog, SkinInventory, SkinRarity } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { timeAgo } from "../../ui/format";
import { RemoteImg, Segmented } from "../../ui/primitives";
import { VirtualGrid, type VGroup } from "../../ui/VirtualGrid";
import { useChampionById, useChampionList } from "../stats/statsShared";

type OwnFilter = "all" | "owned" | "missing";
type Sort = "acquired" | "name" | "rarity" | "champion";
type Avail = "available" | "unavailable" | "legacy";
const SIZES = { s: 140, m: 175, l: 220 } as const;

export function CollectionPage() {
  const { settings, setSetting } = useAppState();
  const client = useClient();
  const byId = useChampionById();
  const champions = useChampionList();
  const catalog = useAsync<SkinCatalog>("skin-catalog", () => platform.skinCatalog(), 3_600_000);
  const inventory = useAsync<SkinInventory>("skin-inventory", () => platform.skinInventory(), 300_000);
  const [q, setQ] = useState("");
  const [own, setOwn] = useState<OwnFilter>("all");
  const [champ, setChamp] = useState(0);
  const [line, setLine] = useState(0);
  const [rarities, setRarities] = useState<Set<SkinRarity>>(new Set());
  const [avail, setAvail] = useState<Set<Avail>>(new Set());
  const [onlyFav, setOnlyFav] = useState(false);
  const [group, setGroup] = useState<GroupBy>("year");
  const [sort, setSort] = useState<Sort>("acquired");
  const [size, setSize] = useState<keyof typeof SIZES>("m");
  const [preview, setPreview] = useState<number | null>(null);
  const favs = useMemo(() => new Set(settings.favoriteSkins ?? []), [settings.favoriteSkins]);

  // Inventaire relu quand le client se connecte.
  const connected = client.state?.status === "connected";
  const firstConnect = useRef(connected);
  useEffect(() => {
    if (connected && !firstConnect.current) inventory.reload();
    firstConnect.current = connected;
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const { catalog: champCatalog } = useAppState();
  // Seuls les skins d'un champion connu du catalogue Data Dragon (illustration disponible).
  const views = useMemo(() => {
    if (!catalog.data || !champCatalog) return [];
    const skins = catalog.data.skins.filter((s) => champCatalog.champions[String(s.championId)]);
    return viewSkins(skins, inventory.data ?? null);
  }, [catalog.data, inventory.data, champCatalog]);
  const lineName = (id: number) => catalog.data?.lines[String(id)] ?? `Série ${id}`;
  const champName = (id: number) => byId(id)?.name ?? `Champion ${id}`;

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = views.filter((v) => {
      if (own === "owned" && v.state !== "owned") return false;
      if (own === "missing" && v.state !== "missing") return false;
      if (champ && v.championId !== champ) return false;
      if (line && !v.lines.includes(line)) return false;
      if (rarities.size && !rarities.has(v.rarity)) return false;
      if (onlyFav && !favs.has(v.id)) return false;
      if (avail.size) {
        const ok =
          (avail.has("legacy") && v.legacy) ||
          (avail.has("available") && v.obtainable === true) ||
          (avail.has("unavailable") && v.obtainable === false);
        if (!ok) return false;
      }
      return !ql || v.name.toLowerCase().includes(ql) || champName(v.championId).toLowerCase().includes(ql);
    });
    const rIdx = (r: SkinRarity) => RARITIES.findIndex((x) => x.id === r);
    list.sort((a, b) => {
      switch (sort) {
        case "acquired":
          return (b.acquiredAt ?? 0) - (a.acquiredAt ?? 0) || b.id - a.id;
        case "name":
          return a.name.localeCompare(b.name, "fr");
        case "rarity":
          return rIdx(b.rarity) - rIdx(a.rarity) || a.name.localeCompare(b.name, "fr");
        case "champion":
          return champName(a.championId).localeCompare(champName(b.championId), "fr") || a.num - b.num;
      }
    });
    return list;
  }, [views, q, own, champ, line, rarities, onlyFav, avail, sort, favs]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups: VGroup<SkinView>[] = useMemo(() => {
    const map = new Map<string, SkinView[]>();
    for (const v of filtered) {
      const k = groupKey(v, group, champName, lineName);
      const arr = map.get(k) ?? [];
      arr.push(v);
      map.set(k, arr);
    }
    return [...map.entries()].map(([title, items]) => {
      const o = items.filter((i) => i.state === "owned").length;
      return { title, subtitle: items[0]?.state === "unknown" ? `${items.length}` : `${o} / ${items.length}`, items };
    });
  }, [filtered, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = summarize(views);
  const inv = inventory.data;
  const known = !!inv && inv.source !== "unknown";
  const counts = (pred: (v: SkinView) => boolean) => {
    const all = views.filter(pred);
    return known ? `${all.filter((v) => v.state === "owned").length}/${all.length}` : String(all.length);
  };
  const toggle = <T,>(set: Set<T>, v: T, fn: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    fn(n);
  };
  const toggleFav = (id: number) => setSetting("favoriteSkins", favs.has(id) ? [...favs].filter((x) => x !== id) : [...favs, id]);
  const lines = useMemo(
    () => Object.entries(catalog.data?.lines ?? {}).map(([id, name]) => ({ id: Number(id), name })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [catalog.data],
  );

  if (catalog.error != null && !catalog.data) {
    return (
      <div className="page">
        <ErrorPanel error={catalog.error} onRetry={() => catalog.reload()} />
      </div>
    );
  }

  return (
    <div className="page collection-page">
      <aside className="coll-filters" aria-label="Filtres">
        <div className="page-title" style={{ fontSize: 22 }}>
          <Gem aria-hidden="true" /> Collection
        </div>
        <p className="muted" style={{ margin: "2px 0 14px", fontSize: "var(--fs-sm)" }}>
          Chaque skin de ton compte, et ceux qui manquent encore.
        </p>
        <div className="panel-label">
          <SlidersHorizontal size={12} /> Filtres
        </div>
        <label className="search-box" style={{ minWidth: 0 }}>
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un skin" aria-label="Rechercher un skin" />
        </label>
        <Segmented
          size="md"
          label="Possession"
          options={[
            { value: "all", label: "Tous" },
            { value: "owned", label: "Possédés", disabled: !known },
            { value: "missing", label: "Manquants", disabled: !known },
          ]}
          value={own}
          onChange={setOwn}
        />
        <div className="panel-label">Champion</div>
        <select className="select" value={champ} onChange={(e) => setChamp(Number(e.target.value))}>
          <option value={0}>Tous les champions</option>
          {champions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="panel-label">Série</div>
        <select className="select" value={line} onChange={(e) => setLine(Number(e.target.value))}>
          <option value={0}>Toutes les séries</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <div className="panel-label">Rareté</div>
        {RARITIES.map((r) => (
          <label key={r.id} className="coll-check">
            <input type="checkbox" checked={rarities.has(r.id)} onChange={() => toggle(rarities, r.id, setRarities)} />
            <i style={{ background: r.color }} /> {r.label}
            <span className="num muted">{counts((v) => v.rarity === r.id)}</span>
          </label>
        ))}
        <div className="panel-label">Disponibilité</div>
        {/* Seul le statut Legacy (catalogue Riot) est fiable ; la disponibilite en boutique n'a pas de source fiable. */}
        <label className="coll-check" title="Skins Legacy : retirés de la vente permanente, ils reviennent ponctuellement en boutique.">
          <input type="checkbox" checked={avail.has("legacy")} onChange={() => toggle(avail, "legacy", setAvail)} />
          Legacy
          <span className="num muted">{counts((v) => v.legacy)}</span>
        </label>
        <label className="coll-check">
          <input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} /> <Star size={12} /> Favoris
          <span className="num muted">{favs.size}</span>
        </label>
      </aside>

      <section className="coll-main">
        <div className="card coll-progress">
          <div>
            <div className="coll-count num">
              {known ? (
                <>
                  <b>{sum.owned}</b> / {sum.total}
                </>
              ) : (
                <>
                  <b>?</b> / {sum.total}
                </>
              )}
            </div>
            <div className="progress" role="progressbar" aria-valuenow={sum.owned} aria-valuemax={sum.total} aria-label="Progression">
              <span style={{ width: `${known && sum.total ? (sum.owned / sum.total) * 100 : 0}%` }} />
            </div>
            <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 6 }}>
              {inv?.source === "client"
                ? `Skins possédés · ${sum.total ? Math.round((sum.owned / sum.total) * 100) : 0} % · inventaire lu dans le client ${timeAgo(inv.fetchedAt ?? Date.now())}`
                : inv?.source === "cache"
                  ? `Dernier relevé du client : ${new Date(inv.fetchedAt ?? 0).toLocaleString("fr-FR")} (client fermé)`
                  : "Inventaire inconnu : ouvre le client League pour le relever (lecture seule)."}
              {inv && (
                <button className="btn btn-ghost btn-sm" onClick={() => inventory.reload()} style={{ marginLeft: 6 }}>
                  <RotateCw /> Relire
                </button>
              )}
            </div>
          </div>
          <div className="coll-value" title="Somme des prix habituels par rareté (Épique 1 350, Légendaire 1 820, Ultime 3 250 RP). Ni tes dépenses réelles, ni une valeur de revente.">
            <div className="num">
              {known ? sum.estimatedRp.toLocaleString("fr-FR") : "—"} <small>RP</small>
            </div>
            <span className="muted">Valeur catalogue estimée{known && sum.ownedWithoutPrice ? ` · ${sum.ownedWithoutPrice} skins sans prix RP direct` : ""}</span>
          </div>
        </div>

        <div className="coll-toolbar">
          <span className="muted num">{filtered.length} skins</span>
          <span className="spacer" />
          <label className="field">
            <span>Grouper</span>
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value as GroupBy)}>
              <option value="year">Année d'acquisition</option>
              <option value="champion">Champion</option>
              <option value="rarity">Rareté</option>
              <option value="line">Série</option>
              <option value="none">Aucun</option>
            </select>
          </label>
          <label className="field">
            <span>Trier</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="acquired">Date d'acquisition</option>
              <option value="name">Nom</option>
              <option value="rarity">Rareté</option>
              <option value="champion">Champion</option>
            </select>
          </label>
          <label className="field">
            <span>Taille</span>
            <select className="select" value={size} onChange={(e) => setSize(e.target.value as keyof typeof SIZES)}>
              <option value="s">Petite</option>
              <option value="m">Moyenne</option>
              <option value="l">Grande</option>
            </select>
          </label>
        </div>

        {!catalog.data ? (
          <div className="card card-pad muted">Chargement du catalogue de skins…</div>
        ) : (
          <VirtualGrid
            groups={groups}
            minCardWidth={SIZES[size]}
            aspect={560 / 308}
            metaHeight={0}
            getKey={(v) => v.id}
            renderCard={(v) => <SkinCard v={v} champKey={byId(v.championId)?.key ?? null} fav={favs.has(v.id)} onOpen={() => setPreview(v.id)} />}
          />
        )}
      </section>

      {preview !== null && (
        <SkinPreview
          list={filtered}
          id={preview}
          onId={setPreview}
          onClose={() => setPreview(null)}
          keyOf={(id) => byId(id)?.key ?? null}
          champName={champName}
          lineName={lineName}
          fav={favs}
          onFav={(id) => void toggleFav(id)}
        />
      )}
    </div>
  );
}

function SkinCard({ v, champKey, fav, onOpen }: { v: SkinView; champKey: string | null; fav: boolean; onOpen: () => void }) {
  const r = RARITIES.find((x) => x.id === v.rarity)!;
  return (
    <button className={`skin-tile ${v.state}`} onClick={onOpen} aria-label={`${v.name}${v.state === "owned" ? ", possédé" : v.state === "missing" ? ", manquant" : ""}`}>
      <RemoteImg src={champKey ? championLoading(champKey, v.num) : null} alt="" />
      <span className="skin-gem" style={{ background: r.color }} title={r.label} />
      {fav && <Star className="skin-fav" size={13} fill="currentColor" />}
      <span className="skin-info">
        <b>{v.name}</b>
        <span>{v.price ? `${v.price.toLocaleString("fr-FR")} RP` : v.rarity === "standard" ? "Prix variable" : "Sans prix RP direct"}</span>
      </span>
    </button>
  );
}

function SkinPreview({
  list,
  id,
  onId,
  onClose,
  keyOf,
  champName,
  lineName,
  fav,
  onFav,
}: {
  list: SkinView[];
  id: number;
  onId: (id: number) => void;
  onClose: () => void;
  keyOf: (championId: number) => string | null;
  champName: (id: number) => string;
  lineName: (id: number) => string;
  fav: Set<number>;
  onFav: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  const i = Math.max(0, list.findIndex((v) => v.id === id));
  const v = list[i];
  if (!v) return null;
  const go = (d: number) => onId(list[(i + d + list.length) % list.length].id);
  const key = keyOf(v.championId);
  const r = RARITIES.find((x) => x.id === v.rarity)!;
  return (
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="skin-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={v.name}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        {/* Illustration haute definition chargee uniquement a l'ouverture. */}
        <RemoteImg src={key ? championSplash(key, v.num) : null} alt={v.name} />
        <div className="skin-viewer-bar">
          <button className="icon-btn" onClick={() => go(-1)} aria-label="Skin précédent">
            <ChevronLeft />
          </button>
          <div>
            <strong>{v.name}</strong>
            <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {champName(v.championId)} · <span style={{ color: r.color }}>{r.label}</span>
              {v.lines.length > 0 && ` · ${v.lines.map(lineName).join(", ")}`}
              {v.legacy && " · Legacy"}
              {v.obtainable === false && " · plus disponible"} ·{" "}
              {v.state === "owned" ? `possédé${v.acquiredAt ? ` depuis le ${new Date(v.acquiredAt).toLocaleDateString("fr-FR")}` : ""}` : v.state === "missing" ? "non possédé" : "possession inconnue"} ·{" "}
              {v.price ? `${v.price} RP (prix habituel)` : "sans prix RP direct"}
            </div>
          </div>
          <span className="spacer" />
          <span className="muted num">
            {i + 1} / {list.length}
          </span>
          <button className="btn btn-sm" aria-pressed={fav.has(v.id)} onClick={() => onFav(v.id)}>
            <Star fill={fav.has(v.id) ? "currentColor" : "none"} style={fav.has(v.id) ? { color: "var(--gold)" } : undefined} /> Favori
          </button>
          <button className="icon-btn" onClick={() => go(1)} aria-label="Skin suivant">
            <ChevronRight />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer (Échap)">
            <X />
          </button>
        </div>
      </div>
    </div>
  );
}
