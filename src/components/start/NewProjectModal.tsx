import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../../store";
import { api, type CostEstimate } from "../../lib/invoke";
import { fmtRange, fmtUsd, recordJob, recordSpend } from "../../lib/cost";
import { enqueueJob } from "../../lib/jobs";
import { cancelJob } from "../../lib/agentActions";
import { confirmSpend } from "../agent/confirmGateState";
import { CreateProgress } from "./CreateProgress";
import {
  countLabel,
  rangeFor,
  splitCounts,
  usePackTemplates,
  type PackTemplate,
} from "../../lib/packTemplates";
import {
  firstKeyVarFor,
  missingKeysFor,
  SETTINGS_KEYS_SCREEN,
  openProviderKeys,
} from "../../lib/providerKeys";

/** "New project": pick a template, tune its counts and generators, then
 *  scaffold a populated STARTER via `canon world new --template` and open it.
 *
 *  Row P0-10 (design: `design_handoff_editor_worldmap_start` board 06 — the
 *  two-step modal it specs, with the cards becoming TEMPLATE DATA):
 *  - the two cards and every count field render from `canon pack templates`
 *    (the hardcoded `TEMPLATES` array is gone), so the dungeon card is real
 *    and a third template needs no change here;
 *  - step 2 is honest to the generator (W2.1.1): the fields ARE canon's count
 *    flags, primary vs Advanced per the template, and there is no "Floors"
 *    stepper because the manifest has no floors;
 *  - the provider-key precheck is the same `missingKeysFor` gate the entity
 *    path runs — disabled WITH the reason (doctrine 4), never hidden;
 *  - the live estimate comes from the chosen pack's own estimator, and a
 *    free selection reads "$0" on an ordinary chip and never spend-confirms
 *    (doctrine 3);
 *  - Advanced holds the seed, the model, the per-type extra counts and the
 *    location override — the project store (`~/CradleProjects/`) is default.
 */
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const loadWorldByPath = useStore((s) => s.loadWorldByPath);
  const { templates, loading: templatesLoading, error: templatesError } = usePackTemplates();
  // Step 1 picks the template, step 2 is the generation form — the design
  // splits them so the vocabulary on step 2 can match what you chose.
  const [step, setStep] = useState<1 | 2>(1);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const template: PackTemplate | undefined = useMemo(
    () => templates.find((t) => t.id === templateId) ?? templates[0],
    [templates, templateId],
  );
  const [name, setName] = useState("");
  // Count field → value, keyed by CANON's names: this object is sent to the
  // create verb as-is, so the form and the CLI cannot drift.
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Each generator is its own backend — leave all at the $0 defaults for a
  // free preview, or turn any up for a real (paid) run.
  const [llm, setLlm] = useState("fake");
  const [image, setImage] = useState("fake");
  const [music, setMusic] = useState("none");
  const [sfx, setSfx] = useState("none");
  const [vlm, setVlm] = useState("none");
  // Advanced (board 06 doesn't design these two — the existing disclosure
  // convention is the pattern note in master §4).
  const [advOpen, setAdvOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const [model, setModel] = useState("");
  const [location, setLocation] = useState<string | null>(null); // null = project store
  const [store, setStore] = useState<string>("");
  // `busy` covers only the gap between "create" and the run being enqueued.
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [est, setEst] = useState<CostEstimate | null>(null);
  // The provider-key precheck's refusal, or null when the selection is fine.
  const [keyGate, setKeyGate] = useState<string | null>(null);
  //: Which variable the refusal is about — row P0-12's deep link needs a
  //: TARGET, not just a screen: the gate's "closes the inversion" clause is
  //: that this link lands on the row it is complaining about.
  const [keyGateVar, setKeyGateVar] = useState<string | null>(null);
  const [run, setRun] = useState<{ jobId: string; startedAt: number } | null>(null);
  const [packDir, setPackDir] = useState("");
  const landed = useRef<string | null>(null);
  const job = useStore((s) => (run ? s.jobs.find((j) => j.id === run.jobId) : undefined));

  const title = name.trim() || template?.label || "New project";
  // The generator lanes THIS template's runner accepts (`pack templates`).
  // A template with no `vlm` lane makes canon answer `--vlm-backend
  // 'anthropic' ignored: dungeon has no vlm generator` — so a lane it lacks
  // is neutral here, never a paid selection: counting it key-gated the Create
  // button and raised the accent spend card on a run canon prices at $0
  // (doctrine 3), while nothing said why (doctrine 4).
  const lanes = useMemo(
    () => new Set(template?.generators ?? ["llm", "image", "music", "sfx", "vlm"]),
    [template],
  );
  const backends = useMemo(
    () => ({
      llm: lanes.has("llm") ? llm : "none",
      image: lanes.has("image") ? image : "none",
      music: lanes.has("music") ? music : "none",
      sfx: lanes.has("sfx") ? sfx : "none",
      vlm: lanes.has("vlm") ? vlm : "none",
    }),
    [llm, image, music, sfx, vlm, lanes],
  );
  const anyPaid =
    backends.llm === "anthropic" ||
    ["fal", "retro", "pixellab"].includes(backends.image) ||
    backends.music === "lyria" ||
    backends.sfx === "elevenlabs" ||
    backends.vlm === "anthropic";

  // The template's defaults seed the form the first time it is chosen (and
  // whenever the choice changes) — the numbers on screen are the template's,
  // never cradle's idea of them. A generator the new template has no lane for
  // drops back to "none" so the disabled select is not showing a paid choice
  // that will never run.
  useEffect(() => {
    if (!template) return;
    setCounts({ ...template.defaults });
    const setters: Record<string, (v: string) => void> = {
      llm: setLlm,
      image: setImage,
      music: setMusic,
      sfx: setSfx,
      vlm: setVlm,
    };
    for (const [lane, set] of Object.entries(setters)) if (!lanes.has(lane)) set("none");
  }, [template, lanes]);

  // Where new projects land, shown before anything is created (§8.4).
  useEffect(() => {
    let live = true;
    api
      .projectStore()
      .then((r) => live && setStore(r.root))
      .catch(() => live && setStore(""));
    return () => {
      live = false;
    };
  }, []);

  // Live estimate — recompute (debounced) as counts / backends change, from
  // the CHOSEN TEMPLATE's estimator: $0 while everything is fake/none, real
  // dollars as you turn generators on.
  useEffect(() => {
    if (!template) return;
    let live = true;
    const t = setTimeout(() => {
      api
        .estimateWorld({
          template: template.id,
          counts,
          llmBackend: backends.llm,
          imageBackend: backends.image,
          musicBackend: backends.music,
          sfxBackend: backends.sfx,
          vlmBackend: backends.vlm,
        })
        .then((r) => live && setEst(r.estimate))
        .catch(() => live && setEst(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [template, counts, backends]);

  // The provider-key precheck (W2.2 step 3): the same gate the entity path
  // runs, moved to BEFORE the confirm so a run that would die at the provider
  // never starts. Free selections need no keys, so this is null for them.
  useEffect(() => {
    let live = true;
    void missingKeysFor(backends).then((reason) => live && setKeyGate(reason));
    void firstKeyVarFor(backends).then((v) => live && setKeyGateVar(v));
    return () => {
      live = false;
    };
  }, [backends]);

  const create = async () => {
    if (!template) return;
    setErr(null);
    // Doctrine 4: the button is already disabled with this reason, but a
    // keyboard path must not slip past it.
    if (keyGate) return;
    // Paid runs are the real bill — the paid card confirms the projected cost
    // before spending (row P1-A5); a free selection NEVER sees it (doctrine 3).
    if (
      anyPaid &&
      !(await confirmSpend({
        title: `create ${title}`,
        body:
          `Projected ${fmtRange(est?.total_usd)} — ` +
          `${Object.entries(counts)
            .map(([field, value]) => `${value} ${countLabel(field, template).toLowerCase()}`)
            .join(" · ")}.\nActual cost depends on real token/asset usage.`,
        estimate: est,
        backends,
      }))
    )
      return;
    setBusy(true);
    // Background job, like every other paid verb: the run happens on the Rust
    // worker and reports back through `job-updated` / `job-progress`, so this
    // modal can SHOW the run instead of blocking on it. (A `#[tauri::command]`
    // on a plain fn runs on the MAIN THREAD — this one froze the app once.)
    let dir = "";
    try {
      const jobId = await enqueueJob(
        {
          op: "world",
          label: title,
          target: title,
          targetType: "",
          scope: "world",
          backends,
          estimate: est?.total_usd,
        },
        async (id) => {
          const ack = await api.newProject(location, title, {
            template: template.id,
            counts,
            seed: seed.trim() || undefined,
            model: model.trim() || undefined,
            llmBackend: backends.llm,
            imageBackend: backends.image,
            musicBackend: backends.music,
            sfxBackend: backends.sfx,
            vlmBackend: backends.vlm,
            jobId: id,
          });
          // The pack dir is auto-uniquified Rust-side on a name collision, so
          // the ack is the only place that knows where the run is writing.
          dir = ack.pack_dir;
          return ack;
        },
      );
      setPackDir(dir);
      setRun({ jobId, startedAt: Date.now() });
    } catch (e) {
      setBusy(false);
      setErr(String(e).slice(0, 400));
    }
  };

  // The run landed: record what it actually cost, then open it. Driven by the
  // job's terminal status rather than an await, because the run outlives the
  // call that started it.
  //
  // ⏹ (§3.0-D) is terminal too, and NOT a failure: a stopped create still
  // billed what it billed and still left what landed on disk, so it records
  // both ledgers — it just does not open the partial tree behind the user's
  // back (the tracker offers "Open anyway").
  useEffect(() => {
    if (!run || !job) return;
    if (job.status === "failed") {
      setErr(job.error ?? "generation failed");
      return;
    }
    const stop = job.status === "cancelled";
    if (job.status !== "ok" && job.status !== "no_change" && !stop) return;
    const dir = packDir || (job.result?.pack_dir as string) || "";
    if (!dir) {
      if (!stop) setErr("generation finished but reported no pack directory");
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
        backends,
        estimate: est?.total_usd,
        actual_usd: actual,
      });
      await recordJob(dir, {
        job_id: job.id,
        op: "world",
        scope: "world",
        target: job.label, // the project name, set when the job was enqueued
        status: job.status,
        backends,
        estimate: est?.total_usd,
        actual_usd: actual,
        duration_ms: job.endedAt ? job.endedAt - job.ts : undefined,
        changed: stop ? !!job.changed : true,
      });
      if (!live || stop) return;
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
  const countRow = (field: string) => {
    const [min, max] = template ? rangeFor(template, field) : [0, Number.MAX_SAFE_INTEGER];
    return (
      <label style={row} key={field}>
        <span>{countLabel(field, template)}</span>
        <input
          type="number"
          min={min}
          max={Number.isSafeInteger(max) && max < Number.MAX_SAFE_INTEGER ? max : undefined}
          value={counts[field] ?? 0}
          onChange={(e) =>
            setCounts((c) => ({
              ...c,
              [field]: Math.max(min, Math.min(max, Number(e.target.value) || 0)),
            }))
          }
          disabled={busy}
          style={{ width: 60 }}
          aria-label={countLabel(field, template)}
          data-count={field}
        />
      </label>
    );
  };
  // Doctrine 4: a generator this template has no lane for is DISABLED with the
  // reason on the control, never hidden and never live-but-ignored.
  const sel = (
    lane: string,
    label: string,
    value: string,
    set: (v: string) => void,
    opts: [string, string][],
  ) => {
    const off = lanes.has(lane)
      ? null
      : `${template?.label ?? "This template"} has no ${label.toLowerCase()} generator`;
    return (
      <label style={row} title={off ?? undefined}>
        <span>
          {label}
          {off && (
            <span className="dim" style={{ fontSize: 11 }} data-testid={`lane-off-${lane}`}>
              {" "}
              · not in this template
            </span>
          )}
        </span>
        <select
          value={value}
          onChange={(e) => set(e.target.value)}
          disabled={busy || !!off}
          title={off ?? undefined}
          style={{ fontSize: 12 }}
          aria-label={label}
        >
          {opts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
    );
  };

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
          {templatesError ? (
            <p className="np-err" data-testid="templates-error">
              Couldn't ask canon which templates are installed: {templatesError}
            </p>
          ) : templatesLoading ? (
            <p className="note dim">Asking canon which templates are installed…</p>
          ) : (
            <div className="tpl-grid">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className={`tpl-card ${template?.id === t.id ? "on" : ""}`}
                  onClick={() => setTemplateId(t.id)}
                  data-template={t.id}
                >
                  <span className="tpl-art" data-kind={t.id} />
                  <span className="tpl-name">
                    {t.label}
                    {t.beta && <span className="tpl-beta">beta</span>}
                  </span>
                  <span className="tpl-desc">{t.description}</span>
                  <span className="tpl-vocab">{t.vocab.join(" · ")}</span>
                </button>
              ))}
            </div>
          )}
          <p className="note dim">More templates land as canon grows generators for them.</p>
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn pri" onClick={() => setStep(2)} disabled={!template}>
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
    // ⏹ is an ENDING, like a failure — the modal must become dismissable, or
    // the Stop button strands the user behind a disabled "Working…".
    const stopped = job?.status === "cancelled";
    const kept = Array.isArray(job?.result?.kept) ? (job.result.kept as unknown[]).length : 0;
    const dead = !!err || stopped;
    return (
      <div className="modal-scrim" onClick={() => dead && onClose()}>
        <div className="modal np-modal" onClick={(e) => e.stopPropagation()}>
          <h3>{err ? "Generation failed" : stopped ? "Stopped" : `Building ${title}`}</h3>
          <p className="note">
            {stopped ? (
              // §3.0-D: keep what landed, say what it cost — never "nothing
              // was opened", which reads as a crash.
              <>
                Stopped at a step boundary — {kept} step{kept === 1 ? "" : "s"} kept under{" "}
                <code>{packDir || "the folder you chose"}</code>. Nothing new was started.
              </>
            ) : err ? (
              <>
                Nothing was opened. Anything the run wrote is under{" "}
                <code>{packDir || "the folder you chose"}</code>
              </>
            ) : (
              <>
                {Object.entries(counts)
                  .map(([field, value]) => `${value} ${countLabel(field, template).toLowerCase()}`)
                  .join(" · ")}{" "}
                → <code>{packDir || "…"}</code>
              </>
            )}
          </p>
          <CreateProgress
            progress={job?.progress}
            startedAt={run.startedAt}
            paid={anyPaid}
            error={err}
            templates={template ? [template] : templates}
            onStop={dead ? undefined : () => void cancelJob(run.jobId)}
          />
          <div className="modal-foot">
            <span style={{ flex: 1 }} />
            {stopped && packDir && (
              <button
                className="btn"
                data-testid="open-anyway"
                title="Open the partial project — it has whatever the run finished"
                onClick={() => {
                  void (async () => {
                    try {
                      await loadWorldByPath(packDir);
                      onClose();
                    } catch (e) {
                      setErr(`opening ${packDir} failed: ${String(e).slice(0, 300)}`);
                    }
                  })();
                }}
              >
                Open anyway
              </button>
            )}
            <button className="btn" onClick={onClose} disabled={!dead}>
              {dead ? "Close" : "Working…"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- step 2: the generation form ---------------------------------------
  const split = template ? splitCounts(template) : { primary: [], advanced: [] };
  return (
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal np-modal" onClick={(e) => e.stopPropagation()}>
        <h3>New {template?.label.toLowerCase() ?? "project"}</h3>
        <p className="note">
          Generates a small, playable starter world with placeholder art — $0, no API keys. It lands
          in <code>{location ?? store ?? "your projects folder"}</code>, and you can edit and
          generate from there.
        </p>
        <label style={row}>
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={template?.label ?? ""}
            disabled={busy}
            style={{ flex: 1, marginLeft: 12 }}
            aria-label="Name"
          />
        </label>
        {/* The count fields ARE canon's count flags for this template — one
            for one, in the template's own order. */}
        {split.primary.map(countRow)}

        <div style={{ margin: "12px 0 2px", fontSize: 12, opacity: 0.7 }}>
          Generators — leave at the defaults for a free preview, or turn any up for a real (paid)
          run:
        </div>
        {sel("llm", "Design (text)", llm, setLlm, [
          ["fake", "$0 canned"],
          ["anthropic", "Claude (paid)"],
        ])}
        {sel("image", "Art (sprites)", image, setImage, [
          ["fake", "placeholder ($0)"],
          ["none", "none"],
          ["fal", "fal (paid)"],
          ["retro", "Retro Diffusion (paid)"],
          ["pixellab", "PixelLab (paid)"],
          ["local", "local"],
        ])}
        {sel("music", "Music", music, setMusic, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["lyria", "Lyria (paid)"],
        ])}
        {sel("sfx", "SFX", sfx, setSfx, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["elevenlabs", "ElevenLabs (paid)"],
        ])}
        {sel("vlm", "Animation", vlm, setVlm, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["anthropic", "Claude (paid)"],
        ])}

        <details
          className="np-adv"
          open={advOpen}
          onToggle={(e) => setAdvOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.75, margin: "10px 0 2px" }}>
            Advanced
          </summary>
          {split.advanced.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.6, margin: "6px 0 0" }}>
              Extra counts — these stay at the template's defaults unless you change them.
            </div>
          )}
          {split.advanced.map(countRow)}
          <label style={row}>
            <span>Seed</span>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              disabled={busy}
              style={{ width: 160 }}
              aria-label="Seed"
            />
          </label>
          <label style={row}>
            <span>Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="template default"
              disabled={busy}
              style={{ width: 160 }}
              aria-label="Model"
            />
          </label>
          <label style={row}>
            <span>Location</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <code style={{ fontSize: 11, opacity: 0.75 }}>{location ?? store}</code>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    try {
                      const sel = await openDialog({
                        directory: true,
                        multiple: false,
                        title: "Choose where to create the project",
                      });
                      if (typeof sel === "string") setLocation(sel);
                    } catch (e) {
                      setErr(String(e));
                    }
                  })();
                }}
              >
                Choose…
              </button>
              {location && (
                <button className="btn" disabled={busy} onClick={() => setLocation(null)}>
                  Reset
                </button>
              )}
            </span>
          </label>
        </details>

        {/* Doctrine 3: an estimate is a chip, and a FREE selection shows $0 on
            that chip — it never raises the accent spend card. */}
        <div className="cost-box">
          <div className="cost-head">
            <span>
              Estimated cost{!anyPaid && <span className="cost-free"> · free preview</span>}
            </span>
            <strong data-testid="estimate">
              {est ? (anyPaid ? fmtRange(est.total_usd) : "$0") : "…"}
            </strong>
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
              $0 — every generator is free ({est.assets.images.count} placeholder images).
            </div>
          )}
        </div>
        {keyGate && (
          <div className="np-err" data-testid="key-gate">
            Can't run these generators: {keyGate}.{" "}
            <button
              className="btn"
              disabled={!SETTINGS_KEYS_SCREEN}
              data-testid="key-gate-link"
              data-focus-var={keyGateVar ?? ""}
              onClick={() => openProviderKeys(keyGateVar)}
              title={
                keyGateVar
                  ? `Open Settings → API keys, on ${keyGateVar}`
                  : "Open Settings → API keys"
              }
            >
              Settings → API keys
            </button>
          </div>
        )}
        {err && <div className="np-err">{err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={() => setStep(1)} disabled={busy}>
            Back
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn pri"
            onClick={() => void create()}
            disabled={busy || !template || !!keyGate}
            title={keyGate ? `Can't run these generators: ${keyGate}` : undefined}
          >
            {busy ? "Starting…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
