import { useEffect, useState } from "react";
import { api, type MusicSection, type MusicTrack } from "../../lib/invoke";
import type { LevelBundle } from "./drawLevel";
import { AudioPlayer } from "../AudioPlayer";
import { fmtUsd } from "../../lib/cost";
import { enqueueJob } from "../../lib/jobs";
import { PromptOverride } from "../PromptOverride";

/** Flat Lyria per-track price for the pre-run gate (matches cost_model's
 *  music_usd_per_track). The RECORDED spend is the op's real returned cost. */
const MUSIC_TRACK_USD = 0.1;

type Backend = "fake" | "lyria";

/** Set / generate the music for a level (and its secret rooms — they're
 *  Levels), plus author user MUSIC SECTIONS. Assign repoints to an existing
 *  track (free); Generate rerolls a fresh Lyria track (paid, cost-tracked).
 *  The play surfaces resolve section → level track → stage default by position. */
export function MusicPanel({
  worldPath,
  levelId,
  bundle,
  onClose,
  onDone,
}: {
  worldPath: string;
  levelId: string;
  bundle: LevelBundle;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [backend, setBackend] = useState<Backend>("fake");
  const [brief, setBrief] = useState(bundle.brief ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  // Local, editable copy of the level's sections (persisted via Save sections).
  const [sections, setSections] = useState<MusicSection[]>(
    (bundle.music_sections ?? []).map((s) => ({ ...s })),
  );

  useEffect(() => {
    let live = true;
    api
      .listMusicTracks(worldPath)
      .then((r) => live && setTracks(r.tracks))
      .catch(() => live && setTracks([]));
    return () => {
      live = false;
    };
  }, [worldPath]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(String(e).slice(0, 300));
    } finally {
      setBusy(null);
    }
  };

  // Assign the level's default track (or a section's) to an existing file.
  const assignLevel = (path: string) =>
    guard("assign", async () => {
      await api.saveLevelEdit(worldPath, levelId, { music_path: path, music_hash: "" });
      onDone(path ? `assigned ${path.split("/").pop()}` : "cleared → stage default");
    });

  const generate = (section: number | null) =>
    guard("generate", async () => {
      const paid = backend === "lyria";
      const est = paid ? `~${fmtUsd(MUSIC_TRACK_USD)} (Lyria)` : "$0 (fake)";
      const where = section == null ? "this level" : `section ${section + 1}`;
      if (
        !window.confirm(
          `Generate music for ${where} — ${est}.\n\n` +
            (paid ? "Lyria needs GOOGLE_API_KEY via CANON_ENV_FILE. " : "") +
            "Proceed?",
        )
      )
        return;
      // Fire-and-forget background job — the tray tracks it; the level reloads
      // on completion.
      await enqueueJob(
        {
          op: "music",
          label: `Music · ${levelId}${section == null ? "" : ` §${section + 1}`}`,
          target: levelId,
          targetType: "levels",
          scope: section == null ? "level" : "section",
          backends: { music: backend },
          estimate: { best: paid ? MUSIC_TRACK_USD : 0, worst: paid ? MUSIC_TRACK_USD : 0 },
        },
        (jobId) =>
          api.generateLevelMusic(worldPath, levelId, {
            brief,
            section,
            musicBackend: backend,
            promptOverride,
            jobId,
          }),
      );
      onDone(`music queued for ${where} — watch ⚙ Jobs`);
    });

  const saveSections = () =>
    guard("sections", async () => {
      // Drop empty/degenerate rows; canon re-validates on write.
      const clean = sections
        .filter((s) => Number(s.end) > Number(s.start))
        .map((s) => ({
          start: Number(s.start),
          end: Number(s.end),
          music_path: s.music_path ?? "",
          music_hash: s.music_hash ?? "",
          name: s.name ?? "",
        }));
      await api.saveLevelEdit(worldPath, levelId, { music_sections: clean });
      onDone(`saved ${clean.length} music section(s)`);
    });

  const axis = "cells"; // start/end are cells along the level's layout axis
  const levelTrack = bundle.music_path || "";
  const stageTrack = bundle.stage_music || "";

  const overlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(8,6,12,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  };
  const card: React.CSSProperties = {
    width: 520,
    maxWidth: "92vw",
    maxHeight: "88vh",
    overflowY: "auto",
    background: "var(--bg-raised)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 20,
    color: "var(--fg)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
  };
  const h4: React.CSSProperties = { margin: "16px 0 6px", fontSize: 13, opacity: 0.85 };
  const sm: React.CSSProperties = { fontSize: 11, opacity: 0.7 };

  return (
    <div style={overlay} onClick={() => !busy && onClose()}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 2px" }}>🎵 Music — {bundle.display_name ?? levelId}</h3>
        <p style={sm}>
          Resolves by position: an active section → this level's track → the stage default. Assign
          an existing track (free) or generate a new one (Lyria, paid).
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
          <label style={sm}>Backend</label>
          <select
            value={backend}
            onChange={(e) => setBackend(e.target.value as Backend)}
            disabled={!!busy}
          >
            <option value="fake">fake ($0)</option>
            <option value="lyria">Lyria (paid)</option>
          </select>
          <input
            placeholder="music brief (optional)"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            disabled={!!busy}
            style={{ flex: 1, fontSize: 12 }}
          />
        </div>
        <PromptOverride
          worldPath={worldPath}
          kind="music"
          ctx={{ levelId, brief }}
          value={promptOverride}
          onChange={setPromptOverride}
          disabled={!!busy}
        />

        <h4 style={h4}>Level track</h4>
        <div style={{ fontSize: 12, marginBottom: 4 }}>
          {levelTrack
            ? `own: ${levelTrack.split("/").slice(-2).join("/")}`
            : stageTrack
              ? `stage default: ${stageTrack.split("/").slice(-2).join("/")}`
              : "no music"}
        </div>
        {(levelTrack || stageTrack) && (
          <AudioPlayer hint={levelTrack || stageTrack} name="level" kind="music" />
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <select
            value={levelTrack}
            onChange={(e) => void assignLevel(e.target.value)}
            disabled={!!busy}
            title="Assign an existing track to this level"
          >
            <option value="">— stage default —</option>
            {tracks.map((t) => (
              <option key={t.path} value={t.path}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void generate(null)}
            disabled={!!busy}
            style={{ cursor: "pointer" }}
          >
            {busy === "generate" ? "Generating…" : "🎲 Generate track"}
          </button>
        </div>

        <h4 style={h4}>Music sections ({axis} along the level)</h4>
        {sections.length === 0 && (
          <div style={sm}>none — add a region to change music mid-level.</div>
        )}
        {sections.map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              margin: "6px 0",
              flexWrap: "wrap",
            }}
          >
            <input
              type="number"
              value={s.start}
              disabled={!!busy}
              style={{ width: 60, fontSize: 12 }}
              onChange={(e) =>
                setSections((xs) =>
                  xs.map((x, j) => (j === i ? { ...x, start: Number(e.target.value) } : x)),
                )
              }
            />
            <span style={sm}>→</span>
            <input
              type="number"
              value={s.end}
              disabled={!!busy}
              style={{ width: 60, fontSize: 12 }}
              onChange={(e) =>
                setSections((xs) =>
                  xs.map((x, j) => (j === i ? { ...x, end: Number(e.target.value) } : x)),
                )
              }
            />
            <input
              placeholder="name"
              value={s.name ?? ""}
              disabled={!!busy}
              style={{ width: 90, fontSize: 12 }}
              onChange={(e) =>
                setSections((xs) =>
                  xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                )
              }
            />
            <select
              value={s.music_path ?? ""}
              disabled={!!busy}
              style={{ fontSize: 11, maxWidth: 130 }}
              onChange={(e) =>
                setSections((xs) =>
                  xs.map((x, j) => (j === i ? { ...x, music_path: e.target.value } : x)),
                )
              }
            >
              <option value="">— silence —</option>
              {tracks.map((t) => (
                <option key={t.path} value={t.path}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => void generate(i)}
              disabled={!!busy}
              title="Generate a track for this section"
              style={{ cursor: "pointer", fontSize: 11 }}
            >
              🎲
            </button>
            <button
              onClick={() => setSections((xs) => xs.filter((_, j) => j !== i))}
              disabled={!!busy}
              style={{ cursor: "pointer", fontSize: 11 }}
            >
              ✕
            </button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={() =>
              setSections((xs) => [
                ...xs,
                { start: 0, end: Math.min(20, bundle.grid_width), music_path: "", name: "" },
              ])
            }
            disabled={!!busy}
            style={{ cursor: "pointer", fontSize: 12 }}
          >
            ＋ Add section
          </button>
          <button
            onClick={() => void saveSections()}
            disabled={!!busy}
            style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >
            {busy === "sections" ? "Saving…" : "Save sections"}
          </button>
          <span style={sm}>
            generate a section's track AFTER saving (it keys on the saved index)
          </span>
        </div>

        {err && (
          <div style={{ color: "var(--err)", fontSize: 12, marginTop: 10, whiteSpace: "pre-wrap" }}>
            {err}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} disabled={!!busy} style={{ cursor: "pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
