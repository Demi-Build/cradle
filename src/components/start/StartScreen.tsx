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

export function StartScreen() {
  const recents = useStore((s) => s.recents);
  const setError = useStore((s) => s.setError);
  const loadWorldByPath = useStore((s) => s.loadWorldByPath);
  const enrichRecent = useStore((s) => s.enrichRecent);

  const mode = recents.length > 0 ? "returning" : "firstrun";
  const last = recents[0];

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
    <div className="start-app" data-mode={mode}>
      <IconSymbols />
      <StartTitleBar here="start" />

      <main className="atmo">
        <section className="atmo-hero">
          {mode === "returning" && last && (
            <ReturningHero last={last} onEnter={enterLast} onOpenAnother={openFromDisk} />
          )}
          {mode === "firstrun" && (
            <FirstRunCard onOpenFromDisk={openFromDisk} onTryDemo={tryDemo} />
          )}
        </section>

        {mode === "returning" && (
          <RecentsRail
            recents={recents}
            onOpenRecent={(p) => loadWorldByPath(p)}
            onAddNew={openFromDisk}
          />
        )}
      </main>

      <StartStatusBar note={statusNote} />
      <NotesDrawer />
    </div>
  );
}
