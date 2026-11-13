import { ArrowUpRight, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAppState } from "../../app/AppState";
import { PLATFORMS } from "../../domain/riotId";
import { NEX_SCORE_VERSION } from "../../domain/nexScore";
import { platform } from "../../platform";
import { Segmented } from "../../ui/primitives";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-label">{label}</div>
        {hint && <div className="settings-hint">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function SettingsPage() {
  const { settings, setSetting, info, staticData, staticDataError, recent, clearRecent, notify, backend, refreshBackend } = useAppState();
  const [urlDraft, setUrlDraft] = useState(settings.backendUrl);
  useEffect(() => setUrlDraft(settings.backendUrl), [settings.backendUrl]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <SettingsIcon aria-hidden="true" /> Paramètres
        </h1>
      </div>

      <div className="settings-grid">
        <section className="card card-pad">
          <h2 className="settings-h">Général</h2>
          <Row label="Langue" hint="L'anglais sera ajouté avec les traductions.">
            <Segmented
              label="Langue"
              options={[
                { value: "fr", label: "Français" },
                { value: "en", label: "English", disabled: true, hint: "Bientôt" },
              ]}
              value={settings.language}
              onChange={(v) => setSetting("language", v)}
            />
          </Row>
          <Row label="Touches des compétences" hint="Libellés utilisés dans les fiches champions et builds.">
            <Segmented
              label="Touches"
              options={[
                { value: "AZER", label: "A Z E R" },
                { value: "QWER", label: "Q W E R" },
              ]}
              value={settings.abilityKeys}
              onChange={(v) => setSetting("abilityKeys", v)}
            />
          </Row>
          <Row label="Région par défaut" hint="Pré-sélectionnée dans la recherche.">
            <select
              className="select"
              value={settings.defaultPlatform}
              onChange={(e) => setSetting("defaultPlatform", e.target.value)}
              aria-label="Région par défaut"
            >
              {PLATFORMS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="À la fermeture" hint="Zone de notification : la fenêtre est détruite (mémoire libérée), seuls le suivi du client et l'overlay restent actifs. « Quitter NEX » dans l'icône ferme tout.">
            <Segmented
              label="Fermeture"
              options={[
                { value: "quit", label: "Quitter" },
                { value: "tray", label: "Zone de notif." },
              ]}
              value={settings.closeBehavior}
              onChange={(v) => setSetting("closeBehavior", v)}
            />
          </Row>
        </section>

        <section className="card card-pad">
          <h2 className="settings-h">Données et performances</h2>
          <Row label="Mode démonstration" hint="Affiche des données fictives, toujours marquées DÉMO. Désactivé : seules les sources réelles sont affichées.">
            <Toggle checked={settings.demoMode} onChange={(v) => setSetting("demoMode", v)} label="Mode démonstration" />
          </Row>
          <Row label="Mode Eco" hint="Activé : aucune capture vidéo ni tampon de replay. Désactivé (mode Capture) : la fenêtre du jeu est enregistrée pendant tes parties. Réglages dans Enregistrements.">
            <Toggle checked={settings.ecoMode} onChange={(v) => setSetting("ecoMode", v)} label="Mode Eco" />
          </Row>
          <Row label="Backend NEX" hint="HTTPS obligatoire, sauf pour un backend local (127.0.0.1). La clé Riot reste sur le backend.">
            <form
              style={{ display: "flex", gap: 6 }}
              onSubmit={async (e) => {
                e.preventDefault();
                await setSetting("backendUrl", urlDraft.trim());
                const s = await refreshBackend();
                notify(s.reachable ? "Backend joignable" : `Backend injoignable : ${s.error ?? ""}`, s.reachable ? "success" : "error");
              }}
            >
              <input className="input" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} aria-label="URL du backend NEX" spellCheck={false} maxLength={200} />
              <button className="btn btn-sm" type="submit">
                Tester
              </button>
            </form>
          </Row>
          <Row label="Recherches récentes" hint={`${recent.length} enregistrée(s) localement.`}>
            <button
              className="btn btn-sm"
              disabled={!recent.length}
              onClick={async () => {
                await clearRecent();
                notify("Recherches récentes effacées", "success");
              }}
            >
              Effacer
            </button>
          </Row>
        </section>

        <section className="card card-pad">
          <h2 className="settings-h">État des sources</h2>
          <dl className="kv">
            <dt>Ressources statiques</dt>
            <dd>
              {staticData ? (
                <>
                  Data Dragon <span className="num">{staticData.version}</span>{" "}
                  <span className="muted">({staticData.source === "network" ? "réseau" : staticData.source === "cache" ? "cache" : "cache expiré, réseau indisponible"})</span>
                </>
              ) : staticDataError ? (
                <span className="neg">Indisponible : {staticDataError}</span>
              ) : (
                "Chargement…"
              )}
            </dd>
            <dt>Backend NEX</dt>
            <dd>
              {!backend ? (
                "Vérification…"
              ) : backend.reachable ? (
                <>
                  <span className="pos">Joignable</span> (v{backend.version}) ·{" "}
                  {backend.riotKeyConfigured ? <span className="pos">clé Riot configurée</span> : <span className="neg">clé Riot absente</span>}
                </>
              ) : (
                <span className="neg">Injoignable : {backend.error}</span>
              )}
            </dd>
            <dt>Compte lié</dt>
            <dd>{settings.linkedRiotId ? `${settings.linkedRiotId} (${settings.linkedPlatform})` : <span className="muted">Aucun</span>}</dd>
            <dt>Client League (LCU)</dt>
            <dd className="muted">Non raccordé (étape 4)</dd>
            <dt>Capture vidéo</dt>
            <dd className="muted">Non raccordée (étape 5)</dd>
          </dl>
        </section>

        <section className="card card-pad">
          <h2 className="settings-h">À propos</h2>
          <dl className="kv">
            <dt>Version</dt>
            <dd className="num">
              {info?.name} {info?.version} {info?.debug ? "(développement)" : ""}
            </dd>
            <dt>Base locale</dt>
            <dd className="num">schéma v{info?.schemaVersion ?? "?"}</dd>
            <dt>Score NEX</dt>
            <dd>
              v{NEX_SCORE_VERSION} — note 0–100 <strong>d'une partie</strong> : KDA 30 %, participation 20 %, CS/min 20 %, part des dégâts 20 %,
              vision/min 10 %, comparés à des repères par rôle (provisoires). Ce n'est pas une estimation du niveau d'un joueur, de son MMR ni de
              son rang : NEX n'en calcule aucune.
            </dd>
          </dl>

          <h3 className="settings-h3">Ce que NEX fait, et ne fait pas</h3>
          <ul className="settings-rules">
            <li>
              <strong>Aucun classement parallèle.</strong> Le Score NEX note une partie jouée, à partir de chiffres que Riot publie. NEX n'estime
              ni MMR, ni ELO, ni rang caché.
            </li>
            <li>
              <strong>Client League en lecture seule.</strong> NEX lit l'historique local pour les parties qu'une API publique ne fournit pas
              (ARAM Mayhem). Il n'écrit dans le client que sur une action explicite de ta part : importer une page de runes, importer un set
              d'objets, ouvrir une partie en spectateur. Jamais de son propre chef.
            </li>
            <li>
              <strong>Overlays : rien que le jeu ne te montre déjà.</strong> Ils sont construits à partir de la Live Client Data API, que Riot
              fournit pour cet usage, et d'événements que la partie annonce aux dix joueurs. Aucune lecture de la mémoire du jeu, aucune
              information cachée, aucune action automatisée à ta place.
            </li>
            <li>
              <strong>Aucun pari, aucune monétisation, aucune cryptomonnaie.</strong> NEX est gratuit, sans publicité et sans paiement.
            </li>
            <li>
              <strong>La clé Riot reste sur ta machine.</strong> Elle vit dans la configuration du backend local, jamais dans l'interface, jamais
              dans un fichier distribué.
            </li>
          </ul>

          <p className="settings-legal">
            Ressources graphiques : Data Dragon (Riot Games) pour les champions, objets, sorts et runes ; CommunityDragon (miroir communautaire des
            fichiers du client) pour les emblèmes de rang et les icônes de poste et d'objectifs.
          </p>
          <p className="settings-legal">
            NEX n'est ni approuvé ni sponsorisé par Riot Games et ne reflète pas les opinions de Riot Games ou de toute personne
            officiellement impliquée dans la production ou la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés
            associées sont des marques commerciales ou déposées de Riot Games, Inc.
          </p>
          <Row label="Diagnostic" hint="Version, plateforme et état du backend, à coller dans un rapport. Ne contient aucune clé ni mot de passe.">
            <button
              className="btn btn-sm"
              onClick={async () => {
                // Jamais de secret ici : ni cle Riot, ni identifiants, ni jeton du client.
                const lignes = [
                  `NEX ${info?.version ?? "?"}${info?.debug ? " (développement)" : ""}`,
                  `Schéma de base locale : v${info?.schemaVersion ?? "?"}`,
                  `Score NEX : v${NEX_SCORE_VERSION}`,
                  `Plateforme : ${platform.capabilities.kind}`,
                  `Backend : ${backend?.reachable ? "joignable" : "injoignable"}${backend?.version ? ` (v${backend.version})` : ""}`,
                  `Clé Riot configurée côté backend : ${backend?.riotKeyConfigured ? "oui" : "non"}`,
                  `Données statiques : ${staticData?.version ?? "non chargées"}${staticDataError ? " — erreur de chargement" : ""}`,
                  `Compte lié : ${settings.linkedRiotId ? "oui" : "non"}`,
                  `Relevé le ${new Date().toLocaleString("fr-FR")}`,
                ];
                try {
                  await navigator.clipboard.writeText(lignes.join("\n"));
                  notify("Diagnostic copié dans le presse-papiers.", "success");
                } catch {
                  notify("Copie impossible : ton navigateur a refusé l'accès au presse-papiers.", "error");
                }
              }}
            >
              Copier le diagnostic
            </button>
          </Row>
          <button className="btn btn-ghost btn-sm" onClick={() => platform.openExternal("https://developer.riotgames.com/policies/general")}>
            Règles des développeurs Riot <ArrowUpRight />
          </button>
        </section>
      </div>
    </div>
  );
}
