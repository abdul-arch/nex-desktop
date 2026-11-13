// Affichage uniforme des erreurs de source, avec une action pour les resoudre.
import { RotateCw } from "lucide-react";
import { useNav } from "../app/navigation";
import { isPlatformError, errorMessage } from "../platform";

const TITLES: Record<string, string> = {
  invalid_input: "Saisie invalide",
  not_found: "Introuvable",
  forbidden: "Action refusée",
  network: "Problème réseau",
  rate_limited: "Trop de requêtes",
  storage: "Erreur de stockage local",
  unavailable: "Source indisponible",
};

export function ErrorPanel({ error, onRetry, compact = false }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { navigate } = useNav();
  const code = isPlatformError(error) ? error.code : "unavailable";
  const message = errorMessage(error);
  const backendDown = code === "unavailable" && /backend|RIOT_API_KEY|cle Riot|clé Riot/i.test(message);
  return (
    <div className={`error-panel ${compact ? "compact" : ""}`} role="alert">
      <strong>{TITLES[code] ?? "Erreur"}</strong>
      <p>{message}</p>
      {backendDown && (
        <p className="muted">
          Le backend NEX détient la clé Riot. Démarre-le depuis le dossier <code>backend</code> avec{" "}
          <code>cargo run -p nex-backend</code>, après avoir renseigné <code>RIOT_API_KEY</code> dans <code>backend/.env</code>.
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {onRetry && (
          <button className="btn btn-sm" onClick={onRetry}>
            <RotateCw /> Réessayer
          </button>
        )}
        {backendDown && (
          <button className="btn btn-sm btn-ghost" onClick={() => navigate("settings")}>
            État des sources
          </button>
        )}
      </div>
    </div>
  );
}
