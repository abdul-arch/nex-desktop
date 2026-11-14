// Animation de lancement : le logo se dessine au centre, rejoint sa place dans l'en-tete,
// puis l'ecran de bienvenue se compose et les LP montent jusqu'a leur valeur reelle.
//
// L'ecran ne joue qu'une fois, au demarrage de la fenetre principale : c'est l'appelant qui
// le monte et le demonte. Rien n'est ecrit ici, et aucune donnee n'est inventee — un joueur
// non classe montre son etat reel plutot qu'un faux rang.
import { ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useAsync } from "../../app/useAsync";
import { championName, championSplash, profileIcon, rankMiniCrest } from "../../data/assets";
import { demoPlayer } from "../../data/demo";
import { digitsOf } from "../../domain/countUp";
import { toSummary } from "../../domain/fromMatch";
import { championAggregates } from "../../domain/metrics";
import { platform } from "../../platform";
import type { MatchPageDto, PlayerProfileDto } from "../../platform/api";
import { TIER_LABEL } from "../../ui/format";
import { NexLogo } from "../../ui/NexLogo";
import { RemoteImg } from "../../ui/primitives";
import { useCountUp } from "./useCountUp";

/**
 * Etapes de la sequence, en millisecondes depuis l'ouverture. Une seule table : le rythme
 * se lit et se regle ici, au lieu d'etre disperse dans une suite de delais independants.
 */
const ETAPES = [
  { nom: "trace", debut: 0 }, //       0 — fond sombre, le logo se dessine
  { nom: "nom", debut: 1000 }, //      1 — « NEX » se revele a sa droite
  { nom: "deplacement", debut: 1800 }, // 2 — le bloc reduit et rejoint l'en-tete
  { nom: "profil", debut: 2400 }, //   3 — illustration, avatar, bienvenue, pseudo
  { nom: "rang", debut: 3000 }, //     4 — emblem, nom du rang, puis les LP montent
  { nom: "pret", debut: 3500 }, //     5 — le bouton d'entree, pendant la fin du compte
] as const;

const DUREE_LP = 900;

/** Preference systeme « reduire les animations » : on montre alors l'ecran installe. */
function useAnimationsReduites(): boolean {
  const [reduit, setReduit] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduit(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  return reduit;
}

export function IntroScreen({ onEnter }: { onEnter: () => void }) {
  const { settings, catalog } = useAppState();
  const version = useDDragonVersion();
  const reduit = useAnimationsReduites();
  const [etape, setEtape] = useState(0);
  const logoRef = useRef<HTMLSpanElement | null>(null);
  const blocRef = useRef<HTMLDivElement | null>(null);
  const [trajet, setTrajet] = useState<{ x: number; y: number; echelle: number; ox: number; oy: number } | null>(null);

  // Toute la sequence part d'une seule table : un seul effet, un seul nettoyage.
  useEffect(() => {
    if (reduit) {
      setEtape(ETAPES.length - 1);
      return;
    }
    const ids = ETAPES.map((e, i) => window.setTimeout(() => setEtape(i), e.debut));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [reduit]);

  // Le logo rejoint la position reelle de celui de la barre laterale, mesuree au moment
  // de partir : il tombe donc juste quelle que soit la taille de la fenetre.
  useLayoutEffect(() => {
    if (etape < 2 || trajet) return;
    const arrivee = document.querySelector(".sidebar .brand-mark");
    const depart = logoRef.current;
    const bloc = blocRef.current;
    if (!arrivee || !depart || !bloc) return;
    const a = arrivee.getBoundingClientRect();
    const d = depart.getBoundingClientRect();
    const b = bloc.getBoundingClientRect();
    if (!a.width || !d.width) return;
    // L'echelle s'applique autour du centre du logo, pas du bloc : le logo tombe donc
    // exactement sur sa place finale, et le mot « NEX » suit sans decaler le point d'arrivee.
    setTrajet({
      x: a.left + a.width / 2 - (d.left + d.width / 2),
      y: a.top + a.height / 2 - (d.top + d.height / 2),
      echelle: a.width / d.width,
      ox: d.left + d.width / 2 - b.left,
      oy: d.top + d.height / 2 - b.top,
    });
  }, [etape, trajet]);

  // Compte lie : meme cle de cache que la barre laterale et le tableau de bord, donc
  // aucune requete supplementaire si la donnee est deja la.
  const lie = !settings.demoMode && settings.linkedRiotId ? settings.linkedRiotId : "";
  const mine = useAsync<PlayerProfileDto>(
    lie ? `profile:${settings.linkedPlatform}:${lie.toLowerCase()}` : null,
    () => platform.playerProfile(lie, settings.linkedPlatform),
    300_000,
  );
  const joueur = settings.demoMode ? demoPlayer : mine.data;
  const solo = joueur?.ranks.find((r) => r.queue === "RANKED_SOLO_5x5") ?? null;
  const lp = solo ? solo.lp : null;
  const lpAffiche = useCountUp(lp, etape >= 4, reduit ? 0 : DUREE_LP);

  // Illustration : le champion le plus joue sur les dernieres parties. Meme cle de cache et
  // meme appel que le tableau de bord, donc une seule lecture pour les deux, et le tableau
  // de bord s'ouvre ensuite sans attendre.
  const puuid = mine.data?.puuid ?? null;
  const parties = useAsync<MatchPageDto>(
    puuid && !settings.demoMode ? `dash-matches:${settings.linkedPlatform}:${puuid}` : null,
    () => platform.playerMatches({ platform: settings.linkedPlatform, puuid: puuid!, start: 0, count: 20, timelines: 10 }),
    120_000,
  );
  const plusJoue = useMemo(() => {
    const liste = parties.data?.matches ?? [];
    if (!puuid || liste.length === 0) return null;
    const sommaires = liste.map((m) => toSummary(m, puuid)).filter((x): x is NonNullable<typeof x> => x !== null);
    const classe = championAggregates(sommaires).sort((a, b) => b.games - a.games);
    return classe[0] ?? null;
  }, [parties.data, puuid]);
  // A defaut de parties lues, le premier champion favori. Sans l'un ni l'autre, pas
  // d'illustration : aucun champion n'est impose a tous.
  const favori = settings.favoriteChampions?.[0];
  const cleChampion = plusJoue?.champion ?? (favori !== undefined ? catalog?.champions[String(favori)]?.key : undefined);

  const pseudo = joueur?.gameName ?? "";
  const tag = joueur?.tagLine ?? "";
  const rangConnu = solo !== null;
  const chargement = !joueur && (mine.loading || (!!lie && !mine.error));

  return (
    <div className="intro" data-etape={etape} role="dialog" aria-modal="true" aria-label="Bienvenue sur NEX">
      {cleChampion && (
        <div className="intro-fond" aria-hidden="true">
          <RemoteImg src={championSplash(cleChampion)} alt="" />
        </div>
      )}

      {/* Dit pourquoi ce champion est la : le nombre de parties, mesure sur l'echantillon
          lu. Riot expose aussi des points de maitrise, que l'application ne lit pas encore. */}
      {plusJoue && (
        <p className="intro-champion">
          <b>{championName(plusJoue.champion)}</b>
          <span className="muted">
            {plusJoue.games} partie{plusJoue.games > 1 ? "s" : ""} sur {parties.data?.matches.length ?? 0}
          </span>
        </p>
      )}

      <div
        className={`intro-logo${trajet ? " intro-logo-pose" : ""}`}
        ref={blocRef}
        style={
          trajet
            ? ({
                "--x": `${trajet.x}px`,
                "--y": `${trajet.y}px`,
                "--e": String(trajet.echelle),
                "--ox": `${trajet.ox}px`,
                "--oy": `${trajet.oy}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <span className="intro-logo-mark" ref={logoRef}>
          <NexLogo size={96} draw={!reduit} />
        </span>
        <span className="intro-logo-nom">NEX</span>
      </div>

      <div className="intro-profil">
        <div className="intro-avatar">
          <RemoteImg src={profileIcon(version, joueur?.profileIconId ?? -1)} alt="" fallback="?" />
        </div>
        <p className="intro-bienvenue">Bienvenue sur NEX</p>

        {/* La largeur finale est reservee par le texte lui-meme : la revelation se fait par
            rognage, donc rien ne bouge autour pendant qu'elle se joue. */}
        <p className="intro-pseudo">
          <span className="intro-pseudo-texte">{pseudo || (chargement ? "…" : "Aucun compte lié")}</span>
          {tag && <span className="intro-tag">#{tag}</span>}
        </p>

        <p className="intro-rang">
          {rangConnu ? (
            <>
              <span className="intro-embleme">
                <RemoteImg src={rankMiniCrest(solo.tier)} alt="" />
              </span>
              <span className="intro-rang-nom">
                {TIER_LABEL[solo.tier] ?? solo.tier}
                {solo.division ? ` ${solo.division}` : ""}
              </span>
              <b className="intro-lp num" style={{ minWidth: `${digitsOf(solo.lp)}ch` }}>
                {lpAffiche ?? 0}
              </b>
              <span className="intro-lp-label">LP</span>
            </>
          ) : (
            <span className="intro-rang-nom muted">{chargement ? "Chargement du rang…" : joueur ? "Non classé" : "Rang indisponible"}</span>
          )}
        </p>

        <button className="intro-entrer" onClick={onEnter} autoFocus>
          Entrer dans NEX <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
