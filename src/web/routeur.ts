// Adresses du site : correspondance entre l'URL du navigateur et la `Location` que les
// pages lisent deja via `useNav()`.
//
// POURQUOI : la navigation de l'application vit en memoire. C'est juste pour une fenetre
// de bureau, et rhedibitoire pour un site — aucun profil n'est partageable, un
// rechargement perd la page. Ce module traduit dans les deux sens, et les pages ne
// changent pas : elles continuent de lire `location.params`.
//
// Un Riot ID contient un `#`, qui est un fragment en URL. Il s'ecrit `Nom-TAG` : le tag
// n'a jamais de tiret, le nom peut en avoir, donc on coupe sur le DERNIER.
import type { Location } from "../app/navigation";
import type { RouteId } from "../app/routes";

const RIOT_ID_SEP = "-";

/** Un objet de parametres sans entree vide, ou `undefined` s'il n'en reste aucune. */
function parametres(entrees: Iterable<[string, string]>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of entrees) if (v) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export function locationDepuisUrl(pathname: string, search: string): Location {
  const seg = pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  const q = new URLSearchParams(search);
  if (seg.length === 0) return { route: "accueil" };
  switch (seg[0]) {
    case "joueur": {
      const platform = (seg[1] ?? "").toUpperCase();
      const id = seg[2] ?? "";
      const i = id.lastIndexOf(RIOT_ID_SEP);
      if (!platform || i <= 0 || i === id.length - 1) return { route: "accueil" };
      return { route: "profile", params: { riotId: `${id.slice(0, i)}#${id.slice(i + 1)}`, platform } };
    }
    case "champions":
      return { route: "champions", params: parametres(q.entries()) };
    case "champion":
      return { route: "champions", params: parametres([["champion", seg[1] ?? ""], ...q.entries()]) };
    case "classements":
      return { route: "leaderboards", params: parametres(q.entries()) };
    case "matchups":
      return { route: "matchups", params: parametres(q.entries()) };
    case "collection":
      return { route: "collection" };
    case "mayhem":
      return { route: "mayhem" };
    case "studio":
      return { route: "datastudio" };
    case "parametres":
      return { route: "settings" };
    default:
      return { route: "accueil" };
  }
}

function requete(p: Record<string, string>): string {
  const s = new URLSearchParams(p).toString();
  return s ? `?${s}` : "";
}

export function urlDepuisLocation(loc: Location): string {
  const p = loc.params ?? {};
  switch (loc.route as RouteId | "accueil") {
    case "accueil":
    case "dashboard":
      return "/";
    case "profile": {
      const riotId = p.riotId ?? "";
      const i = riotId.lastIndexOf("#");
      if (i <= 0) return "/";
      const nom = riotId.slice(0, i);
      const tag = riotId.slice(i + 1);
      return `/joueur/${(p.platform || "euw1").toLowerCase()}/${encodeURIComponent(nom)}${RIOT_ID_SEP}${encodeURIComponent(tag)}`;
    }
    case "champions": {
      const { champion, ...reste } = p;
      return champion ? `/champion/${encodeURIComponent(champion)}${requete(reste)}` : `/champions${requete(reste)}`;
    }
    case "leaderboards":
      return `/classements${requete(p)}`;
    case "matchups":
      return `/matchups${requete(p)}`;
    case "collection":
      return "/collection";
    case "mayhem":
      return "/mayhem";
    case "datastudio":
      return "/studio";
    case "settings":
      return "/parametres";
    default:
      return `/${loc.route}${requete(p)}`;
  }
}

/** Titre d'onglet par page : un site se partage, un onglet se retrouve. */
export function titreDe(loc: Location): string {
  const p = loc.params ?? {};
  switch (loc.route as RouteId | "accueil") {
    case "accueil":
      return "NEX — statistiques League of Legends";
    case "profile":
      return p.riotId ? `${p.riotId} — NEX` : "Profil — NEX";
    case "champions":
      return p.champion ? `${p.champion} — builds et matchups — NEX` : "Champions — tier list — NEX";
    case "leaderboards":
      return "Classements — NEX";
    case "matchups":
      return "Matchups et draft — NEX";
    default:
      return "NEX";
  }
}
