import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RuntimeFailure } from "./RuntimeGate";
import { useRuntimeProbe } from "../lib/useRuntimeProbe";
import type { RuntimeStatus } from "../lib/invoke";

// A plain swappable implementation rather than `vi.fn()`: one of these tests
// makes the probe REJECT, and vitest's settled-result tracking on a mock
// reports that as an unhandled rejection even when the code under test catches
// it. A hand-rolled stub keeps the assertion about cradle, not about vitest.
let probeCalls = 0;
let probeImpl: () => Promise<RuntimeStatus> = () => Promise.resolve(failure());
function stubProbe(impl: () => Promise<RuntimeStatus>) {
  probeImpl = impl;
}
vi.mock("../lib/invoke", async (orig) => {
  const actual = await orig<typeof import("../lib/invoke")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      runtimeStatus: () => {
        probeCalls += 1;
        return probeImpl();
      },
    },
  };
});

/** The shape the Rust probe answers with when nothing resolved. */
function failure(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    ok: false,
    origin: "path",
    command: "canon",
    triple: "aarch64-apple-darwin",
    resource_dir: "/Applications/Cradle.app/Contents/Resources",
    legs: [
      { leg: "env", tried: null, found: false, note: "CANON_BIN is not set." },
      {
        leg: "bundled",
        tried:
          "/Applications/Cradle.app/Contents/Resources/runtime/aarch64-apple-darwin/python/bin/python3",
        found: false,
        note: "no vendored runtime there.",
      },
      { leg: "path", tried: null, found: false, note: "no `canon` on PATH." },
    ],
    version: null,
    error: "`canon --version` could not start: No such file or directory (os error 2)",
    ...overrides,
  };
}

function Probe() {
  const p = useRuntimeProbe();
  return (
    <div>
      <span data-testid="blocked">{String(p.blocked)}</span>
      <span data-testid="checking">{String(p.checking)}</span>
      <button onClick={p.retry}>retry</button>
    </div>
  );
}

describe("the startup probe (row P0-11 / W3.6)", () => {
  // `mockClear`, deliberately not `mockReset`: a reset mock loses vitest's own
  // settled-result tracking, and a mock that returns a REJECTED promise then
  // reports an unhandled rejection even though the code under test catches it.
  // Every test below installs its own implementation, so nothing leaks.
  beforeEach(() => {
    probeCalls = 0;
  });

  it("does not block the app while the probe is in flight", async () => {
    let resolve!: (s: RuntimeStatus) => void;
    const pending = new Promise<RuntimeStatus>((r) => (resolve = r));
    stubProbe(() => pending);
    render(<Probe />);
    // In flight: never "blocked" — a working machine must not see a flash.
    expect(screen.getByTestId("blocked").textContent).toBe("false");
    resolve(failure({ ok: true, error: null }));
    await waitFor(() => expect(screen.getByTestId("checking").textContent).toBe("false"));
    expect(screen.getByTestId("blocked").textContent).toBe("false");
  });

  it("blocks only once a probe has come back unusable", async () => {
    stubProbe(() => Promise.resolve(failure()));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("blocked").textContent).toBe("true"));
  });

  it("a probe that cannot itself run is still reported, never swallowed", async () => {
    stubProbe(() => Promise.reject(new Error("ipc exploded")));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("blocked").textContent).toBe("true"));
  });

  it("Try again re-runs the probe and recovers when the fix lands", async () => {
    let call = 0;
    stubProbe(() => Promise.resolve(call++ === 0 ? failure() : failure({ ok: true, error: null })));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("blocked").textContent).toBe("true"));
    await userEvent.click(screen.getByText("retry"));
    await waitFor(() => expect(screen.getByTestId("blocked").textContent).toBe("false"));
    expect(probeCalls).toBe(2);
  });
});

describe("the guided failure screen", () => {
  it("says what was tried, in what order, and what the probe got back", () => {
    render(<RuntimeFailure status={failure()} checking={false} onRetry={() => {}} />);
    // Every leg, in the resolution order, with its own outcome.
    expect(screen.getByText(/CANON_BIN \(developer override\)/)).toBeInTheDocument();
    expect(screen.getByText(/the runtime bundled with the app/)).toBeInTheDocument();
    expect(screen.getByText(/canon on your PATH/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "/Applications/Cradle.app/Contents/Resources/runtime/aarch64-apple-darwin/python/bin/python3",
      ),
    ).toBeInTheDocument();
    // The raw error is shown, not hidden — it is what a bug report needs.
    expect(screen.getByText(/No such file or directory/)).toBeInTheDocument();
  });

  it("names the CANON_BIN fix only when CANON_BIN is the thing that is wrong", () => {
    const { rerender } = render(
      <RuntimeFailure status={failure()} checking={false} onRetry={() => {}} />,
    );
    expect(screen.queryByText(/CANON_BIN points at nothing/)).toBeNull();
    rerender(
      <RuntimeFailure
        status={failure({
          legs: [
            { leg: "env", tried: "/gone/canon", found: false, note: "set but not there." },
            { leg: "bundled", tried: "/r/runtime", found: true, note: "vendored." },
            { leg: "path", tried: null, found: false, note: "none." },
          ],
        })}
        checking={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/CANON_BIN points at nothing/)).toBeInTheDocument();
    // The bundled runtime IS there, so its advice is not offered.
    expect(screen.queryByText(/The bundled runtime is missing/)).toBeNull();
  });

  it("titles the checkout leg and keeps the numbering the resolver's own", () => {
    render(
      <RuntimeFailure
        status={failure({
          legs: [
            { leg: "env", tried: null, found: false, note: "not set." },
            { leg: "checkout", tried: "/p/canon-ai/.venv", found: false, note: "no virtualenv." },
            { leg: "bundled", tried: "/r/runtime", found: false, note: "not fetched." },
            { leg: "path", tried: null, found: false, note: "none." },
          ],
        })}
        checking={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/2 · a canon checkout beside this one/)).toBeInTheDocument();
    expect(screen.getByText(/3 · the runtime bundled with the app/)).toBeInTheDocument();
    expect(screen.getByText(/4 · canon on your PATH/)).toBeInTheDocument();
    expect(screen.getByText("/p/canon-ai/.venv")).toBeInTheDocument();
  });

  it("disables Try again WITH A REASON while a probe is running (doctrine 4)", () => {
    render(<RuntimeFailure status={failure()} checking onRetry={() => {}} />);
    const btn = screen.getByRole("button", { name: /Checking/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "the probe is running");
    // Honest progress (doctrine 5): elapsed-free, bar-free, no ETA.
    expect(screen.getByText("running canon --version")).toBeInTheDocument();
  });
});
