// Petites icones de partie (objets, sorts, runes) avec nom accessible depuis le catalogue.
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { itemIcon, runeIcon, spellIcon } from "../../data/assets";
import { RemoteImg, Tip } from "../../ui/primitives";

const STAT_SHARDS: Record<number, string> = {
  5008: "Force adaptative",
  5005: "Vitesse d'attaque",
  5007: "Accélération de compétence",
  5001: "PV croissants",
  5011: "PV",
  5010: "Vitesse de déplacement",
  5013: "Ténacité et résistance aux ralentissements",
  5002: "Armure",
  5003: "Résistance magique",
};

export function statShardLabel(id: number): string {
  return STAT_SHARDS[id] ?? `Fragment ${id}`;
}

export function ItemIcon({ id, size = 24, trinket = false }: { id: number; size?: number; trinket?: boolean }) {
  const version = useDDragonVersion();
  const { catalog } = useAppState();
  if (!id) return <span className="slot-empty" style={{ width: size, height: size, borderRadius: trinket ? size / 2 : 5 }} aria-label="Emplacement vide" />;
  const item = catalog?.items[String(id)];
  const label = item ? `${item.name}${item.gold ? ` · ${item.gold} PO` : ""}` : `Objet ${id}`;
  return (
    <Tip text={item?.plaintext ? `${label} — ${item.plaintext}` : label}>
      <span className="game-icon" style={{ width: size, height: size, borderRadius: trinket ? size / 2 : 5 }} tabIndex={0}>
        <RemoteImg src={itemIcon(version, id)} alt={label} fallback="?" />
      </span>
    </Tip>
  );
}

export function SpellIcon({ id, size = 20 }: { id: number; size?: number }) {
  const version = useDDragonVersion();
  const { catalog } = useAppState();
  const s = catalog?.spells[String(id)];
  return (
    <Tip text={s?.name ?? `Sort ${id}`}>
      <span className="game-icon" style={{ width: size, height: size, borderRadius: 4 }} tabIndex={0}>
        <RemoteImg src={spellIcon(version, s?.image)} alt={s?.name ?? `Sort ${id}`} fallback="S" />
      </span>
    </Tip>
  );
}

export function RuneIcon({ id, size = 20, round = true }: { id: number | null; size?: number; round?: boolean }) {
  const { catalog } = useAppState();
  if (!id) return <span className="slot-empty" style={{ width: size, height: size, borderRadius: size / 2 }} />;
  const r = catalog?.runes[String(id)];
  return (
    <Tip text={r?.name ?? `Rune ${id}`}>
      <span className="game-icon rune" style={{ width: size, height: size, borderRadius: round ? size / 2 : 4 }} tabIndex={0}>
        <RemoteImg src={runeIcon(r?.icon)} alt={r?.name ?? `Rune ${id}`} fallback="R" />
      </span>
    </Tip>
  );
}
