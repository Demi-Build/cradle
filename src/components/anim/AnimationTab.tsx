import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type AnimationInfo, type AnimState } from "../../lib/invoke";
import { useStore } from "../../store";

/** The frame inspector: see why an animation looks wrong, and fix the parts
 *  that don't need regenerating.
 *
 *  Every frame is drawn at a large scale with its cell grid, its measured
 *  content box and the baseline on top — because "the character clips and half
 *  the frame vanishes in the jump" is invisible when you only watch it play,
 *  and obvious the moment you can see the box.
 *
 *  Offsets and timing are corrections layered on generation's output; frame
 *  GEOMETRY is not editable here. Both engines read the same fields, so a fix
 *  applied here shows up in pygame and Godot identically.
 */

/** The stage is for watching the motion; the strip is for comparing frames. */
const STAGE = 9;
const STRIP = 3;

export function AnimationTab({ target }: { target: string }) {
  const worldPath = useStore((s) => s.worldPath);
  const [info, setInfo] = useState<AnimationInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(true);
  /** Which frame the strip has selected, and whether a nudge applies to it
   *  alone. Lifted here so the pad and the strip agree. */
  const [sel, setSel] = useState(0);
  const [frameOnly, setFrameOnly] = useState(false);

  const load = async () => {
    try {
      const r = await api.animInspect(worldPath, target);
      setInfo(r.animation);
      setErr(null);
      setActive((cur) => cur ?? r.animation.states[0]?.state ?? null);
    } catch (e) {
      setErr(String(e).slice(0, 300));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldPath, target]);

  if (err) return <p className="anim-empty">{err}</p>;
  if (!info) return <p className="anim-empty">reading the animation…</p>;
  if (!info.states.length) {
    return (
      <p className="anim-empty">
        {info.label} has no animation yet — use <b>🎬 Generate animation</b> on the Overview tab.
      </p>
    );
  }

  const state = info.states.find((s) => s.state === active) ?? info.states[0];

  const edit = async (patch: Parameters<typeof api.animEdit>[3]) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.animEdit(worldPath, target, state.state, patch);
      setNote(
        r.frames_edit === "updated"
          ? `saved ${(r.fields ?? []).join(", ")} — both engines read this`
          : "no change",
      );
      await load();
    } catch (e) {
      setNote(String(e).slice(0, 220));
    } finally {
      setBusy(false);
    }
  };

  /** Nudge the whole state, or just the selected frame. Whole-state is the
   *  default because the usual defect is a pose seated wrong end to end;
   *  per-frame is there because the stored model is per-frame and one bad
   *  frame in an otherwise fine cycle does happen. */
  const nudge = (dx: number, dy: number) => {
    const cur = state.offsets ?? state.boxes.map(() => [0, 0] as [number, number]);
    void edit({
      offsets: cur.map(([x, y], i) =>
        frameOnly && i !== sel
          ? ([x, y] as [number, number])
          : ([x + dx, y + dy] as [number, number]),
      ),
    });
  };

  return (
    <div className="anim-tab">
      {info.independently_sized && (
        <div className="anim-warn">
          <b>{info.flush_states.length} states reach the cell edge.</b> With one shared frame square
          only the single largest pose can — so these were sized independently, and the actor
          changes size when its state changes. Offsets can re-seat a pose, but they can't un-bake
          its proportions: that needs re-generating on the current pipeline.
        </div>
      )}

      <div className="anim-states">
        {info.states.map((s) => (
          <button
            key={s.state}
            className={s.state === state.state ? "anim-state on" : "anim-state"}
            onClick={() => {
              setActive(s.state);
              setNote(null);
            }}
          >
            <span>{s.state}</span>
            <i>
              {s.frames}f · {s.loop}
              {s.flush ? " · edge" : ""}
              {s.offsets ? " · nudged" : ""}
            </i>
          </button>
        ))}
      </div>

      <div className="anim-meta">
        <span>
          cell{" "}
          <b>
            {state.frame_width}×{state.frame_height}
          </b>
        </span>
        <span>
          content{" "}
          <b>
            {state.widest}×{state.tallest}
          </b>
        </span>
        <span title="How much the feet move between frames of this state — bobbing when it should be planted">
          foot wander <b>{state.foot_wander}px</b>
        </span>
        {state.flush && <span className="warn">touches the cell edge</span>}
      </div>

      <FrameStage
        state={state}
        playing={playing}
        onPlaying={setPlaying}
        frame={sel}
        onFrame={setSel}
      />

      <div className="anim-controls">
        <div className="anim-nudge">
          <span className="dock-sect">Position in frame</span>
          <p className="note">
            Move the art within its frame — for a pose that sits too high, too low, or off-centre.
            Saved with the animation, so pygame and Godot both pick it up.
          </p>
          <div className="anim-pad">
            <button className="btn" disabled={busy} onClick={() => nudge(0, -1)}>
              ↑
            </button>
            <div>
              <button className="btn" disabled={busy} onClick={() => nudge(-1, 0)}>
                ←
              </button>
              <button className="btn" disabled={busy} onClick={() => nudge(1, 0)}>
                →
              </button>
            </div>
            <button className="btn" disabled={busy} onClick={() => nudge(0, 1)}>
              ↓
            </button>
          </div>
          <label className="anim-play">
            <input
              type="checkbox"
              checked={frameOnly}
              onChange={(e) => setFrameOnly(e.target.checked)}
            />
            frame {sel + 1} only
          </label>
          <div className="anim-offset-now">
            {state.offsets
              ? frameOnly
                ? `frame ${sel + 1}: ${state.offsets[sel]?.[0] ?? 0}, ${state.offsets[sel]?.[1] ?? 0}`
                : `offset ${state.offsets[0][0]}, ${state.offsets[0][1]}${
                    state.offsets.some(
                      ([x, y]) => x !== state.offsets![0][0] || y !== state.offsets![0][1],
                    )
                      ? " (varies per frame)"
                      : ""
                  }`
              : "no offset — as generated"}
          </div>
          <button
            className="btn"
            disabled={busy || !state.offsets}
            onClick={() => void edit({ offsets: null })}
          >
            Reset to generated
          </button>
        </div>

        <div className="anim-timing">
          <span className="dock-sect">Timing</span>
          <label className="wm-field">
            <span>Loop</span>
            <select
              value={state.loop}
              disabled={busy}
              onChange={(e) => void edit({ loop: e.target.value })}
            >
              {["loop", "once", "ping_pong"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="wm-field">
            <span>Every frame</span>
            <input
              type="number"
              min={10}
              step={10}
              defaultValue={state.durations_ms[0]}
              disabled={busy}
              onBlur={(e) => {
                const ms = Number(e.target.value);
                if (ms > 0 && ms !== state.durations_ms[0]) {
                  void edit({ durations_ms: state.durations_ms.map(() => ms) });
                }
              }}
            />
            <span className="anim-unit">ms</span>
          </label>
          <p className="note">
            Total {state.durations_ms.reduce((a, b) => a + b, 0)}ms
            {state.loop === "once" ? " then holds" : " per cycle"}.
          </p>
        </div>
      </div>

      {note && <div className="anim-note">{note}</div>}
    </div>
  );
}

/** One frame, drawn at `zoom`× with optional overlays.
 *
 *  Shared by the stage and the filmstrip so the two can never disagree about
 *  where a frame sits — the stage is just this at a bigger scale.
 */
function Frame({
  state,
  index,
  zoom,
  src,
  grid = true,
  box = true,
}: {
  state: AnimState;
  index: number;
  zoom: number;
  src: string | null;
  grid?: boolean;
  box?: boolean;
}) {
  const fw = state.frame_width;
  const fh = state.frame_height;
  const off = state.offsets?.[index] ?? [0, 0];
  const b = state.boxes[index]?.box ?? null;
  return (
    <>
      {src && (
        <span
          className="anim-img"
          style={{
            backgroundImage: `url(${src})`,
            backgroundSize: `${fw * state.frames * zoom}px ${fh * zoom}px`,
            backgroundPosition: `${-index * fw * zoom + off[0] * zoom}px ${off[1] * zoom}px`,
          }}
        />
      )}
      {grid && <span className="anim-grid" style={{ backgroundSize: `${zoom}px ${zoom}px` }} />}
      {/* Where the actor's feet are meant to land — the reference every
          seating judgement is made against. */}
      <span className="anim-baseline" />
      {box && b && (
        <span
          className="anim-box"
          style={{
            left: (b.x + off[0]) * zoom,
            top: (b.y + off[1]) * zoom,
            width: b.w * zoom,
            height: b.h * zoom,
          }}
        />
      )}
    </>
  );
}

/** The stage — one frame, big, actually playing — over a filmstrip of every
 *  frame with the playhead marked.
 *
 *  Watching a highlight crawl along a row of frames is not the same as seeing
 *  the animation: your eye follows the highlight instead of the motion. So the
 *  motion gets its own space, and the strip goes back to being what it is good
 *  at — scrubbing and comparing frames side by side.
 */
function FrameStage({
  state,
  playing,
  onPlaying,
  frame,
  onFrame,
}: {
  state: AnimState;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  frame: number;
  onFrame: (i: number) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [overlays, setOverlays] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const abs = state.path_abs;
    if (!abs) {
      setSrc(null);
      return;
    }
    const url = abs.startsWith("/__mockassets__") ? abs : convertFileSrc(abs);
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.onerror = () => setLoaded(false);
    img.src = url;
    setSrc(url);
  }, [state.path_abs]);

  // Plays on the state's OWN per-frame timing, so what you watch here is what
  // the game will play — not a uniform preview tempo.
  useEffect(() => {
    if (!playing || state.frames < 2) return;
    const ms = state.durations_ms[frame] ?? 120;
    const t = window.setTimeout(() => {
      const next = frame + 1;
      if (next >= state.frames) {
        if (state.loop === "once") onPlaying(false);
        else onFrame(0);
      } else {
        onFrame(next);
      }
    }, ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, frame, state]);

  useEffect(() => {
    onFrame(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.state]);

  const step = (d: number) => {
    onPlaying(false);
    onFrame((frame + d + state.frames) % state.frames);
  };

  return (
    <div className="anim-viewer">
      <div className="anim-stage-col">
        <div
          className="anim-stage"
          style={{ width: state.frame_width * STAGE, height: state.frame_height * STAGE }}
        >
          {loaded && (
            <Frame
              state={state}
              index={frame}
              zoom={STAGE}
              src={src}
              grid={overlays}
              box={overlays}
            />
          )}
          {!loaded && <span className="anim-loading">loading…</span>}
        </div>
        <div className="anim-transport">
          <button className="btn" onClick={() => step(-1)} title="Previous frame">
            ‹
          </button>
          <button
            className={playing ? "btn pri" : "btn"}
            onClick={() => {
              // Replaying a `once` state from its end should start over, not
              // sit on the last frame doing nothing.
              if (!playing && state.loop === "once" && frame >= state.frames - 1) onFrame(0);
              onPlaying(!playing);
            }}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button className="btn" onClick={() => step(1)} title="Next frame">
            ›
          </button>
          <span className="anim-count">
            frame {frame + 1}/{state.frames} · {state.durations_ms[frame] ?? 120}ms
          </span>
          <span style={{ flex: 1 }} />
          <button
            className={overlays ? "chip on" : "chip"}
            onClick={() => setOverlays((v) => !v)}
            title="Show the pixel grid and the measured content box over the animation"
          >
            overlays
          </button>
        </div>
      </div>

      <div className="anim-film">
        <span className="dock-sect">Frames</span>
        <div className="anim-strip">
          {state.boxes.map((_, i) => (
            <button
              key={i}
              className={i === frame ? "anim-cell on" : "anim-cell"}
              onClick={() => {
                onPlaying(false);
                onFrame(i);
              }}
              style={{ width: state.frame_width * STRIP, height: state.frame_height * STRIP }}
              title={`frame ${i + 1}`}
            >
              {loaded && <Frame state={state} index={i} zoom={STRIP} src={src} />}
              <span className="anim-idx">{i + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
