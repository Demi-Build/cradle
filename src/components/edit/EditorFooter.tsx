import { useStore, entityKey } from "../../store";

type Props = {
  typeId: string;
  entityId: string;
  // When set, blocks Save (e.g. JSON parse error in Raw JSON tab).
  saveDisabledReason?: string | null;
};

export function EditorFooter({ typeId, entityId, saveDisabledReason }: Props) {
  const key = entityKey(typeId, entityId);
  const dirty = useStore((s) => !!s.entityCache[key]?.dirty);
  const saving = useStore((s) => !!s.saving[key]);
  const saveError = useStore((s) => s.saveError[key] ?? null);
  const saveEntity = useStore((s) => s.saveEntity);
  const revertEntity = useStore((s) => s.revertEntity);

  const onSave = () => {
    void saveEntity(typeId, entityId).catch(() => {
      // Error state is already in saveError; swallow to avoid an unhandled rejection.
    });
  };

  const saveBlocked = !!saveDisabledReason || !dirty || saving;

  return (
    <div className="editor-footer">
      {saveError && <div className="editor-error">{saveError}</div>}
      {saveDisabledReason && !saveError && <div className="editor-error">{saveDisabledReason}</div>}
      <div className="editor-footer-row">
        <span className={`editor-dirty-indicator ${dirty ? "is-dirty" : ""}`}>
          {dirty ? "Unsaved changes" : "Saved"}
        </span>
        <div className="editor-footer-actions">
          <button
            type="button"
            className="editor-btn editor-btn-revert"
            onClick={() => revertEntity(typeId, entityId)}
            disabled={!dirty || saving}
          >
            Revert
          </button>
          <button
            type="button"
            className="editor-btn editor-btn-save"
            onClick={onSave}
            disabled={saveBlocked}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
