import { useCallback, useEffect, useState } from "react";
import { api, type RuntimeStatus } from "./invoke";

/**
 * Row P0-11 / W3.6 — the STARTUP PROBE.
 *
 * Probes the resolved canon once at launch (a cheap `canon --version`) so a
 * machine that cannot run canon says so on a guided screen
 * (`components/RuntimeGate`) instead of dying at the first verb with a raw
 * "No such file or directory" that names neither what was tried nor what to
 * do. It lives beside `useDraggablePanel` rather than in the component file
 * so that file exports only a component (react-refresh).
 *
 * Deliberately NOT a blocking splash: the probe runs while the app renders
 * and only a FAILED probe takes the window, so a working machine never sees a
 * flash. Doctrine 5 holds trivially — "checking…" with no bar and no ETA is
 * the whole truth about a one-shot probe.
 */

/** What the gate knows. `undefined` while the first probe is in flight. */
export type RuntimeProbe = {
  status: RuntimeStatus | undefined;
  /** True only once a probe has come back and said the runtime is unusable. */
  blocked: boolean;
  checking: boolean;
  retry: () => void;
};

export function useRuntimeProbe(): RuntimeProbe {
  const [status, setStatus] = useState<RuntimeStatus | undefined>();
  const [checking, setChecking] = useState(true);

  const run = useCallback(() => {
    setChecking(true);
    api
      .runtimeStatus()
      .then((s) => setStatus(s))
      .catch((e: unknown) =>
        // The probe command itself failing is still a probe result: report it
        // in the same shape rather than swallowing it into a silent app.
        setStatus({
          ok: false,
          origin: "unknown",
          command: "canon",
          triple: "",
          resource_dir: null,
          legs: [],
          version: null,
          error: `cradle could not run its own startup probe: ${String(e)}`,
        }),
      )
      .finally(() => setChecking(false));
  }, []);

  useEffect(run, [run]);

  return { status, blocked: status?.ok === false, checking, retry: run };
}
