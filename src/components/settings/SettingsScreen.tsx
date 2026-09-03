import { useEffect } from "react";
import { useStore } from "../../store";
import { KeysPane } from "./KeysPane";
import { EnvironmentPane } from "./EnvironmentPane";
import { PermissionsPane } from "./PermissionsPane";

/** The Settings screen (row P0-12; Phase 0 W3.5, a PATTERN build per master
 *  §8 Q7 — "Settings pattern-builds now; any later design pass is user-led").
 *
 *  Small and real, in W3.5's words: a gear in the TopBar plus deep links from
 *  every "missing key" refusal, and panes that already existed conceptually.
 *  It uses the overlay+card idiom `CostDashboard`, `JobTray` and A6's
 *  `PermissionsOverlay` already use, and `App.css`/tokens win over anything
 *  bespoke (doctrine 9).
 *
 *  Three panes:
 *  1. **API keys** — W3.4's rows, now DATA from `canon providers list`.
 *  2. **Environment** — effective canon, Godot, `BLENDER_BIN`, project store.
 *  3. **Permissions** — A6 built `PermissionsPane` for this screen and parked
 *     it under a temporary overlay that said, in its own docstring, "when
 *     P0-12 lands, this file is deleted and the pane moves into the Settings
 *     screen unchanged". That is what happened: the pane is MOUNTED here, not
 *     rebuilt, and the overlay is gone.
 *
 *  Theme stays in the TopBar. Nothing else moves (W3.5). */

/** The pane registry — data, so a fourth pane is an entry. `available` keeps a
 *  pane VISIBLE and inert with its reason rather than hiding it (doctrine 4). */
const PANES: { id: string; label: string; needsWorld?: boolean }[] = [
  { id: "keys", label: "API keys" },
  { id: "environment", label: "Environment" },
  { id: "permissions", label: "Permissions", needsWorld: true },
];

export function SettingsScreen() {
  const { pane, focusVar } = useStore((s) => s.settings);
  const openSettings = useStore((s) => s.openSettings);
  const closeSettings = useStore((s) => s.closeSettings);
  const world = useStore((s) => s.world);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSettings]);

  return (
    <div style={overlay} onClick={closeSettings}>
      <div style={card} onClick={(e) => e.stopPropagation()} data-testid="settings-screen">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: 17 }}>Settings</h2>
          <button onClick={closeSettings} style={{ cursor: "pointer" }} aria-label="Close settings">
            ✕
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }} role="tablist">
          {PANES.map((p) => {
            const blocked = p.needsWorld && !world;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={pane === p.id}
                className={`btn${pane === p.id ? " pri" : ""}`}
                data-testid={`settings-tab-${p.id}`}
                disabled={!!blocked}
                title={blocked ? "no project open — grants are per project" : undefined}
                onClick={() => openSettings(p.id, focusVar)}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {pane === "keys" && <KeysPane />}
        {pane === "environment" && <EnvironmentPane />}
        {pane === "permissions" && <PermissionsPane onClose={closeSettings} />}
      </div>
    </div>
  );
}

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
  width: 680,
  maxWidth: "94vw",
  maxHeight: "88vh",
  overflowY: "auto",
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 22,
  color: "var(--fg)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};
