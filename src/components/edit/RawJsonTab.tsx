import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";

type Props = {
  typeId: string;
  entityId: string;
  data: unknown;
  editMode: boolean;
  onParseError: (msg: string | null) => void;
};

export function RawJsonTab({ typeId, entityId, data, editMode, onParseError }: Props) {
  const setEntityDraft = useStore((s) => s.setEntityDraft);
  // Local controlled text so users can type half-valid JSON without the cache
  // flickering between parses. The cache only updates on a successful parse.
  const [text, setText] = useState(() => JSON.stringify(data, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  // Lets us detect when an out-of-band revert/save flips the cache and resync
  // the textarea, without clobbering in-flight typing.
  const lastSyncedRef = useRef<unknown>(data);

  useEffect(() => {
    if (data === lastSyncedRef.current) return;
    lastSyncedRef.current = data;
    setText(JSON.stringify(data, null, 2));
    setParseError(null);
    onParseError(null);
  }, [data, onParseError]);

  // Editing was just turned off (or this tab was unmounted) — clear any parse
  // error so the pane-level Save button isn't stuck disabled.
  useEffect(() => {
    if (editMode) return;
    if (parseError) {
      setParseError(null);
      onParseError(null);
    }
    // Also resync the textarea to the canonical draft, since the user can no
    // longer fix invalid JSON without re-entering edit mode.
    setText(JSON.stringify(data, null, 2));
    lastSyncedRef.current = data;
  }, [editMode, data, parseError, onParseError]);

  // Clear the parse error when this tab unmounts so the footer doesn't keep
  // blocking Save on a tab the user has navigated away from.
  useEffect(() => {
    return () => onParseError(null);
  }, [onParseError]);

  const onChange = (next: string) => {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      setParseError(null);
      onParseError(null);
      lastSyncedRef.current = parsed;
      setEntityDraft(typeId, entityId, parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setParseError(msg);
      onParseError(msg);
    }
  };

  const onFormat = () => {
    try {
      const parsed = JSON.parse(text);
      const pretty = JSON.stringify(parsed, null, 2);
      setText(pretty);
      setParseError(null);
      onParseError(null);
      lastSyncedRef.current = parsed;
      setEntityDraft(typeId, entityId, parsed);
    } catch {
      // Leave text alone; parseError already surfaces the issue.
    }
  };

  if (!editMode) {
    return <pre className="detail-json">{text}</pre>;
  }

  return (
    <div className="raw-json-editor">
      <div className="editor-toolbar">
        <button type="button" className="editor-btn-ghost" onClick={onFormat}>
          Format
        </button>
      </div>
      <textarea
        className={`editor-json-textarea ${parseError ? "has-error" : ""}`}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
