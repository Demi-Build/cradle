import type { LevelBundle } from "./drawLevel";

/** The audio lane — a spatial timeline of the level's music.
 *
 *  Music in this pack is SPATIAL, not temporal: a section is `[start, end)` in
 *  CELLS along the level's layout axis, and the track changes as the player
 *  advances. So the lane's horizontal axis is the level itself, aligned with
 *  the canvas above it, and a region's width is the stretch of level it covers.
 *
 *  Renders the `music_sections` model that already exists on `Level` — the
 *  Music panel writes it, this shows it. An empty `music_path` on a section is
 *  DELIBERATE SILENCE, not a missing value, and reads as such.
 */

/** Region colour rotates so neighbours stay distinguishable. */
const TONES = ["a", "b", "c"] as const;

function basename(p?: string): string {
  if (!p) return "";
  const n = p.split("/").pop() ?? p;
  return n.replace(/\.(mp3|wav|ogg|flac)$/i, "");
}

export function AudioLane({
  bundle,
  open,
  onOpenMusic,
}: {
  bundle: LevelBundle;
  open: boolean;
  onOpenMusic: () => void;
}) {
  // Sections run along the level's layout axis. The export bundle doesn't
  // carry the axis, so infer it the way the layout roll does — a level taller
  // than it is wide is a vertical climb.
  const vertical = bundle.grid_height > bundle.grid_width;
  const extent = vertical ? bundle.grid_height : bundle.grid_width;
  const sections = [...(bundle.music_sections ?? [])].sort((a, b) => a.start - b.start);
  const levelTrack = bundle.music_path?.trim();
  const stageTrack = bundle.stage_music?.trim();

  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / extent) * 100))}%`;
  const ticks: number[] = [];
  const step = extent > 60 ? 20 : extent > 30 ? 10 : 5;
  for (let x = 0; x <= extent; x += step) ticks.push(x);

  return (
    <div className="alane" data-open={open ? "1" : "0"}>
      <div className="alane-inner">
        <div className="alane-gut">
          <div className="alane-r">Audio</div>
          <div className="alane-r">Music</div>
        </div>
        <div className="alane-lanes">
          <div className="alane-scale">
            {ticks.map((t) => (
              <span key={t} style={{ left: pct(t) }}>
                {t}
              </span>
            ))}
          </div>
          <div className="alane-rail">
            {/* The base track under everything: the level's own, else the
                stage default. Sections override it where they cover. */}
            <div className="alane-base">
              {levelTrack
                ? `${basename(levelTrack)} · whole level`
                : stageTrack
                  ? `${basename(stageTrack)} · stage default`
                  : "no music assigned"}
            </div>
            {sections.map((s, i) => (
              <div
                key={`${s.start}-${s.end}-${i}`}
                className={`rgn ${TONES[i % TONES.length]}`}
                style={{ left: pct(s.start), width: pct(s.end - s.start) }}
                title={`cells ${s.start}–${s.end}`}
                onClick={onOpenMusic}
              >
                <b>{s.name || basename(s.music_path) || "silence"}</b>
                <i>
                  {s.music_path?.trim() ? `${s.start}–${s.end}` : `${s.start}–${s.end} · silent`}
                </i>
              </div>
            ))}
          </div>
        </div>
        <button className="btn alane-edit" onClick={onOpenMusic}>
          Edit music…
        </button>
      </div>
    </div>
  );
}
