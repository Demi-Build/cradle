import { useCallback, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../../store";
import { api } from "../../lib/invoke";
import { relativeTimeFrom } from "../../lib/recents";
import { IconSymbols } from "./Icons";
import { StartTitleBar } from "./StartTitleBar";
import { StartStatusBar } from "./StartStatusBar";
import { ReturningHero } from "./ReturningHero";
import { RecentsRail } from "./RecentsRail";
import { FirstRunCard } from "./FirstRunCard";
import { NotesDrawer } from "./NotesDrawer";
import { StartAgentPanel } from "../agent/StartAgentPanel";
import { LiveProjectCard } from "./LiveProjectCard";

export function StartScreen() {
  const recents = useStore((s) => s.recents);
  const setError = useStore((s) => s.setError);
  const loadWorldByPath = useStore((s) => s.loadWorldByPath);
  const enrichRecent = useStore((s) => s.enrichRecent);
  const setNewProjectOpen = useStore((s) => s.setNewProjectOpen);
  const openNewProject = useCallback(() => setNewProjectOpen(true), [setNewProjectOpen]);

  const mode = recents.length > 0 ? "returning" : "firstrun";
  const last = recents[0];
  // Row A9: the panel column, over the hero (agent-panel README §11). It is
  // ALWAYS present here — with no project open the column IS this page's way
  // to make one, and `agentUi.open` is the EDITOR's third-column preference
  // (the toggle that sets it lives in the editor's TopBar, which this page
  // does not have). `collapsed` still applies, so the 40px rail is how you
  // get it out of the way, and its own expand button brings it back.
  const agentUi = useStore((s) => s.agentUi);
  const agentState = agentUi.collapsed ? "rail" : "open";

  useEffect(() => {
    for (const r of recents) {
      if (
        r.startPortrait === undefined ||
        r.primaryEnv === undefined ||
        typeof r.seed !== "number"
      ) {
        enrichRecent(r.path);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const statusNote =
    mode === "firstrun" ? "no world loaded" : `last opened ${relativeTimeFrom(last.lastOpenedAt)}`;

  const openFromDisk = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select a world directory",
      });
      if (typeof selected === "string") {
        await loadWorldByPath(selected);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [loadWorldByPath, setError]);

  const tryDemo = useCallback(async () => {
    try {
      const demoPath = await api.getBundledDemoPath();
      await loadWorldByPath(demoPath);
    } catch (e) {
      setError(String(e));
    }
  }, [loadWorldByPath, setError]);

  const enterLast = useCallback(async () => {
    if (!last) return;
    try {
      await loadWorldByPath(last.path);
    } catch (e) {
      setError(String(e));
    }
  }, [last, loadWorldByPath, setError]);

  return (
    // Row A9: `data-agent` gives the hero room for the column, exactly the way
    // the editor shell does it (`App`'s `data-agent`). The panel itself is
    // mounted below — additively; nothing else on this page changed.
    <div
      className="start-app"
      data-mode={mode}
      data-agent={agentState}
      style={{ ["--agent-w" as string]: `${agentUi.width}px` } as React.CSSProperties}
    >
      <IconSymbols />
      <StartTitleBar here="start" />

      <main className="atmo">
        <section className="atmo-hero">
          {mode === "returning" && last && (
            <ReturningHero
              last={last}
              onEnter={enterLast}
              onOpenAnother={openFromDisk}
              onNewProject={openNewProject}
            />
          )}
          {mode === "firstrun" && (
            <>
              <FirstRunCard
                onOpenFromDisk={openFromDisk}
                onTryDemo={tryDemo}
                onNewProject={openNewProject}
              />
              {/* Row A9: no rail on a first run, but a project being created
                  still needs its live card. */}
              <LiveProjectCard />
            </>
          )}
        </section>

        {mode === "returning" && (
          <RecentsRail
            recents={recents}
            excludePath={last?.path}
            onOpenRecent={(p) => loadWorldByPath(p)}
            onAddNew={openNewProject}
            onOpenFromDisk={openFromDisk}
          />
        )}
      </main>

      <StartAgentPanel />

      <StartStatusBar note={statusNote} />
      <NotesDrawer />
    </div>
  );
}
