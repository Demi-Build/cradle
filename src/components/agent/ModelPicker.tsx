import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../../lib/agentState";
import type { ModelInfo } from "../../lib/agent";
import { setModel } from "../../lib/agentActions";
import { useStore } from "../../store";
import { providerLabel, unavailableReason } from "./providerCopy";
import { openProviderKeys } from "../../lib/providerKeys";

/** The model picker (README §9): mono, shows the current model; the menu
 *  groups by provider, lists in/out per 1M for every entry, keeps
 *  unavailable entries in place at 50% with the reason and `Add key`. Ids
 *  are data from `GET /models`.
 *
 *  The pick REACHES the service through `setModel` → the sidecar's
 *  `--backend` / `--model` on the next send (see `agentActions.setModel`
 *  for the declared narrowing: the sidecar is per pack until A4.5 carries a
 *  model on the conversation). */
export function ModelPicker({ conversation }: { conversation: Conversation }) {
  const models = useStore((s) => s.agent.models);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const byProvider = new Map<string, ModelInfo[]>();
  for (const m of models) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m]);
  const current = models.find((m) => m.id === conversation.model);
  return (
    <div ref={ref} style={{ position: "static" }}>
      <button
        className="ag-model"
        onClick={() => setOpen((v) => !v)}
        title="Model for this conversation"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {current?.label ?? conversation.model ?? "model"} ▾
      </button>
      {open && (
        <div className="ag-model-menu" role="menu" data-testid="model-menu">
          <div className="ag-model-head">
            <span>model</span>
            <span>in / out per 1M</span>
          </div>
          {[...byProvider.entries()].map(([provider, list]) => (
            <div key={provider}>
              <div className="ag-model-prov">{providerLabel(provider)}</div>
              {list.map((m) => (
                <div key={m.id}>
                  <button
                    className="ag-model-row"
                    data-on={m.id === conversation.model ? "1" : "0"}
                    data-unavailable={m.available ? "0" : "1"}
                    disabled={!m.available}
                    title={m.available ? undefined : unavailableReason(m)}
                    onClick={() => {
                      void setModel(conversation.id, m.id);
                      setOpen(false);
                    }}
                    role="menuitem"
                  >
                    <span>{m.label}</span>
                    {m.reasoning && <span className="ag-badge read">reasoning</span>}
                    <span className="price">
                      ${m.input_per_1m.toFixed(2)} / ${m.output_per_1m.toFixed(2)}
                    </span>
                  </button>
                  {!m.available && (
                    <div className="ag-model-reason" data-testid="model-reason">
                      <span>⚠ {unavailableReason(m)}</span>
                      {/* Row P0-12: the real destination. `key_env` is the
                          service's own name for the variable, so the deep
                          link lands on that row of Settings → API keys —
                          before this row it opened the cost dashboard, which
                          only NAMED the key sources. */}
                      <button
                        className="btn-link"
                        data-testid="model-add-key"
                        data-focus-var={m.key_env ?? ""}
                        onClick={() => openProviderKeys(m.key_env)}
                      >
                        Add key
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {models.length === 0 && (
            <div className="ag-menu-foot">The service has not listed its models yet.</div>
          )}
          <div className="ag-model-foot">
            Model applies to this conversation. Generation backends are priced separately on each
            paid card.
          </div>
        </div>
      )}
    </div>
  );
}
