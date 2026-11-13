// URLs des ressources statiques Data Dragon (Riot). Les cles de champion sont
// validees avant d'etre inserees dans une URL.
const DD = "https://ddragon.leagueoflegends.com/cdn";
const SAFE_KEY = /^[A-Za-z0-9]{1,32}$/;
const SAFE_VERSION = /^\d+\.\d+\.\d+$/;

const ok = (key: string) => SAFE_KEY.test(key);

export function championIcon(version: string | null, key: string): string | null {
  if (!version || !SAFE_VERSION.test(version) || !ok(key)) return null;
  return `${DD}/${version}/img/champion/${key}.png`;
}

/** Splash horizontal (~1215x717). Reserve aux grandes illustrations. */
export function championSplash(key: string, skin = 0): string | null {
  if (!ok(key) || !Number.isInteger(skin) || skin < 0) return null;
  return `${DD}/img/champion/splash/${key}_${skin}.jpg`;
}

/** Illustration verticale (~308x560), plus legere : cartes et galeries. */
export function championLoading(key: string, skin = 0): string | null {
  if (!ok(key) || !Number.isInteger(skin) || skin < 0) return null;
  return `${DD}/img/champion/loading/${key}_${skin}.jpg`;
}

export function profileIcon(version: string | null, id: number): string | null {
  if (!version || !SAFE_VERSION.test(version) || !Number.isInteger(id) || id < 0) return null;
  return `${DD}/${version}/img/profileicon/${id}.png`;
}

export function itemIcon(version: string | null, id: number): string | null {
  if (!version || !SAFE_VERSION.test(version) || !Number.isInteger(id) || id <= 0) return null;
  return `${DD}/${version}/img/item/${id}.png`;
}

export function spellIcon(version: string | null, image: string | undefined): string | null {
  if (!version || !SAFE_VERSION.test(version) || !image || !ok(image)) return null;
  return `${DD}/${version}/img/spell/${image}.png`;
}

const SAFE_PERK = /^perk-images\/[A-Za-z0-9_/.-]+\.png$/;
export function runeIcon(path: string | undefined): string | null {
  if (!path || !SAFE_PERK.test(path) || path.includes("..")) return null;
  return `${DD}/img/${path}`;
}

// ---------- Visuels du client du jeu (rangs, postes, objectifs) ----------
// Source : CommunityDragon (miroir public des fichiers du client League). Ressources Riot Games,
// utilisees dans le cadre des regles Riot pour les projets communautaires (cf. Parametres > A propos).
const CD = "https://raw.communitydragon.org/latest/plugins";
const TIERS = ["iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"];
const POSITIONS: Record<string, string> = { TOP: "top", JUNGLE: "jungle", MIDDLE: "middle", BOTTOM: "bottom", UTILITY: "utility" };
const OBJECTIVES = ["baron", "dragon", "herald", "tower", "inhibitor"] as const;

/** Embleme de rang officiel (grande taille, ~80 Ko) : bandeaux et cartes de rang. */
export function rankEmblem(tier: string): string | null {
  const t = tier.toLowerCase();
  return TIERS.includes(t) ? `${CD}/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${t}.png` : null;
}

/** Mini-blason de rang (SVG, ~2 Ko) : listes et tableaux. */
export function rankMiniCrest(tier: string): string | null {
  const t = tier.toLowerCase();
  return TIERS.includes(t) ? `${CD}/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${t}.svg` : null;
}

export function positionIcon(position: string | null | undefined): string | null {
  const p = position ? POSITIONS[position] : undefined;
  return p ? `${CD}/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${p}.png` : null;
}

export function objectiveIcon(kind: (typeof OBJECTIVES)[number], team: number): string | null {
  if (!OBJECTIVES.includes(kind)) return null;
  return `${CD}/rcp-fe-lol-match-history/global/default/${kind}-${team === 200 ? 200 : 100}.png`;
}

/** Noms d'affichage des champions dont la cle Data Dragon differe. */
const DISPLAY: Record<string, string> = {
  MonkeyKing: "Wukong",
  Leblanc: "LeBlanc",
  KSante: "K'Sante",
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  Velkoz: "Vel'Koz",
  Chogath: "Cho'Gath",
  RekSai: "Rek'Sai",
  KogMaw: "Kog'Maw",
  Belveth: "Bel'Veth",
  AurelionSol: "Aurelion Sol",
  LeeSin: "Lee Sin",
  MasterYi: "Master Yi",
  MissFortune: "Miss Fortune",
  TwistedFate: "Twisted Fate",
  XinZhao: "Xin Zhao",
  JarvanIV: "Jarvan IV",
  DrMundo: "Dr. Mundo",
  TahmKench: "Tahm Kench",
  RenataGlasc: "Renata Glasc",
  Nunu: "Nunu & Willump",
};

export function championName(key: string): string {
  return DISPLAY[key] ?? key;
}
