import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type AnimationInfo, type CostEstimate } from "../../lib/invoke";
import { fmtRange, fmtUsd } from "../../lib/cost";
import { PromptOverride } from "../PromptOverride";

/** The animate gate: pick the real backends + models, see what it will cost,
 *  then queue it.
 *
 *  Replaces a one-click button that hardcoded `fal`/`anthropic` and dropped 4
 *  of canon's 7 animate parameters. Modeled on `NewProjectModal` (the `sel()`
 *  selector helper + live estimate + cost box) and `StageAudioReroll`
 *  (estimate → confirm → `enqueueJob`).
 *
 *  Self-contained by design: it takes only `{worldPath, target}` and hands the
 *  caller an `AnimateOpts`, so the level-editor inspector can mount it later
 *  without touching EntityOverview.
 */

/** Only `fal` and `fake` implement canon's `ImageEditBackend`. The others draw
 *  a static sprite fine but have no `edit()`, so an animate run on them
 *  produces NOTHING while still billing the VLM for the motion spec. They are
 *  therefore not offered, and the UI says why. */
const EDIT_BACKENDS: [string, string][] = [
  ["fal", "fal · nano-banana (paid)"],
  ["fake", "placeholder ($0)"],
];
const VLM_BACKENDS: [string, string][] = [
  ["anthropic", "Claude (paid)"],
  ["fake", "canned ($0)"],
  ["none", "none — requires reuse spec"],
];

/** Canon's real defaults, shown as placeholders: blank means "canon decides",
 *  which keeps the call byte-identical to not passing the flag at all. */
const DEFAULT_IMAGE_MODEL = "fal-ai/nano-banana";
const DEFAULT_EDIT_MODEL = "fal-ai/nano-banana/edit";
const DEFAULT_VLM_MODEL = "claude-sonnet-4-6";

export type AnimateSubmit = {
  imageBackend: string;
  imageModel?: string;
  imageEditModel?: string;
  vlmBackend?: string;
  vlmModel?: string;
  reuseSpec: boolean;
  promptOverride: string | null;
  /** For the job meta + the key pre-flight. */
  backends: Record<string, string>;
  estimate: CostEstimate | null;
};

export function AnimateModal({
  worldPath,
  target,
  name,
  onClose,
  onSubmit,
}: {
  worldPath: string;
  target: string;
  /** Display name for the heading — falls back to the target. */
  name?: string;
  onClose: () => void;
  onSubmit: (opts: AnimateSubmit) => void | Promise<void>;
}) {
  const [imageBackend, setImageBackend] = useState("fal");
  const [imageModel, setImageModel] = useState("");
  const [editModel, setEditModel] = useState("");
  const [vlmBackend, setVlmBackend] = useState("anthropic");
  const [vlmModel, setVlmModel] = useState("");
  const [reuseSpec, setReuseSpec] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [est, setEst] = useState<CostEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  // What the run actually works FROM. Without this the dialog was backend
  // dropdowns and a bare prompt box — it never showed the sprite being edited
  // or what each state is supposed to mean.
  const [info, setInfo] = useState<AnimationInfo | null>(null);

  useEffect(() => {
    let live = true;
    api
      .animInspect(worldPath, target)
      .then((r) => live && setInfo(r.animation))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [worldPath, target]);

  const baseAbs = info?.base_sprite_abs ?? null;
  const baseSrc = baseAbs
    ? baseAbs.startsWith("/__mockassets__")
      ? baseAbs
      : convertFileSrc(baseAbs)
    : null;
  // Prefer the STORED spec — it describes how this particular drawing moves,
  // authored by a previous run against this very sprite. The generic brief is
  // the fallback for an actor that has never been animated.
  const planned = info?.planned_states ?? [];
  const specFor = (s: string) => info?.spec?.[s];

  const anyPaid = imageBackend === "fal" || (!reuseSpec && vlmBackend === "anthropic");
  // canon refuses this pair up front ("animate needs --vlm-backend (or
  // --reuse-spec with a stored spec)") — say so here instead of queueing a job
  // that only fails in the tray.
  const blocked =
    !reuseSpec && vlmBackend === "none"
      ? "Pick a vision backend to author the motion spec, or tick “Reuse stored spec”."
      : null;

  // Live estimate, debounced — the same shape NewProjectModal uses. It moves
  // when you change a backend or tick "reuse spec", so the price is visible
  // BEFORE the confirm dialog rather than inside it.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .estimateAsset(worldPath, target, {
          op: "animate",
          imageBackend,
          vlmBackend: reuseSpec ? "none" : vlmBackend,
          reuseSpec,
        })
        .then((r) => live && setEst(r.estimate))
        .catch(() => live && setEst(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [worldPath, target, imageBackend, vlmBackend, reuseSpec]);

  const submit = async () => {
    setBusy(true);
    await onSubmit({
      imageBackend,
      imageModel: imageModel.trim() || undefined,
      imageEditModel: editModel.trim() || undefined,
      vlmBackend: reuseSpec ? undefined : vlmBackend,
      vlmModel: vlmModel.trim() || undefined,
      reuseSpec,
      promptOverride: reuseSpec ? null : prompt,
      backends: {
        image: imageBackend,
        ...(reuseSpec ? {} : { vlm: vlmBackend }),
      },
      estimate: est,
    });
    setBusy(false);
  };

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
    width: 440,
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
  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
    fontSize: 13,
    margin: "7px 0",
  };
  const sel = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: [string, string][],
    disabled = false,
  ) => (
    <label style={{ ...row, opacity: disabled ? 0.45 : 1 }}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        disabled={busy || disabled}
        style={{ fontSize: 12 }}
      >
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const txt = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    disabled = false,
  ) => (
    <label style={{ ...row, opacity: disabled ? 0.45 : 1 }}>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        disabled={busy || disabled}
        spellCheck={false}
        style={{ flex: 1, marginLeft: 12, fontSize: 12, fontFamily: "monospace" }}
      />
    </label>
  );

  return (
    <div style={overlay} onClick={() => !busy && onClose()}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 4px" }}>Generate animation — {name ?? target}</h3>
        <p style={{ margin: "0 0 14px", fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
          A vision model authors a per-state motion spec from the sprite below, then
          one img2img sheet is generated per state. The sheets are sliced into frame
          strips and a packed atlas — inspect the result in the <b>Animation</b> tab.
        </p>

        {/* THE INPUTS — the sprite this run edits, and what each state means.
            Shown before the backend knobs because they are what determines
            whether the result will be any good. */}
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: 10,
            borderRadius: 8,
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            marginBottom: 14,
          }}
        >
          <div style={{ flex: "none", textAlign: "center" }}>
            {baseSrc ? (
              <img
                src={baseSrc}
                alt={`${name ?? target} base sprite`}
                width={64}
                height={64}
                style={{
                  imageRendering: "pixelated",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  objectFit: "contain",
                }}
              />
            ) : (
              <div
                style={{
                  width: 64,
                  height: 64,
                  display: "grid",
                  placeItems: "center",
                  border: "1px dashed var(--border-hi)",
                  borderRadius: 6,
                  fontSize: 10,
                  color: "var(--fg-dim)",
                }}
              >
                no sprite
              </div>
            )}
            <div style={{ fontSize: 9.5, color: "var(--fg-dim)", marginTop: 4 }}>
              base sprite
            </div>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11.5, opacity: 0.75, marginBottom: 5 }}>
              {planned.length
                ? `${planned.length} states — ${
                    info?.spec && Object.keys(info.spec).length
                      ? "motion stored from a previous run"
                      : "the motion brief each will be authored against"
                  }`
                : "reading this actor…"}
            </div>
            <div style={{ maxHeight: 132, overflowY: "auto", paddingRight: 4 }}>
              {planned.map((s) => {
                const sp = specFor(s);
                const text = sp?.motion || info?.briefs?.[s] || "";
                return (
                  <div key={s} style={{ display: "flex", gap: 7, margin: "3px 0" }}>
                    <code
                      style={{
                        fontSize: 10.5,
                        flex: "none",
                        minWidth: 40,
                        color: sp ? "var(--fg)" : "var(--fg-muted)",
                      }}
                    >
                      {s}
                      {sp?.frames ? `·${sp.frames}` : ""}
                    </code>
                    <span
                      style={{
                        fontSize: 10.5,
                        lineHeight: 1.45,
                        color: "var(--fg-dim)",
                        minWidth: 0,
                      }}
                    >
                      {text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {sel("Image edit backend", imageBackend, setImageBackend, EDIT_BACKENDS)}
        <div style={{ fontSize: 11, opacity: 0.6, margin: "-2px 0 8px", lineHeight: 1.45 }}>
          Only <code>fal</code> and <code>fake</code> can animate — they are the only
          backends with an img2img <code>edit()</code>. PixelLab, Retro Diffusion and
          local can draw a sprite, but an animate run on them produces no frames and
          still bills the vision model.
        </div>
        {txt("Image model", imageModel, setImageModel, DEFAULT_IMAGE_MODEL)}
        {txt("Edit model", editModel, setEditModel, DEFAULT_EDIT_MODEL)}

        <div style={{ margin: "14px 0 2px", fontSize: 12, opacity: 0.7 }}>
          Motion spec — who decides how this actor moves:
        </div>
        <label style={row}>
          <span>Reuse stored spec</span>
          <input
            type="checkbox"
            checked={reuseSpec}
            onChange={(e) => setReuseSpec(e.target.checked)}
            disabled={busy}
          />
        </label>
        <div style={{ fontSize: 11, opacity: 0.6, margin: "-2px 0 8px", lineHeight: 1.45 }}>
          Re-render from the motion spec already stored on this actor — no vision
          call, so it is cheaper and reproduces the same motion. Needs a previous
          animate run to have stored one.
        </div>
        {sel("Vision backend", vlmBackend, setVlmBackend, VLM_BACKENDS, reuseSpec)}
        {txt("Vision model", vlmModel, setVlmModel, DEFAULT_VLM_MODEL, reuseSpec)}

        {!reuseSpec && (
          <PromptOverride
            worldPath={worldPath}
            kind="animate"
            ctx={{ target }}
            value={prompt}
            onChange={setPrompt}
            disabled={busy}
            label="✎ Edit motion prompt (advanced)"
          />
        )}

        <div
          style={{
            marginTop: 12,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ opacity: 0.8 }}>Estimated cost</span>
            <strong style={{ fontSize: 15 }}>{est ? fmtRange(est.total_usd) : "…"}</strong>
          </div>
          {est && anyPaid && (
            <div style={{ marginTop: 4, opacity: 0.65, lineHeight: 1.5 }}>
              {est.assets.images.count} state sheet(s) → {fmtUsd(est.assets.images.usd)}
              {est.assets.vlm?.usd
                ? ` · motion spec ${fmtUsd(est.assets.vlm.usd.best)}`
                : " · motion spec reused ($0)"}
            </div>
          )}
          {est && !anyPaid && (
            <div style={{ marginTop: 4, opacity: 0.6 }}>
              $0 — placeholder backends ({est.assets.images.count} state sheets).
            </div>
          )}
          <div style={{ marginTop: 4, opacity: 0.55, lineHeight: 1.45 }}>
            Priced per STATE, not per frame — one image call renders a whole state's
            sheet.
          </div>
        </div>

        {blocked && (
          <div style={{ color: "var(--accent)", fontSize: 11.5, marginTop: 8, lineHeight: 1.45 }}>
            {blocked}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || blocked !== null}
            style={{ cursor: "pointer", fontWeight: 600 }}
          >
            {busy
              ? "Queueing…"
              : anyPaid
                ? `Generate · ${fmtRange(est?.total_usd)}`
                : "Generate · $0"}
          </button>
        </div>
      </div>
    </div>
  );
}
