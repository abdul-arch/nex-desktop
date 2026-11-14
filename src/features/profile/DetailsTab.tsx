// Onglet « Détails » d'un match, repris de la mise en page de DPM : trois cartes de
// mesures, le parcours d'achat en une seule ligne de temps, l'ordre des compétences en
// grille, puis les sorts lancés et les pings.
//
// Une mesure absente s'écrit « — » : la partie peut venir d'une version antérieure du
// normaliseur, ou du client League qui ne porte pas tous les champs. Afficher zéro à la
// place ferait passer « non fourni » pour une vraie valeur.
import { useMemo } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useAsync } from "../../app/useAsync";
import { spellIcon } from "../../data/assets";
import { groupPurchases, purchaseOrder, skillLabel, skillOrder } from "../../domain/fromMatch";
import { platform } from "../../platform";
import { PING_KINDS } from "../../platform/api";
import type { MatchDto, ParticipantDto, TimelineDto } from "../../platform/api";
import { duration } from "../../ui/format";
import { ItemIcon, SpellIcon } from "./GameIcons";

const NA = "—";
const nf = (v: number) => v.toLocaleString("fr-FR");
/** Le signe est écrit, pas seulement porté par la couleur. */
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(Math.abs(v))}`;
const mmss = (ms: number) => duration(Math.floor(ms / 1000));
/** Grille fixe : les 18 niveaux d'une partie, même si le joueur s'arrête avant. */
const MAX_LEVEL = 18;

/** Les quatre compétences du champion, pour leurs icônes. En cache par champion, donc
 *  changer de joueur ne relance pas la lecture d'un champion déjà vu. */
function useChampionSpells(me: ParticipantDto) {
  const { catalog } = useAppState();
  const champKey = catalog?.champions[String(me.championId)]?.key ?? me.champion;
  const info = useAsync(champKey ? `champion:${champKey}` : null, () => platform.championInfo(champKey), 3_600_000);
  return info.data?.spells ?? null;
}

interface Laning {
  cs: number;
  gold: number;
  xp: number;
  /** `null` quand la timeline ne donne pas le 2e point de l'un des deux joueurs. */
  firstLvl2: boolean | null;
}

/** Écarts avec l'adversaire de couloir à la 15e minute. `null` sans timeline, sans
 *  adversaire au même poste (ARAM, Arena) ou sans frame proche de 15 min. */
function useLaning(match: MatchDto, p: ParticipantDto, t: TimelineDto | null): Laning | null {
  return useMemo(() => {
    if (!t || !p.position) return null;
    const opp = match.participants.find((o) => o.teamId !== p.teamId && o.position === p.position);
    if (!opp) return null;
    const frame = t.frames.find((f) => Math.abs(f.timestamp - 900_000) < 30_000);
    const mine = frame?.players.find((x) => x.participantId === p.participantId);
    const his = frame?.players.find((x) => x.participantId === opp.participantId);
    if (!mine || !his) return null;
    // Riot n'émet pas d'événement « niveau 2 » dans la timeline : on prend l'instant du
    // 2e point de compétence, que les joueurs posent dès le niveau atteint. Un point gardé
    // en réserve fausserait la mesure, ce qui ne se voit guère au niveau 2.
    const lvl2 = (id: number) => {
      const ups = t.events.filter((e) => e.kind === "skill_level_up" && e.participantId === id);
      return ups.length >= 2 ? ups[1].timestamp : null;
    };
    const a = lvl2(p.participantId);
    const b = lvl2(opp.participantId);
    return {
      cs: mine.cs - his.cs,
      gold: mine.totalGold - his.totalGold,
      xp: mine.xp - his.xp,
      firstLvl2: a !== null && b !== null ? a < b : null,
    };
  }, [match, p, t]);
}

interface Figure {
  value: string;
  label: string;
  title?: string;
}

function StatCard({ title, figures }: { title: string; figures: Figure[] }) {
  return (
    <section className="card dpm-card">
      <div className="dpm-head">{title}</div>
      <div className="dpm-figures">
        {figures.map((f) => (
          <div key={f.label} className="dpm-figure" title={f.title}>
            <b className="num">{f.value}</b>
            <span className="muted">{f.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Parcours d'achat : une seule ligne de temps, les achats proches regroupés. */
function BuildOrderCard({ t, me }: { t: TimelineDto; me: ParticipantDto }) {
  const groups = useMemo(() => groupPurchases(purchaseOrder(t, me.participantId)), [t, me.participantId]);
  return (
    <section className="card dpm-card">
      <div className="dpm-head">Parcours d'achat</div>
      {groups.length === 0 ? (
        <div className="muted">Aucun achat enregistré.</div>
      ) : (
        <ol className="build-flow">
          {groups.map((g, i) => (
            <li key={i}>
              {i > 0 && (
                <span className="build-sep" aria-hidden="true">
                  ›
                </span>
              )}
              {/* La minute suffit à se repérer ; l'instant exact reste dans l'infobulle. */}
              <span className="build-step" title={mmss(g[0].timestamp)}>
                <span className="build-items">
                  {g.map((s, j) => (
                    // Une vente reste comprehensible sans la couleur : elle est barree et dite.
                    <span key={j} className={s.kind === "sell" ? "sold" : ""} title={s.kind === "sell" ? "Vendu" : undefined}>
                      <ItemIcon id={s.itemId} size={26} />
                      {s.kind === "sell" && <span className="sr-only">Vendu</span>}
                    </span>
                  ))}
                </span>
                <span className="muted num">{i === 0 ? "Départ" : `${Math.floor(g[0].timestamp / 60_000)} min`}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Ordre des compétences : une ligne par sort, une colonne par niveau. */
function SkillOrderCard({ t, me }: { t: TimelineDto; me: ParticipantDto }) {
  const { settings } = useAppState();
  const version = useDDragonVersion();
  const spells = useChampionSpells(me);
  const skills = useMemo(() => skillOrder(t, me.participantId), [t, me.participantId]);
  return (
    <section className="card dpm-card">
      <div className="dpm-head">Ordre des compétences</div>
      {skills.length === 0 ? (
        <div className="muted">Aucune donnée.</div>
      ) : (
        <table className="skill-grid" aria-label="Ordre des compétences">
          {/* Avec `table-layout: fixed`, ce sont les cellules de la premiere ligne qui fixent
              les colonnes — ici un en-tete masque, qui n'a pas de largeur. Les colonnes sont
              donc declarees ici, sinon la colonne des icones se reduit a l'icone. */}
          <colgroup>
            <col className="skill-col-head" />
            {Array.from({ length: MAX_LEVEL }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          <tbody>
            {[1, 2, 3, 4].map((slot) => {
              const spell = spells?.[slot - 1];
              const key = skillLabel(slot, settings.abilityKeys);
              return (
                <tr key={slot} data-slot={slot}>
                  <th scope="row">
                    {spell && <img className="skill-spell" src={spellIcon(version, spell.image) ?? ""} alt="" width={24} height={24} />}
                    <span className="skill-key">{key}</span>
                  </th>
                  {Array.from({ length: MAX_LEVEL }, (_, lvl) => {
                    const on = skills[lvl] === slot;
                    return (
                      <td key={lvl} className={on ? "on" : ""} title={on ? `${spell?.name ?? key} — niveau ${lvl + 1}` : undefined}>
                        {on ? lvl + 1 : ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Nombre de lancers, compétences puis sorts d'invocateur. */
function CastsCard({ me }: { me: ParticipantDto }) {
  const { settings } = useAppState();
  const version = useDDragonVersion();
  const spells = useChampionSpells(me);
  const casts = me.spellCasts;
  const summoners = me.summonerCasts;
  return (
    <section className="card dpm-card">
      <div className="dpm-head">Sorts lancés</div>
      {!casts && !summoners ? (
        <div className="muted">Non fourni pour cette partie.</div>
      ) : (
        <div className="cast-row">
          {[1, 2, 3, 4].map((slot) => {
            const spell = spells?.[slot - 1];
            const key = skillLabel(slot, settings.abilityKeys);
            return (
              <div key={slot} className="cast" title={spell?.name ?? key}>
                {spell ? (
                  <img src={spellIcon(version, spell.image) ?? ""} alt="" width={30} height={30} />
                ) : (
                  <span className="cast-blank" aria-hidden="true" />
                )}
                <span className="cast-key muted">{key}</span>
                <b className="num">{casts ? nf(casts[slot - 1]) : NA}</b>
                <span className="muted">fois</span>
              </div>
            );
          })}
          <span className="cast-split" aria-hidden="true" />
          {[0, 1].map((i) => (
            <div key={i} className="cast">
              <SpellIcon id={me.spells[i]} size={30} />
              <span className="cast-key muted">{i === 0 ? "D" : "F"}</span>
              <b className="num">{summoners ? nf(summoners[i]) : NA}</b>
              <span className="muted">fois</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Les pings de League ne sont pas distribués en images réutilisables : ils sont
 *  redessinés ici, pour rester nets à toute taille et sans dépendre du réseau. */
const PING_ART: Record<string, { color: string; path: string }> = {
  assistMe: { color: "#4a9eff", path: "M12 19 5 10.5h4V5h6v5.5h4z" },
  onMyWay: { color: "#35c88a", path: "M12 5l7 8.5h-4V19H9v-5.5H5z" },
  getBack: { color: "#4fc46a", path: "M5 12l8-7v4h6v6h-6v4z" },
  danger: { color: "#ef4444", path: "M11 5.5h2v8h-2zm0 10h2v2.5h-2z" },
  enemyMissing: { color: "#f2c14e", path: "M8.6 9.4a3.4 3.4 0 1 1 4.4 3.1v1.6h-2v-3.2h1.4a1.4 1.4 0 1 0-1.4-1.5zm2.4 7.1h2v2.2h-2z" },
  allIn: { color: "#43c97f", path: "M7 5h2.6l7.4 7-7.4 7H7l4.8-7z" },
};

function PingGlyph({ kind }: { kind: string }) {
  const art = PING_ART[kind];
  if (!art) return null;
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill={art.color} opacity="0.18" />
      <path d={art.path} fill={art.color} />
    </svg>
  );
}

function PingsCard({ me }: { me: ParticipantDto }) {
  return (
    <section className="card dpm-card">
      <div className="dpm-head">Pings</div>
      {!me.pings ? (
        <div className="muted">Non fourni pour cette partie.</div>
      ) : (
        <div className="ping-row">
          {PING_KINDS.map((k, i) => (
            <div key={k.key} className="ping" title={k.label}>
              <PingGlyph kind={k.key} />
              <b className="num">{nf(me.pings![i])}</b>
              <span className="sr-only">{k.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function DetailsTab({ match, me, t }: { match: MatchDto; me: ParticipantDto; t: TimelineDto | null }) {
  const laning = useLaning(match, me, t);
  const minutes = match.durationSec / 60;
  const perMin = (v: number) => (minutes > 0 ? (v / minutes).toFixed(1) : NA);
  const perMinInt = (v: number) => (minutes > 0 ? nf(Math.round(v / minutes)) : NA);
  // Balises de controle posees si Riot le dit, sinon celles achetees : deux mesures
  // differentes, donc le libelle change avec la source.
  const control = me.detectorWardsPlaced;

  return (
    <div className="dpm-tab">
      <div className="dpm-stats">
        <StatCard
          title="Phase de lane (à 15 min)"
          figures={[
            { value: laning ? signed(laning.cs) : NA, label: "CS", title: "Écart de CS avec l'adversaire de couloir" },
            { value: laning ? signed(laning.gold) : NA, label: "or", title: "Écart d'or avec l'adversaire de couloir" },
            { value: laning ? signed(laning.xp) : NA, label: "XP", title: "Écart d'expérience avec l'adversaire de couloir" },
            {
              value: laning?.firstLvl2 == null ? NA : laning.firstLvl2 ? "Oui" : "Non",
              label: "niveau 2",
              title: "Niveau 2 atteint avant l'adversaire de couloir. Mesuré sur le 2e point de compétence, faute d'événement « niveau 2 » dans la timeline.",
            },
          ]}
        />
        <StatCard
          title="Balises"
          figures={[
            { value: nf(me.wardsPlaced), label: "posées" },
            { value: nf(me.wardsKilled), label: "détruites" },
            control !== null
              ? { value: nf(control), label: "de contrôle posées" }
              : { value: nf(me.controlWardsBought), label: "de contrôle achetées" },
          ]}
        />
        <StatCard
          title="Moyennes par minute"
          figures={[
            { value: perMin(me.cs), label: "CS/min" },
            { value: perMin(me.visionScore), label: "vision/min" },
            { value: perMinInt(me.damageToChampions), label: "dégâts/min" },
            { value: perMinInt(me.goldEarned), label: "or/min" },
          ]}
        />
      </div>
      {t ? (
        <>
          <BuildOrderCard t={t} me={me} />
          <SkillOrderCard t={t} me={me} />
        </>
      ) : (
        <section className="card dpm-card">
          <div className="muted">Parcours d'achat et ordre des compétences : la timeline n'est pas disponible.</div>
        </section>
      )}
      <div className="dpm-bottom">
        <CastsCard me={me} />
        <PingsCard me={me} />
      </div>
    </div>
  );
}
