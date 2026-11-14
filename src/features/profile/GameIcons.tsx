// Petites icones de partie (objets, sorts, runes) avec nom accessible depuis le catalogue.
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { itemIcon, runeIcon, spellIcon } from "../../data/assets";
import { RemoteImg, Tip } from "../../ui/primitives";

// Les fragments de stats n'existent pas dans runesReforged, donc pas dans le catalogue : leur
// icone vit sous StatMods, ou le nom de fichier distingue les PV plats (Plus) des PV qui montent
// avec le niveau (Scaling). Sans cette table, RuneIcon retombait sur la pastille grise « R ».
const STAT_SHARDS: Record<number, { name: string; icon: string }> = {
  5008: { name: "Force adaptative", icon: "StatModsAdaptiveForceIcon" },
  5005: { name: "Vitesse d'attaque", icon: "StatModsAttackSpeedIcon" },
  5007: { name: "Accélération de compétence", icon: "StatModsCDRScalingIcon" },
  5001: { name: "PV croissants", icon: "StatModsHealthScalingIcon" },
  5011: { name: "PV", icon: "StatModsHealthPlusIcon" },
  5010: { name: "Vitesse de déplacement", icon: "StatModsMovementSpeedIcon" },
  5013: { name: "Ténacité et résistance aux ralentissements", icon: "StatModsTenacityIcon" },
  5002: { name: "Armure", icon: "StatModsArmorIcon" },
  5003: { name: "Résistance magique", icon: "StatModsMagicResIcon" },
};

export function statShardLabel(id: number): string {
  return STAT_SHARDS[id]?.name ?? `Fragment ${id}`;
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
  const shard = STAT_SHARDS[id];
  const label = r?.name ?? shard?.name ?? `Rune ${id}`;
  const src = r?.icon ? runeIcon(r.icon) : shard ? runeIcon(`perk-images/StatMods/${shard.icon}.png`) : null;
  return (
    <Tip text={label}>
      <span className="game-icon rune" style={{ width: size, height: size, borderRadius: round ? size / 2 : 4 }} tabIndex={0}>
        <RemoteImg src={src} alt={label} fallback="R" />
      </span>
    </Tip>
  );
}
