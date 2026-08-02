// The GLOBAL asset library browser (Library Piece C): entries published from
// any pack, browsable from any project. Scope toggle = all projects vs the
// open pack's project (user-locked §8.1); import copies bytes in with a
// fresh id + durable library_ref (never overwrites). Kinds needing a
// placement target (tile/backdrop/audio) import via CLI --into for now.

import { useCallback, useEffect, useState } from "react";
import { api, type LibraryEntry } from "../../lib/invoke";
import { useStore } from "../../store";

const KINDS = ["", "enemy_def", "item_def", "player_skin", "tile", "backdrop", "audio"];
const DIRECT_IMPORT = new Set(["enemy_def", "item_def", "player_skin"]);

export function LibraryPanel() {
  const worldPath = useStore((s) => s.worldPath);
  const select = useStore((s) => s.select);
  const setEntities = useStore((s) => s.setEntities);
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  // Debounced: every reload is a full CLI round-trip — not per keystroke.
  const [liveQuery, setLiveQuery] = useState("");
  const [scope, setScope] = useState<"all" | "project">("all");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(liveQuery), 300);
    return () => clearTimeout(t);
  }, [liveQuery]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const result = await api.libraryList(
        kind || undefined,
        query || undefined,
        // The PACK PATH — canon matches it against each entry's source.pack
        // (normalized); the world display name is ambiguous across projects.
        scope === "project" ? worldPath : undefined,
      );
      setEntries(result.entries);
    } catch (e) {
      setErr(String(e));
    }
  }, [kind, query, scope, worldPath]);

  useEffect(() => {
    void load();
  }, [load]);

  // Preview thumbnails from the library CAS.
  useEffect(() => {
    if (!entries) return;
    let alive = true;
    (async () => {
      for (const entry of entries) {
        if (!entry.preview || previews[entry.preview]) continue;
        try {
          const obj = await api.libraryCat(entry.preview);
          if (!alive) return;
          setPreviews((p) => ({
            ...p,
            [entry.preview]: `data:image/png;base64,${obj.bytes_b64}`,
          }));
        } catch {
          /* preview optional */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const doImport = async (entry: LibraryEntry) => {
    // The player is a singleton — its import REPLACES art in place (old
    // bytes stay recoverable); defs land under fresh ids.
    const confirmText =
      entry.kind === "player_skin"
        ? `Import "${entry.name}" as this pack's player skin?\n\nReplaces ` +
          "the current player sprite + animation files (the old versions " +
          "stay recoverable in history)."
        : `Import "${entry.name}" (${entry.kind}) into this pack?\n\n` +
          "Bytes are copied in with a fresh id — nothing existing is " +
          "overwritten, and the import carries full source provenance.";
    if (!window.confirm(confirmText)) return;
    setBusy(entry.library_id);
    setNote(null);
    try {
      const result = await api.libraryImport(worldPath, entry.library_id);
      const typeId = entry.kind === "item_def" ? "items" : "enemies";
      if (result.id) {
        try {
          setEntities(typeId, await api.listEntities(worldPath, typeId));
        } catch {}
        select({ kind: "entity", typeId, id: result.id });
      } else {
        setNote(`imported ${entry.name} ✓`);
      }
    } catch (e) {
      setNote(String(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const chip: React.CSSProperties = {
    fontSize: 10.5,
    padding: "1px 8px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    color: "var(--fg-dim)",
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>Asset library</strong>
        <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
          published from any project · imports copy in with fresh ids + provenance
        </span>
        <span style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
          {(["all", "project"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                fontSize: 12,
                padding: "3px 11px",
                border: "none",
                cursor: "pointer",
                background: scope === s ? "var(--accent)" : "transparent",
                color: scope === s ? "var(--accent-ink)" : "var(--fg-muted)",
                fontWeight: scope === s ? 600 : 400,
              }}
            >
              {s === "all" ? "all projects" : "this project"}
            </button>
          ))}
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ fontSize: 12 }}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{k || "all kinds"}</option>
          ))}
        </select>
        <input
          value={liveQuery}
          onChange={(e) => setLiveQuery(e.target.value)}
          placeholder="search…"
          style={{ fontSize: 12, width: 140 }}
        />
      </div>
      {note && (
        <p style={{ fontSize: 12, color: "var(--accent)", margin: "8px 0 0" }}>{note}</p>
      )}
      {err && <p style={{ color: "#e0453a", fontSize: 13 }}>{err}</p>}
      {!entries && !err && <p style={{ fontSize: 13, marginTop: 12 }}>Loading library…</p>}
      {entries && entries.length === 0 && (
        <p style={{ fontSize: 13, marginTop: 12, color: "var(--fg-dim)" }}>
          Nothing here yet — publish an asset with ⬆ from an enemy or item page,
          or `canon library publish` from any pack.
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
          gap: 12,
          marginTop: 14,
        }}
      >
        {(entries ?? []).map((entry) => (
          <div
            key={entry.library_id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 10,
              background: "var(--bg-raised)",
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", gap: 10 }}>
              {entry.preview && previews[entry.preview] ? (
                <img
                  src={previews[entry.preview]}
                  alt={entry.name}
                  style={{
                    width: 64, height: 64, imageRendering: "pixelated",
                    background: "#000", borderRadius: 6, objectFit: "contain",
                  }}
                />
              ) : (
                <span
                  style={{
                    width: 64, height: 64, display: "inline-flex",
                    alignItems: "center", justifyContent: "center",
                    background: "var(--bg-hover)", borderRadius: 6,
                    fontSize: 24,
                  }}
                >
                  {entry.kind === "audio" ? "🎵" : "🖼"}
                </span>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {entry.name}
                </div>
                <div style={{ color: "var(--fg-dim)" }}>{entry.kind}</div>
                <div
                  style={{ color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={entry.source.pack}
                >
                  from {entry.source.world}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              {entry.tags.map((t) => (
                <span key={t} style={chip}>{t}</span>
              ))}
              <span style={{ flex: 1 }} />
              {DIRECT_IMPORT.has(entry.kind) ? (
                <button
                  disabled={busy === entry.library_id}
                  onClick={() => void doImport(entry)}
                  style={{
                    cursor: "pointer",
                    background: "var(--accent)",
                    color: "var(--accent-ink)",
                    fontWeight: 600,
                    border: "none",
                    borderRadius: 6,
                    padding: "2px 10px",
                    fontSize: 12,
                  }}
                >
                  {busy === entry.library_id ? "…" : "⬇ Import"}
                </button>
              ) : (
                <span style={chip} title={`canon library import <pack> --id ${entry.library_id} --into …`}>
                  import via CLI --into
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
