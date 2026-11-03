import { useEffect, useState } from "react";
import { providerKeyStatus, type KeyFileStatus } from "../../lib/providerKeys";
import { useStore } from "../../store";
import { dismissKeySetup, keySetupDismissed } from "./keySetupSession";

/** First run: **add your API keys**.
 *
 *  Provider keys live in one file on this machine and nowhere else — cradle
 *  never reads them from your shell. Until that file exists, the start screen
 *  says so and offers the one way in: Settings → API keys, where entering the
 *  first key creates the file and changing one rewrites just that line.
 *
 *  Shown only when the status read says the file does not exist yet; once
 *  any key is saved the file is there and the card is gone. Free features
 *  need no key, so this is an invitation, not a gate. */
export function KeySetupCard() {
  const openSettings = useStore((s) => s.openSettings);
  // Re-read when Settings closes: saving the first key there creates the
  // file, and the card should be gone when you come back.
  const settingsOpen = useStore((s) => s.settings.open);
  const [status, setStatus] = useState<KeyFileStatus | null>(null);
  const [dismissed, setDismissed] = useState(keySetupDismissed);

  useEffect(() => {
    if (settingsOpen) return;
    let live = true;
    providerKeyStatus([])
      .then((s) => live && setStatus(s))
      .catch(() => {
        /* no canon or the browser mock — nothing to invite to */
      });
    return () => {
      live = false;
    };
  }, [settingsOpen]);

  if (dismissed || !status?.env_file || status.env_file_exists !== false) return null;

  return (
    <div
      data-testid="key-setup-card"
      role="region"
      aria-label="Set up your API keys"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        margin: "0 auto 16px",
        maxWidth: 640,
        background: "var(--bg-sunken)",
      }}
    >
      <strong style={{ display: "block", marginBottom: 4 }}>Add your API keys</strong>
      <p style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.5, margin: 0 }}>
        Paid generation uses your own provider keys. Cradle keeps them in one file on this machine,{" "}
        <code data-testid="key-setup-path" style={{ wordBreak: "break-all" }}>
          {status.env_file}
        </code>
        , and reads them from nowhere else — not your shell. Enter your first key and the file is
        created; free features work without one.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          className="cta-primary"
          data-testid="key-setup-open"
          onClick={() => openSettings("keys")}
        >
          Set up keys
        </button>
        <button
          className="cta-secondary"
          data-testid="key-setup-dismiss"
          onClick={() => {
            dismissKeySetup();
            setDismissed(true);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
