import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ProviderKeyVar,
  type ProviderRow,
  type ProviderTestResult,
} from "../../lib/invoke";
import {
  createProviderKeyFile,
  providerKeyStatus,
  providerRows,
  resetProviderRows,
  type KeyFileStatus,
} from "../../lib/providerKeys";
import { useStore } from "../../store";

/** Settings → **API keys**.
 *
 *  **One source: the key file.** Every key cradle hands to canon comes from
 *  one plain `KEY=VALUE` file on this machine — never from the shell, never
 *  from a keychain. This pane shows WHERE that file is, whether each row's
 *  key is present in it, and writes to it: Save rewrites that one line
 *  (other lines and comments survive), Remove deletes it. When the file does
 *  not exist yet the pane says so and offers to create it; a read never
 *  creates it on its own.
 *
 *  **Rows are DATA.** Every row on this pane comes from `canon providers
 *  list`, so adding a provider is adding a row in canon and nothing here
 *  changes.
 *
 *  **The paste field is write-only.** A stored value never comes back: no
 *  command returns one, this component never holds one after `Save`, and the
 *  status read carries names and presence only — not a masked value, not a
 *  length. The field is cleared in the same tick it is submitted.
 *
 *  **The Test button is user-initiated and named.** It runs the cheapest
 *  authenticated ping the row declares — a free read-only list call, never a
 *  generation. Its copy says, before you click, that clicking contacts that
 *  provider and costs effectively nothing; its result says which file the
 *  key came from. A row whose provider publishes no free endpoint renders the
 *  button disabled WITH that reason, never hidden.
 *
 *  **Deep links land on a row.** `settings.focusVar` is the offending variable
 *  from whichever refusal opened this screen — the create wizard's precheck,
 *  the entity path's gate, the model picker, the agent's missing-key card. */
export function KeysPane() {
  const focusVar = useStore((s) => s.settings.focusVar);
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [status, setStatus] = useState<KeyFileStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const focusRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const doc = await providerRows();
      setRows(doc.providers);
      const names = doc.providers.flatMap((r) => [r.env_var, ...r.aliases]);
      setStatus(await providerKeyStatus(names));
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
    const map = new Map<string, ProviderKeyVar>();
    for (const v of status?.vars ?? []) map.set(v.name, v);
    return map;
  }, [status]);

  const createFile = async () => {
    setCreating(true);
    setErr(null);
    try {
      await createProviderKeyFile();
      await load();
    } catch (e) {
      setErr(String(e).slice(0, 400));
    } finally {
      setCreating(false);
    }
  };

  if (err && !rows) {
    return (
      <section data-testid="keys-pane">
        <PaneHead />
        <div className="np-err" data-testid="keys-error">
          cradle could not read the provider rows from canon: {err}
        </div>
        {/* A dead end gets a way out. The rows are cached for the session, so
            retrying has to drop the cache first or it re-awaits the same
            failure. */}
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
      {status && <FileNote status={status} creating={creating} onCreate={createFile} />}
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
          filePath={status?.env_file ?? null}
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
        Cradle keeps them in one plain file and hands each one to canon as an environment variable
        only when it runs. Values are write-only here: nothing on this screen can show you a key
        again.
      </p>
    </>
  );
}

/** Where the keys live — the one fact a user needs to trust this screen — in
 *  one of three states: no resolvable file (an error with a way out), a file
 *  that does not exist yet (first use, with the one action that creates it),
 *  or the file itself, named. Calm copy on the intended path: a plain file
 *  readable by your user account is the design, not a fallback. */
function FileNote({
  status,
  creating,
  onCreate,
}: {
  status: KeyFileStatus;
  creating: boolean;
  onCreate: () => Promise<void>;
}) {
  if (!status.env_file) {
    return (
      <div className="np-err" data-testid="keys-store-warning">
        {status.warning ?? "cradle has no place to keep provider keys on this machine."}
      </div>
    );
  }
  if (status.env_file_exists === false) {
    return (
      <div
        data-testid="keys-file-missing"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 12,
          background: "var(--bg-sunken)",
        }}
      >
        <strong style={{ display: "block", marginBottom: 4 }}>No key file yet</strong>
        <div style={note}>
          Cradle will keep your keys in{" "}
          <code data-testid="keys-file-path" style={{ wordBreak: "break-all" }}>
            {status.env_file}
          </code>
          . It does not exist on this machine yet — create it here, or save a key below and it is
          created for you. Either way it is a plain file readable by your user account, one
          <code> KEY=VALUE</code> per line, and you can edit it by hand.
        </div>
        <button
          className="btn pri"
          style={{ marginTop: 8 }}
          onClick={() => void onCreate()}
          disabled={creating}
          data-testid="keys-create-file"
        >
          Create the key file
        </button>
      </div>
    );
  }
  return (
    <p style={note} data-testid="keys-store-note">
      Your keys live in{" "}
      <code data-testid="keys-file-path" style={{ wordBreak: "break-all" }}>
        {status.env_file}
      </code>
      — a plain file readable by your user account, one <code>KEY=VALUE</code> per line. That file
      is the only place cradle reads a key from: not your shell, not a keychain. Change it here or
      by hand; either way, what is in the file is what canon gets.
    </p>
  );
}

function KeyRow({
  row,
  status,
  aliasStatus,
  filePath,
  focused,
  anchor,
  onChanged,
  onError,
}: {
  row: ProviderRow;
  status?: ProviderKeyVar;
  aliasStatus?: ProviderKeyVar;
  filePath: string | null;
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
  const holder = effective?.name ?? row.env_var;
  const fileLabel = filePath ?? "the key file";
  // The file is the only source, so a key that is set is a key Remove can
  // delete. Disabled WITH the reason otherwise, never hidden.
  const removeWhy = isSet ? `Delete ${holder} from ${fileLabel}` : "nothing stored";

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
    onError(null);
    try {
      setTest(await api.testProviderKey(row.id));
    } catch (e) {
      onError(String(e).slice(0, 400));
    } finally {
      setBusy(false);
    }
  };

  const testable = !!row.test && isSet;
  const testWhy = !row.test
    ? `${row.label} publishes no free authenticated endpoint — a test would have to run a paid generation, which this button never does.`
    : !isSet
      ? "no key stored yet"
      : `Contacts ${row.label} with one free, read-only call using the key in ${fileLabel}. No generation, no tokens: effectively $0.`;

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
          {isSet ? `set · ${sourceLabel(effective?.source)}` : "not set"}
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
          onClick={() => void remove(holder)}
          disabled={busy || !isSet}
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
          {test.ran ? ` — tested with the key in ${fileLabel}` : ""}
        </div>
      )}
    </div>
  );
}

function sourceLabel(source: string | null | undefined): string {
  return { env_file: "in the key file" }[source ?? ""] ?? (source || "unknown");
}

const note: React.CSSProperties = { fontSize: 11.5, opacity: 0.72, lineHeight: 1.5 };
