import { useEffect, useState } from "react";
import type { RecentProject } from "../../lib/recents";

/** Delete confirm (design: 452px). Deliberately spells out that this is NOT
 *  the same as removing the card from recents — that's the one thing the
 *  design insists must never blur.
 *
 *  The destructive action itself is not wired: moving a project to the trash
 *  is a filesystem command cradle's backend doesn't expose, and shipping an
 *  unverified delete path would be worse than shipping none. The dialog is
 *  built so the wiring is a one-line change when that command exists.
 */
export function DeleteProjectDialog({
  recent,
  onCancel,
  onRemoveInstead,
}: {
  recent: RecentProject;
  onCancel: () => void;
  onRemoveInstead: () => void;
}) {
  const [alsoAssets, setAlsoAssets] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal delete-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Delete this project?</h3>
        <p className="note">
          <code>{recent.path}</code> would be moved to the trash. This is not the
          same as removing it from recents — removing only hides the card and
          leaves everything on disk.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={alsoAssets}
            onChange={(e) => setAlsoAssets(e.target.checked)}
          />
          <span>
            Also delete generated art, music and SFX (placeholders and shared
            library sets are kept)
          </span>
        </label>
        <p className="note dim">
          Moving a project to the trash isn't wired up yet — cradle has no
          backend command that touches your filesystem outside a pack. Remove it
          from recents instead, or delete the folder yourself.
        </p>
        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" onClick={onRemoveInstead}>
            Remove from recents instead
          </button>
          <button
            className="btn dang"
            disabled
            title="No backend command moves a project to the trash yet."
          >
            Move to trash
          </button>
        </div>
      </div>
    </div>
  );
}
