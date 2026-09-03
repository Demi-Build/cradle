import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ProviderKeyStatus,
  type ProviderKeyVar,
  type ProviderRow,
  type ProviderTestResult,
} from "../../lib/invoke";
import { providerRows, resetProviderRows } from "../../lib/providerKeys";
import { useStore } from "../../store";

/** Settings → **API keys** (row P0-12; Phase 0 W3.4–W3.5, pattern build per
 *  master §8 Q7).
 *
 *  **Rows are DATA.** Every row on this pane comes from `canon providers list`
 *  (master §6 S6, superseding W3.4's "fixed six provider rows"), so adding a
 *  provider is adding a row in `canon/providers.py` and nothing here changes.
 *  That is also why the six September providers, `MESHY_API_KEY` and Phase 1's
 *  chat-provider keys all render from the same loop.
 *
 *  **The paste field is write-only.** A stored value never comes back: no
 *  command returns one, this component never holds one after `Save`, and the
 *  status read carries names and sources only — not a masked value, not a
 *  length. The field is cleared in the same tick it is submitted.
 *
 *  **The Test button is user-initiated and named.** It runs the cheapest
 *  authenticated ping the row declares — a free read-only list call, never a
 *  generation (doctrine 3: paid legs are user-run, and a key check that billed
 *  would be a paid leg cradle started). Its copy says, before you click, that
 *  clicking contacts that provider and costs effectively nothing. A row whose
 *  provider publishes no free endpoint renders the button disabled WITH that
 *  reason (doctrine 4), never hidden.
 *
 *  **Deep links land on a row.** `settings.focusVar` is the offending variable
 *  from whichever refusal opened this screen — the create wizard's precheck,
 *  the entity path's gate, the model picker, the agent's missing-key card. */
export function KeysPane() {
  const focusVar = useStore((s) => s.settings.focusVar);
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [status, setStatus] = useState<ProviderKeyStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const doc = await providerRows();
      setRows(doc.providers);
      const names = doc.providers.flatMap((r) => [r.env_var, ...r.aliases]);
      setStatus(await api.providerKeys(names));
      setErr(null);
    } catch (e) {
      setErr(String(e).slice(0, 400));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The deep link's whole point: land ON the row, not merely on the screen.
  // `scrollIntoView` is guarded because jsdom does not implement it — the
  // focused-row STYLING is the part under test, and it must not depend on a
  // browser-only method existing.
  useEffect(() => {
    if (rows && focusVar) focusRef.current?.scrollIntoView?.({ block: "center" });
  }, [rows, focusVar]);

  const byName = useMemo(() => {
    const map = new Map<string, ProviderKeyStatus["vars"][number]>();
    for (const v of status?.vars ?? []) map.set(v.name, v);
    return map;
  }, [status]);

  if (err && !rows) {
    return (
      <section data-testid="keys-pane">
        <PaneHead />
        <div className="np-err" data-testid="keys-error">
          cradle could not read the provider rows from canon: {err}
        </div>
        {/* Doctrine 4: a dead end gets a way out. The rows are cached for the
            session, so retrying has to drop the cache first or it re-awaits
            the same failure. */}
        <button
          className="btn"
          data-testid="keys-retry"
          onClick={() => {
            resetProviderRows();
            void load();
          }}
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section data-testid="keys-pane">
      <PaneHead />
      {status?.warning && (
        <div className="np-err" data-testid="keys-store-warning">
          ⚠ {status.warning}
        </div>
      )}
      {status?.backend === "keychain" && (
        <p style={note} data-testid="keys-store-note">
          Keys are stored in this machine's OS keychain under the service name <code>cradle</code>,
          and injected into canon only when it runs. On macOS the first access shows a keychain
          permission prompt for this app — that prompt is expected, not a failure; a signed build
          asks once.
        </p>
      )}
      {err && (
        <div className="np-err" data-testid="keys-error">
          {err}
        </div>
      )}
      {(rows ?? []).map((row) => (
        <KeyRow
          key={row.id}
          row={row}
          status={byName.get(row.env_var)}
          aliasStatus={row.aliases.map((a) => byName.get(a)).find((v) => v?.set)}
          focused={!!focusVar && (focusVar === row.env_var || row.aliases.includes(focusVar))}
          anchor={
            !!focusVar && (focusVar === row.env_var || row.aliases.includes(focusVar))
              ? focusRef
              : undefined
          }
          onChanged={load}
          onError={setErr}
        />
      ))}
      {rows?.length === 0 && <p style={note}>This canon build declares no provider rows.</p>}
    </section>
  );
}

function PaneHead() {
  return (
    <>
      <h3 style={{ margin: "0 0 4px" }}>API keys</h3>
      <p style={note}>
        A key is per machine, never part of a project — copying a project never copies its keys.
        Cradle stores each one in the OS keychain and hands it to canon as an environment variable
        when a job runs. Values are write-only: nothing here can show you a key again.
      </p>
    </>
  );
}

function KeyRow({
  row,
  status,
  aliasStatus,
  focused,
  anchor,
  onChanged,
  onError,
}: {
  row: ProviderRow;
  status?: ProviderKeyVar;
  aliasStatus?: ProviderKeyVar;
  focused: boolean;
  anchor?: React.RefObject<HTMLDivElement | null>;
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  // The paste field's value lives ONLY here, only until Save, and is wiped in
  // the same handler that submits it. Nothing reads it back.
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<ProviderTestResult | null>(null);
  const effective = status?.set ? status : aliasStatus?.set ? aliasStatus : status;
  const isSet = !!effective?.set;
  // Stored in cradle's own store but not retrievable on this machine: the chip
  // must not read "set", or the missing-key gate passes and the job dies inside
  // canon instead of here.
  const unreadable = !isSet && (!!status?.unreadable || !!aliasStatus?.unreadable);
  // Remove reaches cradle's OWN store and nothing else. A value that comes
  // from the shell or an env file cannot be withdrawn from here, so the button
  // is disabled WITH the reason rather than silently no-opping (doctrine 4).
  const ownsValue =
    effective?.source === "keychain" || effective?.source === "fallback_file" || unreadable;
  const removeWhy = ownsValue
    ? `Forget ${effective?.name ?? row.env_var} on this machine`
    : isSet
      ? `${effective?.name ?? row.env_var} comes from ${sourceLabel(effective?.source)}, not from cradle's store — unset it there`
      : "nothing stored";

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    onError(null);
    try {
      await api.setProviderKey(row.env_var, draft);
      setDraft(""); // write-only: the value does not survive the save
      setTest(null);
      await onChanged();
    } catch (e) {
      onError(String(e).slice(0, 400));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    setBusy(true);
    onError(null);
    try {
      await api.deleteProviderKey(name);
      setTest(null);
      await onChanged();
    } catch (e) {
      onError(String(e).slice(0, 400));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await api.testProviderKey(row.id));
    } catch (e) {
      setTest({
        id: row.id,
        ran: false,
        ok: false,
        status: null,
        reason: String(e).slice(0, 200),
      });
    } finally {
      setBusy(false);
    }
  };

  const testable = !!row.test && isSet;
  const testWhy = !row.test
    ? `${row.label} publishes no free authenticated endpoint — a test would have to run a paid generation, which this button never does.`
    : !isSet
      ? "no key stored yet"
      : `Contacts ${row.label} with one free, read-only call. No generation, no tokens: effectively $0.`;

  return (
    <div
      ref={anchor}
      data-testid="key-row"
      data-provider={row.id}
      data-var={row.env_var}
      data-focused={focused ? "1" : "0"}
      style={{
        border: `1px solid ${focused ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 10,
        background: "var(--bg-sunken)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong>{row.label}</strong>
        <code style={{ fontSize: 11, opacity: 0.8 }}>{row.env_var}</code>
        <span
          data-testid="key-chip"
          data-set={isSet ? "1" : "0"}
          data-source={effective?.source ?? ""}
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 7px",
            borderRadius: 999,
            background: isSet ? "var(--accent)" : "transparent",
            color: isSet ? "var(--accent-ink)" : "var(--fg)",
            border: isSet ? "none" : "1px solid var(--border)",
            opacity: isSet ? 1 : 0.7,
          }}
        >
          {isSet
            ? `set · ${sourceLabel(effective?.source)}`
            : unreadable
              ? "unreadable"
              : "not set"}
        </span>
        <div style={{ flex: 1 }} />
        <a href={row.docs} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
          get a key ↗
        </a>
      </div>
      <div style={{ ...note, margin: "4px 0 0" }}>{row.unlocks}</div>
      {row.note && (
        <div style={{ ...note, margin: "3px 0 0" }} data-testid="key-note">
          {row.note}
        </div>
      )}
      {isSet && aliasStatus?.set && aliasStatus.name !== row.env_var && (
        <div style={{ ...note, margin: "3px 0 0" }} data-testid="key-alias-note">
          Stored under <code>{aliasStatus.name}</code> — canon accepts it as{" "}
          <code>{row.env_var}</code>.
        </div>
      )}
      {unreadable && (
        <div style={{ ...note, margin: "3px 0 0" }} data-testid="key-unreadable">
          Stored here, but this machine will not release it — the item was removed outside cradle,
          or the OS is refusing this build access to it. Canon would receive nothing, so paste the
          key again to replace it.
        </div>
      )}
      {!!effective?.also_in?.length && (
        <div style={{ ...note, margin: "3px 0 0" }} data-testid="key-also-in">
          Also present in: {effective.also_in.map(sourceLabel).join(", ")} —{" "}
          {sourceLabel(effective.source)} is what canon gets.
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isSet ? "paste a new key to replace it" : `paste your ${row.label} key`}
          aria-label={`${row.env_var} value`}
          data-testid="key-input"
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1, minWidth: 180 }}
        />
        <button
          className="btn pri"
          onClick={() => void save()}
          disabled={busy || !draft.trim()}
          data-testid="key-save"
        >
          Save
        </button>
        <button
          className="btn"
          onClick={() => void runTest()}
          disabled={busy || !testable}
          title={testWhy}
          data-testid="key-test"
        >
          Test
        </button>
        <button
          className="btn dang"
          onClick={() => void remove(effective?.name ?? row.env_var)}
          disabled={busy || !ownsValue}
          title={removeWhy}
          data-testid="key-remove"
        >
          Remove
        </button>
      </div>
      <div style={{ ...note, margin: "5px 0 0" }} data-testid="key-test-why">
        {testWhy}
      </div>
      {test && (
        <div
          style={{ ...note, margin: "4px 0 0", color: test.ok ? undefined : "var(--err)" }}
          data-testid="key-test-result"
          data-ok={test.ok ? "1" : "0"}
        >
          {test.ok ? "✓ " : "✕ "}
          {test.reason}
        </div>
      )}
    </div>
  );
}

function sourceLabel(source: string | null | undefined): string {
  return (
    {
      keychain: "the OS keychain",
      fallback_file: "cradle's unencrypted fallback file",
      env: "this machine's environment",
      env_file: "the env file",
    }[source ?? ""] ??
    (source || "unknown")
  );
}

const note: React.CSSProperties = { fontSize: 11.5, opacity: 0.72, lineHeight: 1.5 };
