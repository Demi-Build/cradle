import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";

/** Pick a world directory and load it.
 *
 *  One definition, because there are now three entry points — the start
 *  screen, the recents page, and the ⌘O/Ctrl+O shortcut — and they had drifted
 *  (only one passed a dialog title). Reads the store directly rather than
 *  taking callbacks so a keyboard handler can call it without prop-drilling.
 */
export async function pickAndOpenWorld(): Promise<void> {
  const { loadWorldByPath, setError } = useStore.getState();
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Select a world directory",
    });
    if (typeof selected === "string") await loadWorldByPath(selected);
  } catch (e) {
    setError(String(e));
  }
}
