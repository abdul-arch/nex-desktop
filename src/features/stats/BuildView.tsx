// Affichage d'un build agrege (runes, sorts, objets, competences) : colonnes calquees sur
// l'ecran draft/build de reference (variantes a gauche, runes au centre, sorts/objets a droite).
import { Download } from "lucide-react";
import { useState } from "react";
import { useAppState } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { errorMessage, platform } from "../../platform";
import type { ChampionBuildDto, ImportOutcome, VariantDto } from "../../platform/api";
import { skillLabel } from "../../domain/fromMatch";
import { pct, ROLE_LABEL } from "../../ui/format";
import { EmptyState, Tip } from "../../ui/primitives";
import { ItemIcon, RuneIcon, SpellIcon, statShardLabel } from "../profile/GameIcons";

function Share({ v, total, min }: { v: VariantDto; total: number; min: number }) {
  const wr = v.games ? v.wins / v.games : null;
  return (
    <span className="variant-meta num">
      <span className={v.games < min ? "low-sample" : wr !== null && wr >= 0.5 ? "win" : "loss"}>{pct(wr, 1)}</span>
      <span className="muted">
        {v.games} p. · {pct(total ? v.games / total : null)}
      </span>
    </span>
  );
}

/** Import declenche par le joueur, verifie apres ecriture ; etat explicite a chaque etape. */
function ImportButton({ label, run }: { label: string; run: (replacePageId?: number) => Promise<ImportOutcome> }) {
  const client = useClient();
  const { notify } = useAppState();
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<ImportOutcome | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const connected = client.state?.status === "connected";

  const go = async (replace?: number) => {
    setBusy(true);
    try {
      const r = await run(replace);
      if (r.status === "needs_choice") {
        setChoice(r);
        setSelected(r.pages.find((p) => p.current)?.id ?? r.pages[0]?.id ?? null);
      } else {
        setChoice(null);
        notify(r.message, r.verified ? "success" : "error");
      }
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="import-wrap">
      <Tip
        text={connected ? "Envoie ce contenu au client League ouvert, puis vérifie qu'il a bien été enregistré." : "Ouvre le client League : NEX s'y connecte automatiquement."}
        align="end"
      >
        <span tabIndex={0}>
          <button className="btn btn-sm" disabled={!connected || busy} onClick={() => go()}>
            <Download /> {busy ? "Import…" : label}
          </button>
        </span>
      </Tip>
      {choice && (
        <div className="card card-pad import-choice" role="dialog" aria-label="Choisir la page à remplacer">
          <span style={{ fontSize: "var(--fs-sm)" }}>{choice.message}</span>
          {choice.pages.map((p) => (
            <label key={p.id}>
              <input type="radio" name="replace-page" checked={selected === p.id} onChange={() => setSelected(p.id)} /> {p.name}
              {p.current && <span className="muted">(page active)</span>}
            </label>
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={selected === null || busy} onClick={() => selected !== null && go(selected)}>
              Remplacer cette page
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setChoice(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

export function BuildView({ build, min }: { build: ChampionBuildDto; min: number }) {
  const { catalog, settings } = useAppState();
  const [page, setPage] = useState(0);
  if (!build.games) {
    return (
      <div className="card">
        <EmptyState title="Aucune partie collectée pour ce champion à ce poste">
          Le collecteur du backend NEX alimente ces statistiques progressivement. Élargis le périmètre (tous les patchs, toutes les régions) ou reviens plus tard.
        </EmptyState>
      </div>
    );
  }
  const rp = build.runePages[page] ?? build.runePages[0];
  const tl = build.timelineGames;
  const runeName = (id: number) => catalog?.runes[String(id)]?.name ?? String(id);
  const champName = catalog?.champions[String(build.championId)]?.name ?? `Champion ${build.championId}`;
  const importRunes = (replacePageId?: number) =>
    platform.importRunes({
      championName: champName,
      primaryStyle: rp.ids[0],
      subStyle: rp.ids[5],
      perks: [...rp.ids.slice(1, 5), ...rp.ids.slice(6, 11)],
      replacePageId: replacePageId ?? null,
    });
  const importItems = () => {
    const blocks = [
      { label: "Départ", items: build.startItems[0]?.ids ?? [] },
      { label: "Build principal", items: build.coreItems[0]?.ids ?? [] },
      { label: "Bottes", items: build.boots[0]?.ids ?? [] },
      { label: "Situationnels", items: build.lateItems.slice(0, 6).map((v) => v.ids[0]) },
    ].filter((b) => b.items.length > 0);
    if (!blocks.length) return Promise.reject({ code: "unavailable", message: "Pas assez de parties avec timeline pour proposer des objets." });
    return platform.importItems({ championId: build.championId, championName: champName, role: ROLE_LABEL[build.position] ?? build.position, blocks });
  };

  return (
    <div className="build-grid">
      <section className="card card-pad build-variants" aria-label="Variantes de runes">
        <div className="panel-label">Pages de runes</div>
        {build.runePages.length === 0 && <div className="muted">Aucune page complète.</div>}
        {build.runePages.map((v, i) => (
          <button key={i} className="variant" aria-pressed={i === page} onClick={() => setPage(i)}>
            <RuneIcon id={v.ids[1]} size={26} />
            <RuneIcon id={v.ids[5]} size={16} />
            <span className="variant-name">{runeName(v.ids[1])}</span>
            <Share v={v} total={build.games} min={min} />
          </button>
        ))}
        <div className="panel-label" style={{ marginTop: 14 }}>
          Sorts d'invocateur
        </div>
        {build.spells.map((v, i) => (
          <div key={i} className="variant static">
            <SpellIcon id={v.ids[0]} size={24} />
            <SpellIcon id={v.ids[1]} size={24} />
            <span className="variant-name" />
            <Share v={v} total={build.games} min={min} />
          </div>
        ))}
      </section>

      <section className="card card-pad build-runes" aria-label="Détail de la page de runes">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div className="panel-label" style={{ margin: 0 }}>
            Runes
          </div>
          <span className="spacer" />
          {rp && <ImportButton label="Importer les runes" run={importRunes} />}
        </div>
        {rp ? (
          <div className="rune-tree">
            <div>
              <div className="tree-head">
                <RuneIcon id={rp.ids[0]} size={22} /> {runeName(rp.ids[0])}
              </div>
              {rp.ids.slice(1, 5).map((id, i) => (
                <div key={id} className="tree-row">
                  <RuneIcon id={id} size={i === 0 ? 44 : 32} />
                  <span>{runeName(id)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="tree-head">
                <RuneIcon id={rp.ids[5]} size={22} /> {runeName(rp.ids[5])}
              </div>
              {rp.ids.slice(6, 8).map((id) => (
                <div key={id} className="tree-row">
                  <RuneIcon id={id} size={32} />
                  <span>{runeName(id)}</span>
                </div>
              ))}
              <div className="tree-head" style={{ marginTop: 12 }}>
                Fragments
              </div>
              {rp.ids.slice(8, 11).map((id, i) => (
                <div key={i} className="shard-row">
                  {statShardLabel(id)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="muted">Aucune page complète.</div>
        )}

        <div className="panel-label" style={{ marginTop: 16 }}>
          Ordre des compétences {tl < build.games && <span className="muted">({tl} parties avec timeline)</span>}
        </div>
        {build.skillPriority.length === 0 ? (
          <div className="muted">Pas assez de timelines.</div>
        ) : (
          build.skillPriority.slice(0, 2).map((v, i) => (
            <div key={i} className="variant static">
              <span className="skill-chain">
                {v.ids.map((s, j) => (
                  <span key={j}>
                    <kbd className="skill-key">{skillLabel(s, settings.abilityKeys)}</kbd>
                    {j < v.ids.length - 1 && <span className="muted"> › </span>}
                  </span>
                ))}
              </span>
              <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                départ {build.skillStart[0]?.ids.map((s) => skillLabel(s, settings.abilityKeys)).join(" ") ?? "—"}
              </span>
              <Share v={v} total={tl} min={min} />
            </div>
          ))
        )}
      </section>

      <section className="card card-pad build-items" aria-label="Objets">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div className="panel-label" style={{ margin: 0 }}>
            Objets {tl < build.games && <span className="muted">({tl} p. avec timeline)</span>}
          </div>
          <span className="spacer" />
          <ImportButton label="Importer les objets" run={() => importItems()} />
        </div>
        <ItemSection title="Départ" variants={build.startItems} total={tl} min={min} />
        <ItemSection title="Build principal (3 premiers objets)" variants={build.coreItems} total={tl} min={min} arrows />
        <ItemSection title="Bottes" variants={build.boots} total={tl} min={min} />
        <div className="panel-label" style={{ marginTop: 12 }}>
          Situationnels (4e–6e objet)
        </div>
        <div className="late-items">
          {build.lateItems.length === 0 && <span className="muted">—</span>}
          {build.lateItems.map((v) => (
            <span key={v.ids[0]} className="late-item">
              <ItemIcon id={v.ids[0]} size={30} />
              <span className="num muted">{v.games} p.</span>
            </span>
          ))}
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "10px 0 0" }}>
          Fréquences d'achat observées, pas une relation de cause à effet sur la victoire.
        </p>
      </section>
    </div>
  );
}

function ItemSection({ title, variants, total, min, arrows = false }: { title: string; variants: VariantDto[]; total: number; min: number; arrows?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="panel-label">{title}</div>
      {variants.length === 0 && <div className="muted">—</div>}
      {variants.slice(0, 3).map((v, i) => (
        <div key={i} className="variant static">
          <span className="item-row">
            {v.ids.map((id, j) => (
              <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                <ItemIcon id={id} size={28} />
                {arrows && j < v.ids.length - 1 && <span className="muted">›</span>}
              </span>
            ))}
          </span>
          <span className="variant-name" />
          <Share v={v} total={total} min={min} />
        </div>
      ))}
    </div>
  );
}
