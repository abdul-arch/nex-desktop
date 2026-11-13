// Page d'etat des modules non encore livres : explique ce qui manque et comment
// le debloquer, au lieu d'afficher une interface vide ou des donnees inventees.
import { ArrowUpRight, Info } from "lucide-react";
import { useNav } from "../../app/navigation";
import { routeDef, type RouteId } from "../../app/routes";
import { platform } from "../../platform";

interface ModuleInfo {
  summary: string;
  needs: string[];
  docs?: { label: string; url: string };
}

const MODULES: Partial<Record<RouteId, ModuleInfo>> = {
  champions: {
    summary: "Fiches champions : compétences (touches A/Z/E/R ou Q/W/E/R selon tes réglages), runes, sorts, builds, matchups et skins.",
    needs: ["Catalogue Data Dragon versionné mis en cache par le noyau Rust", "Statistiques agrégées du backend NEX pour les builds et matchups"],
  },
  builds: {
    summary: "Builds et tier lists filtrables par patch, file, rôle, rang et région, avec effectifs et méthode de classement expliquée.",
    needs: ["Backend NEX : collecte autorisée et agrégations par patch", "Méthode de tier list documentée"],
  },
  leaderboards: {
    summary: "Classements par file et région, paginés et datés.",
    needs: ["Backend NEX : appels league-v4 mutualisés et mis en cache"],
    docs: { label: "API Riot", url: "https://developer.riotgames.com/apis" },
  },
  live: {
    summary: "Suivi de la partie : client absent, connecté, lobby, sélection, chargement, partie, après-partie, reconnexion.",
    needs: ["Adaptateur LCU isolé (endpoints limités, TLS épinglé sur le certificat du client)", "Live Client Data (port local du jeu) en lecture seule"],
    docs: { label: "Docs LoL (client local)", url: "https://developer.riotgames.com/docs/lol" },
  },
  matchups: {
    summary: "Distribution des adversaires autour du taux moyen, tableaux Fort contre / Faible contre, page de duel et simulateur de draft manuel.",
    needs: ["Agrégats matchups du backend NEX (même périmètre pour graphique et tableaux)", "Simulateur de draft manuel : réalisable sans client à l'étape 3"],
  },
  overlays: {
    summary: "Widgets flottants déplaçables et verrouillables : chronomètre, timers d'objectifs, rappels de build, de compétences et de trinket.",
    needs: ["Fenêtre overlay native unique, sans prise de focus, clics transmis au jeu", "Validation des règles Riot pour chaque assistance en partie"],
    docs: { label: "Règles produit Riot", url: "https://developer.riotgames.com/policies/general" },
  },
  recordings: {
    summary: "Galerie de clips et parties complètes, lecteur, timeline d'événements, replay instantané. Mode Eco par défaut : capture arrêtée.",
    needs: ["Windows.Graphics.Capture + encodage matériel H.264 1080p30 mesuré", "Index des clips en SQLite (migration dédiée)"],
  },
  collection: {
    summary: "Catalogue de skins, inventaire personnel vérifié, progression et valeur catalogue estimée (pas une dépense réelle).",
    needs: ["Catalogue de skins versionné", "Inventaire via le client local vérifié ; sinon état « inconnu » ou suivi manuel identifié"],
  },
  spectate: {
    summary: "Joueurs suivis et pros identifiés, état réel de leurs parties, lancement autorisé uniquement.",
    needs: ["Backend NEX : spectator-v5 et liste de joueurs vérifiés"],
  },
  datastudio: {
    summary: "CS, dégâts, vision, objectifs et tendances sur les périodes réellement collectées.",
    needs: ["Historique de matchs chargé via le backend NEX (étape 2)"],
  },
};

export function ModulePage({ id }: { id: RouteId }) {
  const def = routeDef(id);
  const info = MODULES[id];
  const { navigate } = useNav();
  const Icon = def.icon;
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <Icon aria-hidden="true" /> {def.label}
        </h1>
        <span className="chip">Étape {def.phase}</span>
      </div>
      <div className="card card-pad" style={{ maxWidth: 760, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Info size={16} className="muted" style={{ flex: "none", marginTop: 2 }} aria-hidden="true" />
          <div>
            <strong>Module pas encore disponible</strong>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {info?.summary}
            </p>
          </div>
        </div>
        {info && (
          <div>
            <div className="muted" style={{ fontSize: "var(--fs-xs)", fontWeight: 600, marginBottom: 6 }}>
              CE QU'IL RESTE À RACCORDER
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
              {info.needs.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => navigate("dashboard")}>
            Retour au dashboard
          </button>
          {info?.docs && (
            <button className="btn btn-ghost" onClick={() => platform.openExternal(info.docs!.url)}>
              {info.docs.label} <ArrowUpRight />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
