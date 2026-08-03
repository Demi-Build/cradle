import { useState } from "react";
import { api, type PromptKind, type PromptPreview } from "../lib/invoke";

/** "✎ Edit prompt (advanced)" — the reusable expander every paid gate carries.
 *
 *  Collapsed it costs nothing and sends nothing (the generator uses its
 *  built-in prompt, byte-for-byte). Expanding fetches the DEFAULT prompt from
 *  canon (`canon prompt show` — a pure read: no LLM call, no cost, no journal)
 *  and drops it into an editable textarea. Edits apply to THAT ONE call.
 *
 *  For LLM generators the editable part is the SYSTEM prompt — the standing
 *  "how to build" instructions (DSL vocab, physics, rules). The user message is
 *  rebuilt per call from live data, so it is shown read-only as context.
 *  Image/audio generators have no such split: their single prompt is editable.
 *
 *  The parent owns the value (`value`/`onChange`) so it can send it with the op;
 *  `null` means "no override".
 */
export function PromptOverride({
  worldPath,
  kind,
  ctx,
  value,
  onChange,
  disabled,
  label = "✎ Edit prompt (advanced)",
}: {
  worldPath: string;
  kind: PromptKind;
  /** Context so the preview is the prompt that will ACTUALLY run. */
  ctx?: { levelId?: string; target?: string; instruction?: string; brief?: string };
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** Override the toggle text where one gate hosts several generators. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PromptPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const p = await api.previewPrompt(worldPath, kind, {
        levelId: ctx?.levelId ?? null,
        target: ctx?.target ?? null,
        instruction: ctx?.instruction ?? null,
        brief: ctx?.brief ?? null,
      });
      setPreview(p);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !preview) void load();
  };

  // The default text for this kind: system for LLM gens, the single prompt
  // otherwise. What "Reset to default" restores, and what edits start from.
  const defaultText = preview?.mode === "llm" ? (preview.system ?? "") : (preview?.prompt ?? "");
  const edited = value !== null;

  return (
    <div style={{ margin: "8px 0", fontSize: 12 }}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        style={{
          cursor: "pointer",
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "inherit",
          opacity: 0.85,
        }}
      >
        {open ? "▾" : "▸"} {label}
        {edited && (
          <span style={{ marginLeft: 6, color: "var(--accent)", fontWeight: 600 }}>· edited</span>
        )}
      </button>

      {open && (
        <div
          style={{
            marginTop: 6,
            padding: 8,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "rgba(0,0,0,0.15)",
          }}
        >
          {loading && <div style={{ opacity: 0.7 }}>Loading the default prompt…</div>}
          {err && (
            <div style={{ color: "var(--err)", whiteSpace: "pre-wrap" }}>{err}</div>
          )}
          {preview && (
            <>
              <div style={{ opacity: 0.7, marginBottom: 6, lineHeight: 1.4 }}>
                {preview.mode === "llm"
                  ? `Editing the SYSTEM prompt for ${preview.label} — the standing instructions. Applies to this run only.`
                  : `Editing the ${preview.mode} prompt for ${preview.label}. Applies to this run only.`}
              </div>
              <textarea
                value={value ?? defaultText}
                onChange={(e) => onChange(e.target.value)}
                rows={10}
                disabled={disabled}
                spellCheck={false}
                style={{
                  width: "100%",
                  fontSize: 11,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  resize: "vertical",
                  boxSizing: "border-box",
                  lineHeight: 1.45,
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  disabled={disabled || !edited}
                  style={{ cursor: edited ? "pointer" : "default" }}
                >
                  Reset to default
                </button>
                <span style={{ opacity: 0.6 }}>
                  {edited ? "this run uses your edited prompt" : "using the built-in default"}
                </span>
              </div>
              {preview.mode === "llm" && preview.user_message && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", opacity: 0.75 }}>
                    Task message (rebuilt each call — read-only)
                  </summary>
                  <pre
                    style={{
                      margin: "6px 0 0",
                      padding: 8,
                      maxHeight: 180,
                      overflow: "auto",
                      fontSize: 10.5,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                      opacity: 0.8,
                      background: "rgba(0,0,0,0.2)",
                      borderRadius: 6,
                    }}
                  >
                    {preview.user_message}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
