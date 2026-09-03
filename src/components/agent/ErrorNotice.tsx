import type { ErrorItem } from "../../lib/agentState";
import type { ServiceState } from "../../lib/agent";
import { retryLast, retryService } from "../../lib/agentActions";
import { lookedInPhrase, providerLabel } from "./providerCopy";
import { openProviderKeys } from "../../lib/providerKeys";
import { useElapsed } from "./useElapsed";
import { fmtDuration } from "../../lib/agentState";
import { useStore } from "../../store";

/** The four error shapes (README §3, the states table). Each names what
 *  broke, where the app looked, and the one action that fixes it. Raw stderr
 *  is always behind a `▸ show stderr` line. */

/** "Service starting…" — non-blocking, with elapsed; the composer stays
 *  enabled and queues. */
export function ServiceStarting({ service }: { service: ServiceState }) {
  const elapsed = useElapsed(service.startedAt ?? Date.now());
  return (
    <div className="ag-error starting" data-testid="err-starting">
      <div className="h">
        <span>Starting the agent service…</span>
        <span className="elapsed">{fmtDuration(elapsed)}</span>
      </div>
    </div>
  );
}

/** "The agent service didn't start" — names the command and the port. */
export function ServiceFailed({ service }: { service: ServiceState }) {
  const port = service.port ?? "a free port";
  return (
    <div className="ag-error" data-testid="err-service">
      <div className="h">✕ The agent service didn't start</div>
      <div className="d">
        Cradle launches <code>{service.command ?? "canon agent serve"}</code> on port {port}.{" "}
        {service.error ?? "Nothing answered."}
      </div>
      <div className="ag-card-actions">
        <button className="ag-btn primary" onClick={() => void retryService()}>
          Retry
        </button>
        <button className="ag-btn" onClick={() => openLogs(service)}>
          Open logs
        </button>
      </div>
      <Stderr lines={service.stderr} />
    </div>
  );
}

function openLogs(service: ServiceState) {
  const text = service.stderr.join("\n") || "(no stderr captured)";
  try {
    const w = window.open("", "_blank", "noopener");
    if (w) {
      w.document.title = "agent service log";
      w.document.body.innerHTML = `<pre style="font:11px/1.4 monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
    }
  } catch {}
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function Stderr({ lines, text }: { lines?: string[]; text?: string }) {
  const body = text ?? lines?.join("\n") ?? "";
  const n = body ? body.split("\n").length : 0;
  return (
    <details>
      <summary>▸ show stderr{n ? ` (${n} line${n === 1 ? "" : "s"})` : ""}</summary>
      <pre>{body || "(nothing on stderr)"}</pre>
    </details>
  );
}

/** A transcript error item — missing key, provider mid-stream, generic. */
export function ErrorNotice({ item, conversationId }: { item: ErrorItem; conversationId: string }) {
  const models = useStore((s) => s.agent.models);
  if (item.variant === "missing_key") {
    const provider = item.provider ?? providerOf(item.keyEnv);
    const alt = item.alt?.model ?? models.find((m) => m.available && m.provider !== provider)?.id;

    return (
      <div className="ag-error nokey" data-testid="err-nokey">
        <div className="h">⚠ No key for {providerLabel(provider)}</div>
        <div className="d">
          <code>missing {item.keyEnv ?? "the provider key"}</code> — {lookedInPhrase(item.lookedIn)}
          .
          <br />
          Add the key, or switch this conversation to a provider you have one for.
        </div>
        <div className="ag-card-actions">
          {/* Row P0-12: the paid/missing-key card's deep link. It carries the
              variable the service named, so Settings opens ON that row. */}
          <button
            className="ag-btn primary"
            data-testid="nokey-add-key"
            data-focus-var={item.keyEnv ?? ""}
            onClick={() => openProviderKeys(item.keyEnv)}
            title={
              item.keyEnv
                ? `Open Settings → API keys, on ${item.keyEnv}`
                : "Open Settings → API keys"
            }
          >
            Add key in Settings
          </button>
          {alt && (
            <button className="ag-btn" onClick={() => void retryLast(conversationId, alt)}>
              Use {alt} instead
            </button>
          )}
        </div>
      </div>
    );
  }
  if (item.variant === "service") {
    return (
      <div className="ag-error" data-testid="err-service-turn">
        <div className="h">✕ The agent service went away</div>
        <div className="d">{item.message}</div>
        <div className="ag-card-actions">
          <button
            className="ag-btn primary"
            onClick={() => void retryService().then(() => retryLast(conversationId))}
          >
            Retry
          </button>
        </div>
        {item.stderr && <Stderr text={item.stderr} />}
      </div>
    );
  }
  const alt =
    item.alt?.model ??
    models.find(
      (m) => m.available && m.provider === (item.provider ?? "anthropic") && m.output_per_1m < 10,
    )?.id;
  return (
    <div className="ag-error" data-testid="err-provider">
      {item.partialKept && <div className="cut" />}
      <div className="h">✕ Reply cut off. {item.message}</div>
      <div className="d">
        {item.nothingWritten
          ? "Nothing was written."
          : "Some writes landed before the cut — see the cards above."}
        {item.partialKept ? " The partial text above is kept for reference." : ""}
      </div>
      <div className="ag-card-actions">
        <button className="ag-btn primary" onClick={() => void retryLast(conversationId)}>
          Retry
        </button>
        {alt && (
          <button className="ag-btn" onClick={() => void retryLast(conversationId, alt)}>
            Retry on {alt}
          </button>
        )}
      </div>
      {item.stderr && <Stderr text={item.stderr} />}
    </div>
  );
}

function providerOf(keyEnv?: string): string {
  if (!keyEnv) return "the provider";
  if (keyEnv.startsWith("ANTHROPIC")) return "anthropic";
  if (keyEnv.startsWith("OPENAI")) return "openai";
  if (keyEnv.startsWith("MOONSHOT")) return "kimi";
  return keyEnv.replace(/_API_KEY$/, "").toLowerCase();
}
