import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../../store";
import { api, type CostEstimate } from "../../lib/invoke";
import { fmtRange, fmtUsd, recordJob, recordSpend } from "../../lib/cost";
import { enqueueJob } from "../../lib/jobs";
import { CreateProgress } from "./CreateProgress";

/** "New platformer project": collect a name + a few counts, pick a parent
 *  folder, then scaffold a populated STARTER via `canon world new` (the fake
 *  pipeline — $0, no API keys) and open it. */
/** The two templates. Only the platformer generates today — the dungeon
 *  crawler is the design's `beta` card, and picking it says so rather than
 *  quietly producing a platformer. */
const TEMPLATES = [
  {
    id: "platformer" as const,
    name: "Platformer",
    desc: "Side-scrolling stages of levels, wired into a world map.",
    vocab: "stages · levels · paths",
    beta: false,
  },
  {
    id: "dungeon" as const,
    name: "Dungeon crawler",
    desc: "Floors of rooms with encounters and loot tables.",
    vocab: "floors · rooms · encounters",
    beta: true,
  },
];

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const loadWorldByPath = useStore((s) => s.loadWorldByPath);
  // Step 1 picks the template, step 2 is the generation form — the design
  // splits them so the vocabulary on step 2 can match what you chose.
  const [step, setStep] = useState<1 | 2>(1);
  const [template, setTemplate] = useState<"platformer" | "dungeon">("platformer");
  const [name, setName] = useState("My Platformer");
  const [stages, setStages] = useState(1);
  const [levels, setLevels] = useState(2);
  const [enemies, setEnemies] = useState(4);
  const [items, setItems] = useState(4);
  // Each generator is its own backend — leave all at the $0 defaults for a
  // free preview, or turn any up for a real (paid) run.
  const [llm, setLlm] = useState("fake");
  const [image, setImage] = useState("fake");
  const [music, setMusic] = useState("none");
  const [sfx, setSfx] = useState("none");
  const [vlm, setVlm] = useState("none");
  // `busy` covers only the gap between "create" and the run being enqueued
  // (the folder picker, the confirm). Once the run exists the tracker below
  // replaces this whole form, so nothing here needs a status string.
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [est, setEst] = useState<CostEstimate | null>(null);
  // The in-flight run: its job id (to read live progress off the store) and
  // when it started (the elapsed clock). Set once `create` enqueues.
  const [run, setRun] = useState<{ jobId: string; startedAt: number } | null>(null);
  const [packDir, setPackDir] = useState("");
  const landed = useRef<string | null>(null); // the job id already recorded + opened
  const job = useStore((s) => (run ? s.jobs.find((j) => j.id === run.jobId) : undefined));

  const anyPaid =
    llm === "anthropic" ||
    ["fal", "retro", "pixellab", "local"].includes(image) ||
    music === "lyria" ||
    sfx === "elevenlabs" ||
    vlm === "anthropic";

  // Live estimate — recompute (debounced) as counts / backends change. The
  // number reflects the CHOSEN backends: $0 while everything is fake/none, real
  // dollars as you turn generators on.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .estimateWorld({
          stages,
          levels,
          enemies,
          items,
          llmBackend: llm,
          imageBackend: image,
          musicBackend: music,
          sfxBackend: sfx,
          vlmBackend: vlm,
        })
        .then((r) => live && setEst(r.estimate))
        .catch(() => live && setEst(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [stages, levels, enemies, items, llm, image, music, sfx, vlm]);

  const create = async () => {
    setErr(null);
    let parent: string;
    try {
      const sel = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose where to create the project",
      });
      if (typeof sel !== "string") return; // cancelled the folder picker
      parent = sel;
    } catch (e) {
      setErr(String(e));
      return;
    }
    // Paid runs are the real bill — confirm the projected cost before spending.
    if (
      anyPaid &&
      !window.confirm(
        `This run uses PAID backends.\n\nProjected cost: ${fmtRange(est?.total_usd)} ` +
          `(${stages} stage(s) · ${levels} level(s) each · ${enemies} enemies · ${items} items).\n\n` +
          "Actual cost depends on real token/asset usage. Proceed?",
      )
    )
      return;
    const title = name.trim() || "My Platformer";
    setBusy(true);
    // Background job, like every other paid verb: the run happens on the Rust
    // worker and reports back through `job-updated` / `job-progress`, so this
    // modal can SHOW the run instead of blocking on it. (It used to await a
    // blocking command, which froze the whole app for the length of the run.)
    let dir = "";
    const jobId = await enqueueJob(
      {
        op: "world",
        label: title,
        target: title,
        targetType: "",
        scope: "world",
        backends: { llm, image, music, sfx, vlm },
        estimate: est?.total_usd,
      },
      async (id) => {
        const ack = await api.newProject(parent, title, {
          stages,
          levels,
          enemies,
          items,
          llmBackend: llm,
          imageBackend: image,
          musicBackend: music,
          sfxBackend: sfx,
          vlmBackend: vlm,
          jobId: id,
        });
        dir = ack.pack_dir;
        return ack;
      },
    );
    setPackDir(dir);
    setRun({ jobId, startedAt: Date.now() });
  };

  // The run landed: record what it actually cost, then open it. Driven by the
  // job's terminal status rather than an await, because the run outlives the
  // call that started it.
  useEffect(() => {
    if (!run || !job) return;
    if (job.status === "failed") {
      setErr(job.error ?? "generation failed");
      return;
    }
    if (job.status !== "ok" && job.status !== "no_change") return;
    const dir = packDir || (job.result?.pack_dir as string) || "";
    if (!dir) {
      setErr("generation finished but reported no pack directory");
      return;
    }
    // Exactly once per run: the ledger writes are appends, and StrictMode
    // double-invokes effects in dev — without this the run bills itself twice.
    if (landed.current === job.id) return;
    landed.current = job.id;
    let live = true;
    void (async () => {
      // Record the run's ACTUAL cost from the generated tree's stats (real LLM +
      // audio/pixellab/retro image spend). Best-effort — a missing stat records 0.
      let actual = 0;
      try {
        const mf = (await api.readWorldJson(dir, "manifest.json")) as {
          generation_stats?: { total_cost_usd?: number };
        };
        actual = mf.generation_stats?.total_cost_usd ?? 0;
      } catch {
        /* stats optional */
      }
      // Both ledgers land in the pack the run CREATED, not the one that
      // happened to be open — which is why `handleJobEvent` sits this one out
      // (it only knows the open world).
      await recordSpend(dir, {
        op: "world",
        scope: "world",
        backends: { llm, image, music, sfx, vlm },
        estimate: est?.total_usd,
        actual_usd: actual,
      });
      await recordJob(dir, {
        job_id: job.id,
        op: "world",
        scope: "world",
        target: job.label, // the project name, set when the job was enqueued
        status: job.status,
        backends: { llm, image, music, sfx, vlm },
        estimate: est?.total_usd,
        actual_usd: actual,
        duration_ms: job.endedAt ? job.endedAt - job.ts : undefined,
        changed: true,
      });
      if (!live) return;
      try {
        await loadWorldByPath(dir);
        onClose();
      } catch (e) {
        setErr(`generated at ${dir}, but opening it failed: ${String(e).slice(0, 300)}`);
      }
    })();
    return () => {
      live = false;
    };
    // Re-runs only when the job's identity/status changes — the backend
    // selections are frozen for the life of the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, job?.status, job?.error, packDir]);

  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
    fontSize: 13,
    margin: "7px 0",
  };
  const num = (v: number, set: (n: number) => void, min = 0) => (
    <input
      type="number"
      min={min}
      value={v}
      onChange={(e) => set(+e.target.value)}
      disabled={busy}
      style={{ width: 60 }}
    />
  );
  const sel = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: [string, string][],
  ) => (
    <label style={row}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        disabled={busy}
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

  // ---- step 1: pick a template -------------------------------------------
  if (step === 1) {
    return (
      <div className="modal-scrim" onClick={onClose}>
        <div className="modal np-modal" onClick={(e) => e.stopPropagation()}>
          <h3>New project</h3>
          <p className="note">
            Pick what kind of game this is. It sets the vocabulary and the generators the next step
            offers.
          </p>
          <div className="tpl-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className={`tpl-card ${template === t.id ? "on" : ""}`}
                onClick={() => setTemplate(t.id)}
              >
                <span className="tpl-art" data-kind={t.id} />
                <span className="tpl-name">
                  {t.name}
                  {t.beta && <span className="tpl-beta">beta</span>}
                </span>
                <span className="tpl-desc">{t.desc}</span>
                <span className="tpl-vocab">{t.vocab}</span>
              </button>
            ))}
          </div>
          <p className="note dim">
            {template === "dungeon"
              ? "The dungeon crawler template isn't generated by canon yet — picking it here is a preview of the flow, not a working run."
              : "More templates land as canon grows generators for them."}
          </p>
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn pri" onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- the run: the form is replaced by the tracker ----------------------
  // Deliberately a REPLACEMENT rather than a strip added under the form: once
  // the run starts none of those inputs mean anything, and the one question
  // that matters ("is this alive?") should own the whole card.
  if (run) {
    const dead = !!err;
    return (
      <div className="modal-scrim" onClick={() => dead && onClose()}>
        <div className="modal np-modal" onClick={(e) => e.stopPropagation()}>
          <h3>{dead ? "Generation failed" : `Building ${name.trim() || "My Platformer"}`}</h3>
          <p className="note">
            {dead ? (
              <>
                Nothing was opened. Anything the run wrote is under{" "}
                <code>{packDir || "the folder you chose"}</code>
              </>
            ) : (
              <>
                {stages} stage(s) · {levels} level(s) each · {enemies} enemies · {items} items →{" "}
                <code>{packDir || "…"}</code>
              </>
            )}
          </p>
          <CreateProgress
            progress={job?.progress}
            startedAt={run.startedAt}
            paid={anyPaid}
            error={err}
          />
          <div className="modal-foot">
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={onClose} disabled={!dead}>
              {dead ? "Close" : "Working…"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- step 2: the generation form ---------------------------------------
  return (
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal np-modal" onClick={(e) => e.stopPropagation()}>
        <h3>New {template === "dungeon" ? "dungeon crawler" : "platformer"} project</h3>
        <p className="note">
          Generates a small, playable starter world with placeholder art — $0, no API keys. You'll
          pick where to save it next, then edit and generate levels from there.
        </p>
        {template === "dungeon" && (
          <p className="note dim">
            Heads up: canon only generates platformer packs today, so this run produces a platformer
            world regardless of the template.
          </p>
        )}
        <label style={row}>
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            style={{ flex: 1, marginLeft: 12 }}
          />
        </label>
        {/* The template chooses the vocabulary — the counts underneath are the
            same numbers canon takes either way. */}
        <label style={row}>
          <span>{template === "dungeon" ? "Floors" : "Stages"}</span> {num(stages, setStages, 1)}
        </label>
        <label style={row}>
          <span>{template === "dungeon" ? "Rooms per floor" : "Levels per stage"}</span>{" "}
          {num(levels, setLevels, 1)}
        </label>
        <label style={row}>
          <span>{template === "dungeon" ? "Monsters" : "Enemies"}</span>{" "}
          {num(enemies, setEnemies, 1)}
        </label>
        <label style={row}>
          <span>{template === "dungeon" ? "Loot tables" : "Items"}</span> {num(items, setItems, 0)}
        </label>

        <div style={{ margin: "12px 0 2px", fontSize: 12, opacity: 0.7 }}>
          Generators — leave at the defaults for a free preview, or turn any up for a real (paid)
          run:
        </div>
        {sel("Design (text)", llm, setLlm, [
          ["fake", "$0 canned"],
          ["anthropic", "Claude (paid)"],
        ])}
        {sel("Art (sprites)", image, setImage, [
          ["fake", "placeholder ($0)"],
          ["none", "none"],
          ["fal", "fal (paid)"],
          ["retro", "Retro Diffusion (paid)"],
          ["pixellab", "PixelLab (paid)"],
          ["local", "local"],
        ])}
        {sel("Music", music, setMusic, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["lyria", "Lyria (paid)"],
        ])}
        {sel("SFX", sfx, setSfx, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["elevenlabs", "ElevenLabs (paid)"],
        ])}
        {sel("Animation", vlm, setVlm, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["anthropic", "Claude (paid)"],
        ])}
        {anyPaid && (
          <div style={{ fontSize: 11, marginTop: 6, color: "var(--accent)" }}>
            Paid backends selected — needs API keys via <code>CANON_ENV_FILE</code> when you launch
            cradle.
          </div>
        )}
        <div className="cost-box">
          <div className="cost-head">
            <span>
              Estimated cost{!anyPaid && <span className="cost-free"> · free preview</span>}
            </span>
            <strong>{est ? fmtRange(est.total_usd) : "…"}</strong>
          </div>
          {est && anyPaid && (
            <div className="cost-detail">
              LLM {fmtUsd(est.llm.usd.best)} · images {est.assets.images.count}×→
              {fmtUsd(est.assets.images.usd)} · music {fmtUsd(est.assets.music.usd)} · sfx{" "}
              {fmtUsd(est.assets.sfx.usd)} · anim{" "}
              {fmtUsd((est.assets.vlm?.usd?.best ?? 0) as number)}
            </div>
          )}
          {est && !anyPaid && (
            <div className="cost-detail">
              $0 — every generator is free ({est.assets.images.count} placeholder images,{" "}
              {stages * levels} levels).
            </div>
          )}
        </div>
        {err && <div className="np-err">{err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={() => setStep(1)} disabled={busy}>
            Back
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn pri" onClick={() => void create()} disabled={busy}>
            {busy ? "Starting…" : "Choose location & create"}
          </button>
        </div>
      </div>
    </div>
  );
}
