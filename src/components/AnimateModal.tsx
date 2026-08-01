import { useEffect, useState } from "react";
import { api, type CostEstimate } from "../lib/invoke";
import { fmtRange } from "../lib/cost";
import { enqueueJob, missingKeysFor } from "../lib/jobs";
import { PromptOverride } from "./PromptOverride";

/** The image backends that can actually ANIMATE.
 *
 *  The animation phase drives `ImageEditBackend.edit()` (img2img: it hands the
 *  model a reference sheet + the base sprite and asks for the motion frames).
 *  Only `fal` and `fake` implement that interface. `pixellab` / `retro` /
 *  `local` DRAW sprites perfectly well but have no `edit()`, so
 *  SpriteAnimationPhase takes its loud fallback and keeps the static sprite —
 *  after the VLM has already been billed for authoring a motion spec nothing
 *  consumes. Offering them as the animator would sell a paid no-op. */
const EDIT_BACKENDS = new Set(["fal", "fake"]);

/** The backend that DREW the sprite. It builds the producer, and (canon's
 *  default) also animates — which is why a non-edit backend here needs an
 *  explicit animator below rather than a blocked button. */
const SPRITE_BACKENDS: [string, string][] = [
  ["fal", "fal (paid)"],
  ["fake", "placeholder ($0)"],
  ["pixellab", "PixelLab (paid)"],
  ["retro", "Retro Diffusion (paid)"],
  ["local", "local"],
];

const ANIMATOR_BACKENDS: [string, string][] = [
  ["", "same as sprite backend"],
  ["fal", "fal — nano-banana edit (paid)"],
  ["fake", "fake — placeholder frames ($0)"],
];

/** Placeholders, not values: blank means "canon's own default", so an unedited
 *  field can never pin the run to a model name cradle happens to know today. */
const DEFAULT_IMAGE_MODEL = "fal-ai/nano-banana";
const DEFAULT_EDIT_MODEL = "fal-ai/nano-banana/edit";
const DEFAULT_VLM_MODEL = "claude-sonnet-4-6";

/** Animate ONE actor: the VLM authors a per-state motion spec from the sprite,
 *  then one img2img sheet per state becomes the frame strips + atlas.
 *
 *  Replaces the old one-click button, which hard-coded fal + anthropic and
 *  could reach neither the model names nor `--reuse-spec`. Shaped like
 *  RegenerateLayoutModal (live estimate → confirm → enqueueJob) with
 *  NewProjectModal's `sel()` row helper. */
export function AnimateModal({
  worldPath,
  target,
  actorId,
  typeId,
  onClose,
  onQueued,
}: {
  worldPath: string;
  /** canon address: `enemy:<id>` | `player`. */
  target: string;
  /** Display id (and the job's target, matching the entity's row id). */
  actorId: string;
  /** The nav type the job reports under — GenActions' completion listener
   *  matches on it, so it has to be the caller's typeId, not one derived here. */
  typeId: string;
  onClose: () => void;
  onQueued: (note: string) => void;
}) {
  const [imageBackend, setImageBackend] = useState("fal");
  const [editBackend, setEditBackend] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [editModel, setEditModel] = useState("");
  const [vlmBackend, setVlmBackend] = useState("anthropic");
  const [vlmModel, setVlmModel] = useState("");
  const [reuseSpec, setReuseSpec] = useState(false);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [est, setEst] = useState<CostEstimate | null>(null);

  // Reusing a stored spec skips the authoring call outright, so the VLM choice
  // stops mattering — say so instead of billing for a selection that is inert.
  const authors = !reuseSpec;
  // canon's own default: `build_image_producer(edit_kind=None)` animates on the
  // sprite backend. So this — not the sprite backend — is what actually runs
  // edit(), what bills per state, and what has to implement ImageEditBackend.
  const animator = editBackend || imageBackend;
  const canAnimate = EDIT_BACKENDS.has(animator);
  const paid = animator === "fal" || (authors && vlmBackend === "anthropic");
  // Authoring IS the VLM call, so "none" leaves nothing to write the spec.
  // canon refuses this combination; refuse it here so the trip is never made.
  const needsVlm = authors && vlmBackend === "none";

  // Live estimate. canon prices this by the actor's REAL state set (a hopper's
  // extra `jump`, the player's six, an `asymmetric` second facing), which
  // cradle cannot compute from the row it has — so it asks.
  useEffect(() => {
    let live = true;
    setEst(null);
    const t = setTimeout(() => {
      api
        // Priced on the ANIMATOR: an animate generates nothing on the sprite
        // backend, it only issues edit() calls on this one.
        .estimateAnimate(worldPath, target, animator, vlmBackend, {
          vlmModel: vlmModel.trim() || null,
          reuseSpec,
        })
        .then((r) => {
          if (!live) return;
          setEst(r.estimate);
          setErr(null);
        })
        // The estimate is advisory — a failure must never block the op, but it
        // must not read as a silent "…" forever either.
        .catch((e) => live && setErr(`estimate unavailable: ${String(e).slice(0, 160)}`));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [worldPath, target, animator, vlmBackend, vlmModel, reuseSpec]);

  const run = async () => {
    // --reuse-spec makes no VLM call, so the VLM never reaches the ledger or
    // the key pre-flight: recording it would claim a spend that didn't happen.
    // The sprite backend still rides along — canon builds its producer either
    // way, so its key has to be present even when fal does the animating.
    const backends: Record<string, string> = { image: animator };
    if (imageBackend !== animator) backends.sprite = imageBackend;
    if (authors) backends.vlm = vlmBackend;
    // Pre-flight the provider keys before spending a confirm on a run that
    // would only die at the provider.
    const missing = await missingKeysFor(backends);
    if (missing) {
      setErr(missing);
      return;
    }
    const states = est?.assets.images.count;
    if (
      !window.confirm(
        `${paid ? `PAID — est. ${fmtRange(est?.total_usd)}` : "FAKE — $0, no API calls"}: ` +
          `animate ${actorId}.\n\n` +
          (authors
            ? `The VLM authors a motion spec from the sprite, then one img2img sheet per state`
            : `Re-renders from the STORED motion spec (no VLM call) — one img2img sheet per state`) +
          `${states ? ` (${states} edit(s))` : ""}.\n\n` +
          "This REPLACES the actor's current frames. Proceed?",
      )
    )
      return;
    setBusy(true);
    setErr(null);
    // Fire-and-forget background job — the tray tracks it, and the entity view
    // refreshes off the completion listener in GenActions.
    await enqueueJob(
      {
        op: "animate",
        label: `Animate · ${actorId}`,
        target: actorId,
        targetType: typeId,
        scope: "asset",
        backends,
        estimate: est?.total_usd,
      },
      (jobId) =>
        api.animateAsset(worldPath, target, {
          imageBackend,
          imageModel: imageModel.trim() || null,
          imageEditModel: editModel.trim() || null,
          imageEditBackend: editBackend || null,
          vlmBackend,
          vlmModel: vlmModel.trim() || null,
          reuseSpec,
          promptOverride,
          jobId,
        }),
    );
    onQueued("animate queued — watch ⚙ Jobs");
    onClose();
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
    maxHeight: "90vh",
    overflowY: "auto",
    background: "var(--surface-1, #1a1522)",
    border: "1px solid var(--border, #3a2f4a)",
    borderRadius: 12,
    padding: 20,
    color: "var(--text-1, #ece7f5)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
  };
  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
    fontSize: 13,
    margin: "8px 0",
  };
  const sel = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: [string, string][],
    disabled = false,
  ) => (
    <label style={{ ...row, opacity: disabled ? 0.5 : 1 }}>
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
  const text = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    disabled = false,
  ) => (
    <label style={{ ...row, opacity: disabled ? 0.5 : 1 }}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        disabled={busy || disabled}
        spellCheck={false}
        style={{
          flex: 1,
          marginLeft: 12,
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      />
    </label>
  );

  return (
    <div style={overlay} onClick={() => !busy && onClose()}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 4px" }}>Animate — {actorId}</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
          A VLM authors a per-state motion spec from this actor's sprite, then one img2img sheet per
          state (idle / walk / hurt / death…) becomes the frame strips and packed atlas. Replaces
          the current frames.
        </p>

        {sel("Sprite backend", imageBackend, setImageBackend, SPRITE_BACKENDS)}
        {text("Sprite model", imageModel, setImageModel, DEFAULT_IMAGE_MODEL)}
        {sel("Animator (img2img)", editBackend, setEditBackend, ANIMATOR_BACKENDS)}
        {text("Sheet model", editModel, setEditModel, DEFAULT_EDIT_MODEL)}
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            margin: "-2px 0 8px",
            color: canAnimate ? undefined : "#e0a15a",
            opacity: canAnimate ? 0.6 : 1,
          }}
        >
          {canAnimate ? (
            <>
              Only <code>fal</code> and <code>fake</code> can animate — they're the backends that
              implement the img2img <code>edit()</code> call. PixelLab / Retro Diffusion / local
              draw sprites but have no edit step, so they can supply the sprite while{" "}
              <code>fal</code> animates it.
            </>
          ) : (
            <>
              <code>{animator}</code> draws sprites but has no img2img <code>edit()</code>, so it
              can't animate: the run would bill the VLM for a motion spec and leave the sprite
              static. Pick <code>fal</code> or <code>fake</code> as the animator.
            </>
          )}
        </div>

        {sel(
          "Motion author (VLM)",
          vlmBackend,
          setVlmBackend,
          [
            ["none", "none"],
            ["fake", "fake ($0)"],
            ["anthropic", "Claude (paid)"],
          ],
          !authors,
        )}
        {text("VLM model", vlmModel, setVlmModel, DEFAULT_VLM_MODEL, !authors)}
        {needsVlm && (
          <div style={{ fontSize: 11, color: "#e0a15a", margin: "-2px 0 6px", lineHeight: 1.45 }}>
            Authoring needs a VLM — pick one, or reuse the stored spec below (which needs no VLM,
            but only works once this actor has been animated before).
          </div>
        )}

        <label style={{ ...row, justifyContent: "flex-start", gap: 8 }}>
          <input
            type="checkbox"
            checked={reuseSpec}
            onChange={(e) => setReuseSpec(e.target.checked)}
            disabled={busy}
          />
          <span>
            Reuse the stored motion spec
            <span style={{ opacity: 0.6 }}> — re-render the sheets without a VLM call</span>
          </span>
        </label>

        <PromptOverride
          worldPath={worldPath}
          kind="animate"
          ctx={{ target }}
          value={promptOverride}
          onChange={setPromptOverride}
          disabled={busy || !authors}
          label="✎ Edit motion-spec prompt (advanced)"
        />
        {!authors && promptOverride !== null && (
          <div style={{ fontSize: 11, color: "#e0a15a", marginTop: -2 }}>
            The edited prompt is inert while reusing the stored spec — nothing re-authors.
          </div>
        )}

        <div style={{ ...row, opacity: 0.85 }}>
          <span>
            Estimated cost
            {est && (
              <span style={{ opacity: 0.6, fontSize: 11 }}>
                {" "}
                · {est.assets.images.count} img2img edit
                {est.assets.images.count === 1 ? "" : "s"}
                {authors ? " + 1 VLM call" : ""}
              </span>
            )}
          </span>
          <strong>{est ? fmtRange(est.total_usd) : "…"}</strong>
        </div>
        {/* canon's own caveats, verbatim — chiefly that a sprite-drift retry
            can add an extra edit, which the priced number deliberately omits. */}
        {est?.warnings.map((w) => (
          <div key={w} style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.4 }}>
            {w}
          </div>
        ))}
        {err && (
          <div style={{ color: "#e0453a", fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>
            {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} disabled={busy} style={{ cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={() => void run()}
            disabled={busy || needsVlm || !canAnimate}
            title={
              !canAnimate
                ? `${animator} has no img2img edit() — pick fal or fake as the animator`
                : needsVlm
                  ? "pick a motion author (VLM), or reuse the stored spec"
                  : undefined
            }
            style={{
              cursor: busy || needsVlm || !canAnimate ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            {busy ? "Queueing…" : "🎬 Animate"}
          </button>
        </div>
      </div>
    </div>
  );
}
