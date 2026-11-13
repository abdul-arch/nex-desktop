import { ArrowUpRight, Clock, Search, Star, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../app/AppState";
import { useNav } from "../app/navigation";
import { ALL_ROUTES, type RouteId } from "../app/routes";
import { PLATFORMS, parseRiotId, platformLabel } from "../domain/riotId";

type Item =
  | { kind: "player"; riotId: string; platform: string; label: string; meta: string; icon: "user" | "recent" | "fav" }
  | { kind: "route"; route: RouteId; label: string; meta: string };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { recent, favorites, settings, pushRecent, clearRecent } = useAppState();
  const { navigate } = useNav();
  const [query, setQuery] = useState("");
  const [plat, setPlat] = useState(settings.defaultPlatform);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setError(null);
      setActive(0);
      setPlat(settings.defaultPlatform);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      restoreRef.current?.focus?.();
    }
  }, [open, settings.defaultPlatform]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    if (q.includes("#")) {
      out.push({ kind: "player", riotId: query.trim(), platform: plat, label: `Rechercher ${query.trim()}`, meta: platformLabel(plat), icon: "user" });
    }
    const matchPlayer = (p: { gameName: string; tagLine: string }) =>
      !q || `${p.gameName}#${p.tagLine}`.toLowerCase().includes(q);
    for (const f of favorites.filter(matchPlayer).slice(0, 5)) {
      out.push({ kind: "player", riotId: `${f.gameName}#${f.tagLine}`, platform: f.platform, label: `${f.gameName}#${f.tagLine}`, meta: platformLabel(f.platform), icon: "fav" });
    }
    for (const r of recent.filter(matchPlayer).slice(0, 6)) {
      out.push({ kind: "player", riotId: `${r.gameName}#${r.tagLine}`, platform: r.platform, label: `${r.gameName}#${r.tagLine}`, meta: platformLabel(r.platform), icon: "recent" });
    }
    for (const r of ALL_ROUTES.filter((r) => !q || r.label.toLowerCase().includes(q))) {
      out.push({ kind: "route", route: r.id, label: r.label, meta: "Page" });
    }
    return out;
  }, [query, plat, favorites, recent]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const run = async (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "route") {
      navigate(item.route);
      onClose();
      return;
    }
    const parsed = parseRiotId(item.riotId);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const id = `${parsed.value.gameName}#${parsed.value.tagLine}`;
    await pushRecent(id, item.platform);
    navigate("profile", { riotId: id, platform: item.platform });
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (query.trim() && !query.includes("#") && items.length === 0) {
        setError("Pour un joueur, saisis son Riot ID complet : Pseudo#TAG");
        return;
      }
      void run(items[active]);
    } else if (e.key === "Tab") {
      // Piege de focus dans la modale.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>("input, select, button");
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const groups: { title: string; filter: (i: Item) => boolean; clear?: () => void }[] = [
    { title: "Joueur", filter: (i) => i.kind === "player" && i.icon === "user" },
    { title: "Favoris", filter: (i) => i.kind === "player" && i.icon === "fav" },
    { title: "Recherches récentes", filter: (i) => i.kind === "player" && i.icon === "recent", clear: () => void clearRecent() },
    { title: "Pages", filter: (i) => i.kind === "route" },
  ];

  return (
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Recherche" ref={dialogRef} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            placeholder="Pseudo#TAG, page…"
            aria-label="Rechercher"
            aria-activedescendant={items[active] ? `pal-${active}` : undefined}
            aria-controls="palette-list"
            spellCheck={false}
            maxLength={40}
          />
          <select value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Région">
            {PLATFORMS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <div className="palette-error" role="alert">
            {error}
          </div>
        )}
        <div className="palette-body" id="palette-list" role="listbox" aria-label="Résultats">
          {items.length === 0 && <div className="palette-group">Aucun résultat. Pour un joueur : Pseudo#TAG</div>}
          {groups.map((g) => {
            const entries = items.map((it, idx) => ({ it, idx })).filter(({ it }) => g.filter(it));
            if (!entries.length) return null;
            return (
              <div key={g.title} role="group" aria-label={g.title}>
                <div className="palette-group">
                  <span>{g.title}</span>
                  {g.clear && (
                    <button onClick={g.clear} tabIndex={-1}>
                      Effacer
                    </button>
                  )}
                </div>
                {entries.map(({ it, idx }) => (
                  <button
                    key={idx}
                    id={`pal-${idx}`}
                    role="option"
                    aria-selected={idx === active}
                    className="palette-item"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => void run(it)}
                    tabIndex={-1}
                  >
                    {it.kind === "route" ? (
                      <ArrowUpRight aria-hidden="true" />
                    ) : it.icon === "fav" ? (
                      <Star aria-hidden="true" />
                    ) : it.icon === "recent" ? (
                      <Clock aria-hidden="true" />
                    ) : (
                      <User aria-hidden="true" />
                    )}
                    <span>{it.label}</span>
                    <span className="meta">{it.meta}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="palette-hint">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> naviguer
          </span>
          <span>
            <kbd>Entrée</kbd> ouvrir
          </span>
          <span>
            <kbd>Échap</kbd> fermer
          </span>
        </div>
      </div>
    </div>
  );
}
