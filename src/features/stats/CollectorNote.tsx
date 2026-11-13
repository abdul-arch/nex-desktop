import type { StatsMetaDto } from "../../platform/api";
import { timeAgo } from "../../ui/format";

/** Etat de la collecte : rend visible la taille reelle des donnees derriere les statistiques. */
export function CollectorNote({ meta }: { meta: StatsMetaDto | null }) {
  if (!meta) return null;
  const c = meta.collector;
  return (
    <div className="collector-note">
      <span className="status-dot" data-state={c.enabled ? (c.lastError ? "warn" : "ok") : "off"} />
      {c.enabled ? (
        <span>
          Collecte active ({c.platforms.join(", ")}) · <b className="num">{c.matchesTotal}</b> parties analysées
          {c.lastIngestedAt ? ` · dernière ${timeAgo(c.lastIngestedAt)}` : ""}
          {c.lastError ? <span className="muted"> · {c.lastError}</span> : null}
        </span>
      ) : (
        <span>
          Collecte désactivée sur le backend (NEX_COLLECTOR=off) · <b className="num">{c.matchesTotal}</b> parties en base
        </span>
      )}
    </div>
  );
}
