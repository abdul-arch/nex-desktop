// Personnes vues le plus souvent dans la meme equipe, d'apres les participants des parties
// chargees (2 parties communes au minimum). Un clic ouvre leur profil. Utilisee sur le
// dashboard (compte lie) et sur la page Profil & historique (n'importe quel profil).
//
// L'icone affichee est celle du compte (invocateur). Les parties ne la fournissent pas :
// elle vient du profil, lu une fois par personne et par session, un compte a la fois pour
// menager le quota Riot. Tant qu'elle manque, la pastille reste neutre.
import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { championName, profileIcon } from "../../data/assets";
import type { Teammate } from "../../domain/teammates";
import { platform } from "../../platform";
import { RemoteImg } from "../../ui/primitives";

/** Icone d'invocateur par compte (« region:riotid »), pour la duree de la session. */
const icons = new Map<string, number>();

export function TeammatesCard({ mates, plat, sample }: { mates: Teammate[]; plat: string; sample: number }) {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const [, bump] = useState(0);
  const ids = mates.map((t) => t.id).join(",");

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const t of mates) {
        const key = `${plat}:${t.id}`;
        if (icons.has(key)) continue;
        let icon: number | null = null;
        try {
          icon = (await platform.playerProfile(t.riotId, plat)).profileIconId;
        } catch {
          // Compte introuvable, limite Riot ou reseau : pastille neutre, nouvel essai plus tard.
          icon = null;
        }
        if (!alive) return;
        if (icon !== null) {
          icons.set(key, icon);
          bump((n) => n + 1);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [ids, plat]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card champ-perf" aria-label="Souvent en même équipe">
      <div className="card-title" style={{ justifyContent: "center" }}>
        <Users aria-hidden="true" /> Souvent en même équipe
      </div>
      {mates.length ? (
        <div className="mates-list">
          {mates.map((t) => {
            const cut = t.riotId.lastIndexOf("#");
            const icon = icons.get(`${plat}:${t.id}`);
            return (
              <button
                key={t.id}
                onClick={() => navigate("profile", { riotId: t.riotId, platform: plat })}
                aria-label={`Ouvrir le profil de ${t.riotId}`}
                title={t.champion ? `${t.riotId} · champion le plus joué dans vos parties communes : ${championName(t.champion)}` : t.riotId}
              >
                <span className="mate-avatar">{icon != null && <RemoteImg src={profileIcon(version, icon)} alt="" fallback="" />}</span>
                <span className="mate-id">
                  <strong>{t.riotId.slice(0, cut)}</strong>
                  <small>#{t.riotId.slice(cut + 1)}</small>
                </span>
                <span className="num mate-n">
                  {t.games} partie{t.games > 1 ? "s" : ""}
                </span>
                <span className="num">
                  {t.wins}V – {t.games - t.wins}D
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center", fontSize: "var(--fs-sm)", margin: 0 }}>
          Personne vu plus d'une fois dans la même équipe sur ces parties.
        </p>
      )}
      <p className="mates-note">
        Sur les {sample} partie{sample > 1 ? "s" : ""} chargée{sample > 1 ? "s" : ""}. Icône d'invocateur du compte ; le champion le plus joué ensemble est dans
        l'infobulle.
      </p>
    </section>
  );
}
