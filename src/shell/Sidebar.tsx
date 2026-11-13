import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAppState, useDDragonVersion } from "../app/AppState";
import { useNav } from "../app/navigation";
import { NAV_SECTIONS, SETTINGS_ROUTE, type RouteDef } from "../app/routes";
import { useAsync } from "../app/useAsync";
import { platform } from "../platform";
import type { PlayerProfileDto } from "../platform/api";
import { TIER_LABEL } from "../ui/format";
import { profileIcon } from "../data/assets";
import { platformLabel } from "../domain/riotId";
import { demoPlayer } from "../data/demo";
import { RemoteImg, Tip } from "../ui/primitives";
import { NexLogo } from "../ui/NexLogo";

function NavItem({ r, collapsed }: { r: RouteDef; collapsed: boolean }) {
  const { location, navigate } = useNav();
  const Icon = r.icon;
  const active = location.route === r.id;
  const btn = (
    <button className="nav-item" aria-current={active ? "page" : undefined} onClick={() => navigate(r.id)}>
      <Icon aria-hidden="true" />
      <span className="nav-label">{r.label}</span>
      {r.phase > 1 && r.id !== "profile" && (
        <span className="nav-badge" title={`Disponible à l'étape ${r.phase}`}>
          É{r.phase}
        </span>
      )}
    </button>
  );
  return collapsed ? <Tip text={r.label}>{btn}</Tip> : btn;
}

export function Sidebar() {
  const { settings, setSetting, info } = useAppState();
  const { navigate } = useNav();
  const version = useDDragonVersion();
  const collapsed = settings.sidebarCollapsed;
  const solo = demoPlayer.ranks.find((r) => r.queue === "RANKED_SOLO_5x5");
  // Compte lie : icone, niveau et rang reels (meme cle de cache que le dashboard et le profil).
  const linked = !settings.demoMode && settings.linkedRiotId ? settings.linkedRiotId : "";
  const mine = useAsync<PlayerProfileDto>(
    linked ? `profile:${settings.linkedPlatform}:${linked.toLowerCase()}` : null,
    () => platform.playerProfile(linked, settings.linkedPlatform),
    300_000,
  );
  const mySolo = mine.data?.ranks.find((r) => r.queue === "RANKED_SOLO_5x5");

  return (
    <aside className="sidebar" aria-label="Navigation principale">
      <div className="brand" data-tauri-drag-region>
        <NexLogo />
        <div className="brand-text" data-tauri-drag-region>
          <strong>nex.lol</strong>
          <span>App v{info?.version ?? "…"}</span>
        </div>
      </div>

      <nav className="nav">
        {NAV_SECTIONS.map((s) => (
          <div className="nav-section" key={s.title}>
            <div className="nav-section-title">{s.title}</div>
            {s.routes.map((r) => (
              <NavItem key={r.id} r={r} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavItem r={SETTINGS_ROUTE} collapsed={collapsed} />
        <button
          className="nav-item"
          onClick={() => setSetting("sidebarCollapsed", !collapsed)}
          aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          <span className="nav-label">Replier</span>
        </button>
        {settings.demoMode ? (
          <button className="profile-chip" onClick={() => navigate("profile")} aria-label="Ouvrir le profil de démonstration">
            <span className="avatar">
              <RemoteImg src={profileIcon(version, demoPlayer.profileIconId)} alt="" fallback="NX" />
              <span className="avatar-level num">{demoPlayer.level}</span>
            </span>
            <span className="profile-meta">
              <strong>{demoPlayer.gameName}</strong>
              <span>
                #{demoPlayer.tagLine} · <span className="rank-txt">{solo ? `${solo.tier} ${solo.division ?? ""}` : "Non classé"}</span>
              </span>
            </span>
          </button>
        ) : settings.linkedRiotId ? (
          <button
            className="profile-chip"
            onClick={() => navigate("profile", { riotId: settings.linkedRiotId, platform: settings.linkedPlatform })}
            aria-label={`Ouvrir mon profil ${settings.linkedRiotId}`}
          >
            <span className="avatar">
              {mine.data ? (
                <>
                  <RemoteImg src={profileIcon(version, mine.data.profileIconId)} alt="" fallback={settings.linkedRiotId.slice(0, 2).toUpperCase()} />
                  <span className="avatar-level num">{mine.data.level}</span>
                </>
              ) : (
                <span className="img-fallback">{settings.linkedRiotId.slice(0, 2).toUpperCase()}</span>
              )}
            </span>
            <span className="profile-meta">
              <strong>{settings.linkedRiotId.split("#")[0]}</strong>
              <span>
                #{settings.linkedRiotId.split("#")[1]} ·{" "}
                {mine.data ? (
                  <span className="rank-txt">{mySolo ? `${TIER_LABEL[mySolo.tier] ?? mySolo.tier} ${mySolo.division ?? ""}`.trim() : "Non classé"}</span>
                ) : (
                  platformLabel(settings.linkedPlatform)
                )}
              </span>
            </span>
          </button>
        ) : (
          <button className="profile-chip" onClick={() => navigate("profile")}>
            <span className="avatar">
              <span className="img-fallback">?</span>
            </span>
            <span className="profile-meta">
              <strong>Aucun compte</strong>
              <span>Lier un Riot ID</span>
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
