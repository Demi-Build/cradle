import { useEffect, useState } from "react";
import { api, type EngineStatus } from "../lib/invoke";
import { useStore } from "../store";

/** "This pack's game runtime is out of date."
 *
 *  A pack's Godot code is COPIED into it when the world is generated, and the
 *  export phase only runs during a full pipeline run — so a pack keeps
 *  whatever engine code existed that day, and every engine fix shipped since
 *  is invisible to it. That is how the AtlasTexture render fix reached the
 *  template and no shipped pack, leaving every existing project mis-drawing
 *  animation frames in normal gameplay for a whole cycle.
 *
 *  Silent when the pack is current, which is the normal case — this only
 *  speaks up when there is something to do.
 */
export function EngineChip() {
  const worldPath = useStore((s) => s.worldPath);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const check = async () => {
    if (!worldPath) return;
    try {
      const r = await api.engineStatus(worldPath);
      setStatus(r.status);
    } catch {
      // A pack generated without the godot engine has no runtime to compare;
      // that is not a problem to report.
      setStatus(null);
    }
  };
  useEffect(() => {
    setNote(null);
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldPath]);

  // The CHIP hides once the pack is current — but the DIALOG must not vanish
  // underneath the person who just pressed the button. A successful sync makes
  // `current` true, and an early return here would unmount the modal mid-click,
  // leaving no confirmation and no way to see which files were refused. Same
  // family as the ResizeObserver that never attached: don't conditionally
  // unmount something that still has work to say.
  if (!status || !status.has_engine || (status.current && !open)) return null;

  const handEdited = status.modified.length > 0;
  const done = status.current;

  const sync = async (force: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.engineSync(worldPath, { force });
      const wrote = r.written ?? [];
      setNote(
        r.engine === "updated"
          ? `updated ${wrote.length} file${wrote.length === 1 ? "" : "s"}${
              r.refused.length ? ` · ${r.refused.length} kept` : ""
            }`
          : r.refused.length
            ? `nothing updated — ${r.refused.join(", ")} ${
                r.refused.length === 1 ? "was" : "were"
              } edited by hand`
            : "already up to date",
      );
      await check();
    } catch (e) {
      setNote(String(e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!done && (
        <button
          className="engine-chip"
          onClick={() => setOpen(true)}
          title="This project's game runtime is older than canon's — engine fixes since it was generated aren't in it"
        >
          ⚠ Engine outdated
        </button>
      )}

      {open && (
        <div className="modal-scrim" onClick={() => !busy && setOpen(false)}>
          <div className="modal engine-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{done ? "Game runtime updated" : "Update the game runtime?"}</h3>
            <p className="note">
              {done
                ? "This project now runs canon's current engine code. Relaunch any open play session to pick it up."
                : "The Godot code that plays this project was copied in when the world was generated, so it doesn't have engine fixes canon has shipped since. Only the runtime is replaced — your levels, art and audio are never touched."}
            </p>

            <div className="engine-files">
              {status.files.map((f) => (
                <div key={f.path} className="engine-file" data-state={f.state}>
                  <code>{f.path}</code>
                  <span>{f.state}</span>
                </div>
              ))}
            </div>

            {!status.stamped && !done && (
              <p className="note dim">
                This project predates runtime stamping, so cradle can't tell an
                old build from your own edits. If you've hand-edited{" "}
                <code>main.gd</code>, copy it somewhere first.
              </p>
            )}
            {handEdited && (
              <p className="note dim">
                {status.modified.join(", ")} differs from what canon wrote, so
                it looks hand-edited and will be left alone. Use “Overwrite my
                edits” only if you want canon's version back.
              </p>
            )}
            {note && <p className="note dim">{note}</p>}

            <div className="modal-foot">
              <button
                className={done ? "btn pri" : "btn"}
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                {done || note ? "Close" : "Not now"}
              </button>
              {handEdited && !done && (
                <button className="btn dang" onClick={() => void sync(true)} disabled={busy}>
                  Overwrite my edits
                </button>
              )}
              {!done && (
                <button className="btn pri" onClick={() => void sync(false)} disabled={busy}>
                  {busy ? "Updating…" : "Update runtime"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
