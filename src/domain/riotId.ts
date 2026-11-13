// Validation Riot ID cote interface (retour immediat). Rust revalide toujours.
export interface RiotIdParts {
  gameName: string;
  tagLine: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseRiotId(input: string): Result<RiotIdParts> {
  const raw = input.trim();
  const idx = raw.lastIndexOf("#");
  if (idx < 0) return { ok: false, error: "Format attendu : Pseudo#TAG" };
  const gameName = raw.slice(0, idx).trim();
  const tagLine = raw.slice(idx + 1).trim();
  const nameLen = [...gameName].length;
  if (nameLen < 3 || nameLen > 16) return { ok: false, error: "Le pseudo doit contenir entre 3 et 16 caractères" };
  if (gameName.includes("#")) return { ok: false, error: "Pseudo invalide" };
  const tagLen = [...tagLine].length;
  if (tagLen < 3 || tagLen > 5 || !/^[\p{L}\p{N}]+$/u.test(tagLine))
    return { ok: false, error: "Le tag doit contenir 3 à 5 caractères alphanumériques" };
  return { ok: true, value: { gameName, tagLine } };
}

export const PLATFORMS: { code: string; label: string }[] = [
  { code: "EUW1", label: "EUW" },
  { code: "EUN1", label: "EUNE" },
  { code: "TR1", label: "TR" },
  { code: "RU", label: "RU" },
  { code: "ME1", label: "ME" },
  { code: "NA1", label: "NA" },
  { code: "BR1", label: "BR" },
  { code: "LA1", label: "LAN" },
  { code: "LA2", label: "LAS" },
  { code: "KR", label: "KR" },
  { code: "JP1", label: "JP" },
  { code: "OC1", label: "OCE" },
  { code: "SG2", label: "SG" },
  { code: "TW2", label: "TW" },
  { code: "VN2", label: "VN" },
];

export function platformLabel(code: string): string {
  return PLATFORMS.find((p) => p.code === code)?.label ?? code;
}
