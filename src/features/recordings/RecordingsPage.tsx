import { Circle, Film, FolderOpen, Search, Square, Star, Trash, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { championName } from "../../data/assets";
import { errorMessage, platform } from "../../platform";
import type { CaptureStatus, Recording, StorageInfo } from "../../platform/api";
import { duration, timeAgo } from "../../ui/format";
import { ChampIcon, EmptyState, Segmented } from "../../ui/primitives";

type KindFilter = "all" | "clip" | "full";
const PAGE = 48;

const gib = (b: number) => (b / 1024 ** 3).toFixed(1);

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function RecordingsPage() {
  const { notify } = useAppState();
  const [list, setList] = useState<Recording[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [q, setQ] = useState("");
  const [champ, setChamp] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Recording | null>(null);
  const caps = platform.capabilities;

  const reload = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([platform.recordingsList(), platform.recordingsStorage()]);
      setList(l);
      setStorage(s);
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }, [notify]);

  useEffect(() => {
    void reload();
    platform.captureStatus().then(setStatus).catch(() => {});
    const offs: Promise<() => void>[] = [
      platform.on("recordings://changed", () => void reload()),
      platform.on<CaptureStatus>("capture://status", setStatus),
      platform.on<{ Ok?: string; Err?: string }>("capture://clip", (r) =>
        r.Err ? notify(`Replay non sauvegardé : ${r.Err}`, "error") : notify(`Clip sauvegardé : ${r.Ok}`, "success"),
      ),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [reload, notify]);

  // Compteurs en direct (images, tampon) seulement pendant une capture, a 0,5 Hz.
  useEffect(() => {
    if (!status?.active) return;
    const id = window.setInterval(() => platform.captureStatus().then(setStatus).catch(() => {}), 2000);
    return () => window.clearInterval(id);
  }, [status?.active]);

  const champions = useMemo(() => [...new Set(list.map((r) => r.championKey).filter((c): c is string => !!c))].sort(), [list]);
  const filtered = list.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (!onlyFav || r.favorite) &&
      (!champ || r.championKey === champ) &&
      (!q || r.title.toLowerCase().includes(q.toLowerCase()) || (r.championKey ?? "").toLowerCase().includes(q.toLowerCase())),
  );
  const visible = filtered.slice(0, shown);
  const groups = useMemo(() => {
    const g: { label: string; items: Recording[] }[] = [];
    for (const r of visible) {
      const label = dayLabel(r.createdAt);
      const last = g[g.length - 1];
      if (last && last.label === label) last.items.push(r);
      else g.push({ label, items: [r] });
    }
    return g;
  }, [visible]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <Film aria-hidden="true" /> Enregistrements
        </h1>
        <p className="page-sub">Clips et parties complètes, enregistrés localement. Rien n'est partagé sans ton action.</p>
        <div className="spacer" />
        {storage && (
          <span className="rec-storage num">
            <b>{storage.count}</b> vidéos · {gib(storage.usedBytes)} / {gib(storage.quotaBytes)} Gio
            {storage.freeBytes !== null && <span className="muted"> · {gib(storage.freeBytes)} Gio libres</span>}
          </span>
        )}
      </div>

      {!caps.windowControls ? (
        <div className="card">
          <EmptyState title="Disponible dans l'application desktop" />
        </div>
      ) : (
        <>
          <CapturePanel status={status} onStatus={setStatus} />

          <div className="grid-toolbar">
            <label className="search-box">
              <Search size={14} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un clip" aria-label="Rechercher un clip" />
            </label>
            <Segmented
              label="Type"
              options={[
                { value: "all", label: "Tous" },
                { value: "clip", label: "Clips" },
                { value: "full", label: "Parties complètes" },
              ]}
              value={kind}
              onChange={setKind}
            />
            <select className="select" value={champ} onChange={(e) => setChamp(e.target.value)} aria-label="Champion">
              <option value="">Champion</option>
              {champions.map((c) => (
                <option key={c} value={c}>
                  {championName(c)}
                </option>
              ))}
            </select>
            <button className="btn btn-sm" aria-pressed={onlyFav} onClick={() => setOnlyFav((v) => !v)} aria-label="Favoris uniquement">
              <Star fill={onlyFav ? "currentColor" : "none"} style={onlyFav ? { color: "var(--gold)" } : undefined} />
            </button>
            <span className="spacer" />
            <span className="muted num" style={{ fontSize: "var(--fs-xs)" }}>
              {filtered.length} vidéo{filtered.length > 1 ? "s" : ""}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="card">
              <EmptyState icon={<Film />} title={list.length ? "Aucune vidéo pour ces filtres" : "Aucun enregistrement"}>
                {list.length
                  ? "Modifie les filtres."
                  : "Active le mode Capture : NEX enregistre automatiquement tes parties dans un tampon et sauvegarde tes meilleures actions (et Ctrl+Alt+R à tout moment)."}
              </EmptyState>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.label} className="rec-group">
                <h2>
                  {g.label} <span className="muted">{g.items.length}</span>
                </h2>
                <div className="rec-grid">
                  {g.items.map((r) => (
                    <RecordingCard key={r.id} r={r} onOpen={() => setOpen(r)} />
                  ))}
                </div>
              </section>
            ))
          )}
          {filtered.length > shown && (
            <button className="btn" style={{ display: "block", margin: "12px auto" }} onClick={() => setShown((n) => n + PAGE)}>
              Afficher {Math.min(PAGE, filtered.length - shown)} vidéos de plus
            </button>
          )}
        </>
      )}
      {open && <Player rec={open} onClose={() => setOpen(null)} onChanged={(r) => (r ? setOpen(r) : setOpen(null))} />}
    </div>
  );
}

function RecordingCard({ r, onOpen }: { r: Recording; onOpen: () => void }) {
  const version = useDDragonVersion();
  return (
    <button className="rec-card" onClick={onOpen} aria-label={`Lire ${r.title}`}>
      <span className="rec-thumb">
        {r.thumb ? <img src={platform.assetUrl(r.thumb)} alt="" loading="lazy" decoding="async" /> : <span className="img-fallback">NEX</span>}
        <span className="time-badge num">{duration(r.durationMs / 1000)}</span>
        <span className="rec-ago">{timeAgo(r.createdAt)}</span>
        {!r.complete && <span className="rec-warn">Incomplet</span>}
      </span>
      <span className="rec-meta">
        {r.championKey ? <ChampIcon version={version} champion={r.championKey} size={24} rounded={12} /> : <Film size={18} className="muted" />}
        <span>
          <strong>
            {r.favorite && <Star size={11} fill="currentColor" style={{ color: "var(--gold)", marginRight: 4 }} />}
            {r.title}
          </strong>
          <span className="muted">
            {[r.kda && `${r.kda} KDA`, r.kind === "full" ? "Partie complète" : "Clip", r.gameMode].filter(Boolean).join(" · ")}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Lecteur unique, charge a la demande (aucune lecture automatique dans la grille). */
function Player({ rec, onClose, onChanged }: { rec: Recording; onClose: () => void; onChanged: (r: Recording | null) => void }) {
  const { notify } = useAppState();
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => {
      // Libere le decodeur video avant de fermer.
      if (video.current) {
        video.current.pause();
        video.current.removeAttribute("src");
        video.current.load();
      }
      prev?.focus?.();
    };
  }, []);
  const seek = (ms: number) => {
    if (video.current) {
      video.current.currentTime = ms / 1000;
      void video.current.play();
    }
  };
  const run = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };
  return (
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="player" role="dialog" aria-modal="true" aria-label={rec.title} tabIndex={-1} ref={dialog} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <video ref={video} src={platform.assetUrl(rec.path)} controls autoPlay preload="metadata" />
        {rec.markers.length > 0 && (
          <div className="markers" aria-label="Événements">
            <div className="marker-bar">
              {rec.markers.map((m, i) => (
                <button
                  key={i}
                  className={`marker ${m.kind}`}
                  style={{ left: `${(m.tMs / Math.max(1, rec.durationMs)) * 100}%` }}
                  title={`${duration(m.tMs / 1000)} · ${m.label}`}
                  aria-label={`Aller à ${duration(m.tMs / 1000)} : ${m.label}`}
                  onClick={() => seek(m.tMs)}
                />
              ))}
            </div>
            <div className="marker-list">
              {rec.markers.map((m, i) => (
                <button key={i} className="chip" onClick={() => seek(m.tMs)}>
                  <span className="num">{duration(m.tMs / 1000)}</span> {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="player-bar">
          <div>
            <strong>{rec.title}</strong>
            <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {new Date(rec.createdAt).toLocaleString("fr-FR")} · {duration(rec.durationMs / 1000)} · {(rec.sizeBytes / 1024 ** 2).toFixed(0)} Mio
              {!rec.complete && " · fichier récupéré après une interruption"}
            </div>
          </div>
          <span className="spacer" />
          <button className="btn btn-sm" aria-pressed={rec.favorite} onClick={() => run(platform.recordingSetFavorite(rec.id, !rec.favorite).then(onChanged))}>
            <Star fill={rec.favorite ? "currentColor" : "none"} style={rec.favorite ? { color: "var(--gold)" } : undefined} /> Favori
          </button>
          <button className="btn btn-sm" onClick={() => run(platform.recordingReveal(rec.id))}>
            <FolderOpen /> Exporter (Explorateur)
          </button>
          {confirm ? (
            <>
              <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                Mettre à la Corbeille Windows ?
              </span>
              <button className="btn btn-sm" style={{ borderColor: "var(--red)" }} onClick={() => run(platform.recordingDelete(rec.id).then(() => onChanged(null)))}>
                Confirmer
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
                Annuler
              </button>
            </>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>
              <Trash /> Supprimer
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Fermer (Échap)">
            <X />
          </button>
        </div>
      </div>
    </div>
  );
}

function CapturePanel({ status, onStatus }: { status: CaptureStatus | null; onStatus: (s: CaptureStatus) => void }) {
  const { settings, setSetting, notify } = useAppState();
  const client = useClient();
  const [sources, setSources] = useState<string[]>([]);
  const [source, setSource] = useState("game");
  const captureMode = !settings.ecoMode;
  const run = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };
  const hw = status?.encoders ?? [];
  return (
    <section className={`card card-pad capture-panel ${status?.active ? "live" : ""}`}>
      <div className="capture-row">
        <Segmented
          size="md"
          label="Mode"
          options={[
            { value: "eco", label: "Eco" },
            { value: "capture", label: "Capture" },
          ]}
          value={captureMode ? "capture" : "eco"}
          onChange={(v) => setSetting("ecoMode", v === "eco")}
        />
        <p className="muted capture-help">
          {captureMode
            ? "Capture activée : NEX enregistre la fenêtre du jeu pendant tes parties (tampon de replay, clips automatiques)."
            : "Mode Eco : aucune capture, aucun tampon. Active « Capture » pour enregistrer tes parties."}
        </p>
        <span className="spacer" />
        {status?.active ? (
          <span className="rec-live">
            <Circle size={10} fill="currentColor" /> REC
          </span>
        ) : status?.finalizing ? (
          <span className="muted">Finalisation…</span>
        ) : null}
      </div>

      {status?.active ? (
        <div className="capture-row">
          <span className="num capture-stats">
            {status.source} · {status.width}×{status.height} à {status.fps} i/s · tampon {status.bufferedSeconds} s / {status.bufferedMib} Mio
            {status.keepAll && " · partie complète"} · {status.framesSent} images{status.framesDropped ? `, ${status.framesDropped} abandonnées` : ""}
          </span>
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={() => run(platform.captureSaveClip(settings.replaySeconds).then((r) => notify(`Clip sauvegardé : ${r.title}`, "success")))}>
            Sauvegarder le replay ({settings.replaySeconds} s) · Ctrl+Alt+R
          </button>
          <button className="btn btn-sm" onClick={() => run(platform.captureStop())}>
            <Square /> Arrêter
          </button>
        </div>
      ) : (
        captureMode && (
          <div className="capture-row">
            <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              {client.state?.stage === "in_game" ? "Partie en cours : la capture démarre automatiquement." : "La capture démarrera au début de ta prochaine partie."} Ou maintenant :
            </span>
            <select
              className="select"
              value={source}
              onFocus={() => platform.captureSources().then(setSources).catch(() => {})}
              onChange={(e) => setSource(e.target.value)}
              aria-label="Source de capture"
            >
              <option value="game">Fenêtre du jeu</option>
              <option value="monitor">Écran principal</option>
              {sources.map((s) => (
                <option key={s} value={`window:${s}`}>
                  {s.length > 50 ? `${s.slice(0, 50)}…` : s}
                </option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={() => run(platform.captureStart(source, settings.recordFullGames).then(onStatus))}>
              <Circle /> Démarrer maintenant
            </button>
          </div>
        )
      )}

      <div className="capture-options">
        <label className="check">
          <input type="checkbox" checked={settings.recordFullGames} onChange={(e) => setSetting("recordFullGames", e.target.checked)} /> Enregistrer les parties complètes
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.autoClips} onChange={(e) => setSetting("autoClips", e.target.checked)} /> Clips automatiques (multikills, aces, vols)
        </label>
        <label className="field">
          <span>Tampon de replay</span>
          <select className="select" value={settings.replaySeconds} onChange={(e) => setSetting("replaySeconds", Number(e.target.value))}>
            {[30, 60, 120, 300].map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Taille max du tampon</span>
          <select className="select" value={settings.replayMaxMib} onChange={(e) => setSetting("replayMaxMib", Number(e.target.value))}>
            {[256, 512, 1024, 2048].map((s) => (
              <option key={s} value={s}>
                {s} Mio
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Quota du dossier</span>
          <select className="select" value={settings.storageQuotaGib} onChange={(e) => setSetting("storageQuotaGib", Number(e.target.value))}>
            {[10, 20, 50, 100, 200].map((s) => (
              <option key={s} value={s}>
                {s} Gio
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted capture-foot">
        Encodeur : {hw.length ? `H.264 matériel (${[...new Set(hw)].join(", ")})` : "aucun encodeur matériel détecté — la capture reste désactivée"} · 30 i/s à la
        résolution de la fenêtre · son : non capturé pour l'instant, micro désactivé · dossier : Vidéos\NEX
        {status?.error && <span className="neg"> · {status.error}</span>}
      </p>
    </section>
  );
}
