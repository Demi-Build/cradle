// Lineage tree (Library A): the artifact's family history from the journal +
// object store, rendered as a layered DAG. Content lives on NODES (one card
// per version — a content hash), provenance lives on EDGES (the op that
// turned one version into the next). The same bytes appearing in two
// artifacts' histories is ONE node wearing both badges — cross-asset
// connections come free from the CAS. Restore never deletes newer versions;
// it grows a new branch from the chosen node (op:"restore").
//
// Layout is a simple layered placement (column = depth, row = order) — our
// graphs are dozens of nodes, not thousands; a real layout engine (ELK) can
// replace `layout()` without touching anything else if that changes.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type LineageNode,
  type LineageTree,
} from "../../lib/invoke";
import { useStore } from "../../store";

const COL_W = 240;
const ROW_H = 168;
const CARD_W = 200;
const CARD_H = 140;

// Facets whose CAS bytes are PNGs. "animation" is NOT one — asset_animate
// snapshots frames.json, so those nodes diff as JSON.
const PNG_FACETS = new Set(["sprite", "tilesheet", "band"]);

function shortHash(h: string): string {
  return h.replace("sha256:", "").slice(0, 8);
}

function shortTs(ts: string): string {
  return ts ? ts.slice(0, 16).replace("T", " ") : "";
}

const OP_TONE: Record<string, string> = {
  generate: "#7bc98a",
  create: "#7bc98a",
  baseline: "#8a8398",
  edit: "#e2b714",
  regenerate: "#7c9fff",
  import: "#a78bfa",
  restore: "#e0a15a",
};

/** Restore target for a node, derived from its facet + owning artifact. */
function restoreTarget(node: LineageNode, artifactId: string): string | null {
  const [kind, rest] = [artifactId.split(":")[0], artifactId.split(":")[1] ?? ""];
  switch (node.facet) {
    case "row":
      return kind === "enemy" || kind === "item" ? artifactId : null;
    case "sprite":
      if (artifactId === "player") return "player";
      return kind === "enemy" || kind === "item" ? artifactId : null;
    case "tilesheet":
      return kind === "tileset" ? `tilesheet:${rest}` : null;
    case "band": {
      const band = node.detail?.band;
      return kind === "backdrop" && band !== undefined
        ? `backdrop:${rest}/${band}`
        : null;
    }
    default:
      return null;
  }
}

export function LineagePanel({
  artifactId,
  typeId,
  entityId,
}: {
  artifactId: string;
  typeId: string;
  entityId: string;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const select = useStore((s) => s.select);
  const [tree, setTree] = useState<LineageTree | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [compare, setCompare] = useState<LineageNode | null>(null);
  const [blend, setBlend] = useState(50);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setTree(await api.assetLineage(worldPath, artifactId));
    } catch (e) {
      setErr(String(e));
    }
  }, [worldPath, artifactId]);

  useEffect(() => {
    setTree(null);
    setThumbs({});
    setCompare(null);
    setNote(null);
    void load();
  }, [load]);

  // Thumbnails for image facets — bytes live only in the CAS.
  useEffect(() => {
    if (!tree) return;
    let alive = true;
    (async () => {
      for (const node of tree.nodes) {
        if (!PNG_FACETS.has(node.facet) || thumbs[node.id]) continue;
        try {
          const obj = await api.objectCat(worldPath, node.id);
          if (!alive) return;
          setThumbs((t) => ({
            ...t,
            [node.id]: `data:image/png;base64,${obj.bytes_b64}`,
          }));
        } catch {
          /* baseline bytes may predate the store — card falls back to a chip */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, worldPath]);

  // Layered layout: column = depth, row = arrival order within the column.
  const placed = useMemo(() => {
    if (!tree) return new Map<string, { x: number; y: number }>();
    const rows: Record<number, number> = {};
    const out = new Map<string, { x: number; y: number }>();
    for (const node of tree.nodes) {
      const row = rows[node.depth] ?? 0;
      rows[node.depth] = row + 1;
      out.set(node.id, { x: node.depth * COL_W + 12, y: row * ROW_H + 12 });
    }
    return out;
  }, [tree]);

  const doRestore = async (node: LineageNode) => {
    const target = restoreTarget(node, artifactId);
    if (!target) return;
    if (
      !window.confirm(
        `Restore this ${node.facet} version (${shortHash(node.id)}) as current?\n\n` +
          "Nothing is deleted — newer versions stay in the history and this " +
          "becomes a new branch.",
      )
    )
      return;
    setBusy(node.id);
    setNote(null);
    try {
      await api.assetRestore(worldPath, target, node.id);
      // Re-select refreshes the whole detail pane (row data AND this tree);
      // the new branch + moved current ring is the visible confirmation.
      select({ kind: "entity", typeId, id: entityId, tab: "history" });
    } catch (e) {
      setNote(String(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  // Compare pairs same-facet versions: a historic sprite diffs against the
  // CURRENT SPRITE, a historic row against the current row.
  const currentOfFacet = (facet: string): LineageNode | undefined =>
    tree?.nodes.find((n) => n.current_of.includes(`${artifactId}#${facet}`));

  if (err) return <p style={{ color: "#e0453a", fontSize: 13, padding: 16 }}>{err}</p>;
  if (!tree) return <p style={{ fontSize: 13, padding: 16 }}>Loading lineage…</p>;
  if (tree.nodes.length === 0)
    return (
      <p style={{ fontSize: 13, padding: 16, color: "var(--text-3, #8a8398)" }}>
        No history yet — edits, regenerations, and uploads will appear here.
      </p>
    );

  const width = (tree.metadata.max_depth + 1) * COL_W + 40;
  const height =
    Math.max(...[...placed.values()].map((p) => p.y + ROW_H), ROW_H) + 20;
  const compareCurrent = compare ? currentOfFacet(compare.facet) : undefined;

  return (
    <div style={{ padding: "8px 4px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>lineage · {artifactId}</strong>
        <span style={{ fontSize: 11, color: "var(--text-3, #8a8398)" }}>
          {tree.metadata.total_nodes} version{tree.metadata.total_nodes === 1 ? "" : "s"} —
          nodes are content, edges are the ops between them; restore branches, never deletes
        </span>
        {tree.metadata.pruned && (
          <span style={{ fontSize: 11, color: "#e0a15a" }}>
            (large tree — showing a portion)
          </span>
        )}
        {note && <span style={{ fontSize: 12, color: "var(--accent, #e2b714)" }}>{note}</span>}
      </div>

      <div style={{ overflow: "auto", marginTop: 8, border: "1px solid var(--border, #3a2f4a)", borderRadius: 10 }}>
        <div style={{ position: "relative", width, height }}>
          <svg
            width={width}
            height={height}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            {tree.edges.map((edge, i) => {
              const a = placed.get(edge.from);
              const b = placed.get(edge.to);
              if (!a || !b) return null;
              const x1 = a.x + CARD_W;
              const y1 = a.y + CARD_H / 2;
              const x2 = b.x;
              const y2 = b.y + CARD_H / 2;
              const mid = (x1 + x2) / 2;
              const secondary = edge.kind.endsWith(":replaced");
              return (
                <g key={i}>
                  <path
                    d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={OP_TONE[edge.op] ?? "#8a8398"}
                    strokeWidth={secondary ? 1 : 2}
                    strokeDasharray={secondary ? "4 4" : undefined}
                    opacity={secondary ? 0.45 : 0.9}
                  />
                  <text
                    x={mid}
                    y={(y1 + y2) / 2 - 6}
                    fontSize={10}
                    fill={OP_TONE[edge.op] ?? "#8a8398"}
                    textAnchor="middle"
                  >
                    {secondary ? "replaced" : edge.op}
                  </text>
                </g>
              );
            })}
          </svg>

          {tree.nodes.map((node) => {
            const pos = placed.get(node.id);
            if (!pos) return null;
            const isCurrent = node.current_of.length > 0;
            const isRequested = node.id === tree.requested_node_id;
            const canRestore =
              !isCurrent && restoreTarget(node, artifactId) !== null;
            const facetCurrent = currentOfFacet(node.facet);
            const canCompare =
              facetCurrent !== undefined && facetCurrent.id !== node.id;
            const usageLevels = Object.values(node.usage).flat();
            return (
              <div
                key={node.id}
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  width: CARD_W,
                  minHeight: CARD_H,
                  // Hard cap under the row pitch: an expanded prompt scrolls
                  // inside its card instead of painting over the card below.
                  maxHeight: ROW_H - 16,
                  overflowY: "auto",
                  background: "var(--surface-1, #1a1420)",
                  border: `2px solid ${
                    isRequested
                      ? "var(--accent, #e2b714)"
                      : isCurrent
                        ? "#7bc98a"
                        : "var(--border, #3a2f4a)"
                  }`,
                  borderRadius: 10,
                  padding: 8,
                  fontSize: 11,
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    style={{
                      color: OP_TONE[node.op] ?? "var(--text-2, #d9cfe8)",
                      fontWeight: 700,
                    }}
                  >
                    {node.op}
                  </span>
                  <span style={{ color: "var(--text-3, #8a8398)" }}>{node.facet}</span>
                  <span style={{ color: "var(--text-3, #8a8398)", marginLeft: "auto" }}>
                    {shortHash(node.id)}
                  </span>
                </div>
                <div style={{ margin: "6px 0", display: "flex", gap: 8, alignItems: "center" }}>
                  {thumbs[node.id] ? (
                    <img
                      src={thumbs[node.id]}
                      alt={node.facet}
                      style={{
                        width: 56, height: 56, imageRendering: "pixelated",
                        background: "#000", borderRadius: 6, objectFit: "contain",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 56, height: 56, display: "inline-flex",
                        alignItems: "center", justifyContent: "center",
                        background: "var(--surface-2, #2a2136)", borderRadius: 6,
                        fontSize: 20,
                      }}
                    >
                      {PNG_FACETS.has(node.facet) ? "🖼" : "📄"}
                    </span>
                  )}
                  <div style={{ color: "var(--text-3, #8a8398)", lineHeight: 1.5 }}>
                    <div>{shortTs(node.ts)}</div>
                    <div>{node.actor}</div>
                    {node.gen?.llm_model && <div>{node.gen.llm_model}</div>}
                  </div>
                </div>
                {isCurrent && (
                  <div style={{ color: "#7bc98a", marginBottom: 4 }}>
                    current · {node.current_of.map((c) => c.split("#")[1]).join(", ")}
                  </div>
                )}
                {usageLevels.length > 0 && (
                  <div style={{ color: "var(--text-3, #8a8398)", marginBottom: 4 }}>
                    placed in {usageLevels.join(", ")}
                  </div>
                )}
                {node.gen?.prompt && (
                  <details style={{ marginBottom: 4 }}>
                    <summary style={{ cursor: "pointer", color: "var(--text-3, #8a8398)" }}>
                      🗒 prompt
                    </summary>
                    <div
                      style={{
                        maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap",
                        background: "var(--surface-2, #2a2136)", borderRadius: 6,
                        padding: 6, marginTop: 4,
                      }}
                    >
                      {node.gen.prompt}
                    </div>
                  </details>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  {canRestore && (
                    <button
                      disabled={busy === node.id}
                      onClick={() => void doRestore(node)}
                      style={{ cursor: "pointer", fontSize: 11 }}
                    >
                      {busy === node.id ? "…" : "↩ restore"}
                    </button>
                  )}
                  {canCompare && (
                    <button
                      onClick={() => setCompare(node)}
                      style={{ cursor: "pointer", fontSize: 11 }}
                    >
                      ⇆ compare
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {compare && compareCurrent && compareCurrent.id !== compare.id && (
        <CompareStrip
          worldPath={worldPath}
          a={compare}
          b={compareCurrent}
          thumbs={thumbs}
          blend={blend}
          onBlend={setBlend}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}

/** Side-by-side of a historic version vs current, with an onion-skin blend
 * for images and a field-level diff for JSON rows. */
function CompareStrip({
  worldPath,
  a,
  b,
  thumbs,
  blend,
  onBlend,
  onClose,
}: {
  worldPath: string;
  a: LineageNode;
  b: LineageNode;
  thumbs: Record<string, string>;
  blend: number;
  onBlend: (v: number) => void;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<[string, string, string][] | null>(null);
  const images = PNG_FACETS.has(a.facet) && PNG_FACETS.has(b.facet);

  useEffect(() => {
    if (images) return;
    let alive = true;
    (async () => {
      try {
        const [ra, rb] = await Promise.all([
          api.objectCat(worldPath, a.id),
          api.objectCat(worldPath, b.id),
        ]);
        if (!alive) return;
        const ja = JSON.parse(atob(ra.bytes_b64)) as Record<string, unknown>;
        const jb = JSON.parse(atob(rb.bytes_b64)) as Record<string, unknown>;
        const flat = (o: Record<string, unknown>, prefix = ""): Record<string, string> => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(o)) {
            if (v && typeof v === "object" && !Array.isArray(v)) {
              Object.assign(out, flat(v as Record<string, unknown>, `${prefix}${k}.`));
            } else {
              out[`${prefix}${k}`] = JSON.stringify(v);
            }
          }
          return out;
        };
        const fa = flat(ja);
        const fb = flat(jb);
        const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
        setDiff(
          keys
            .filter((k) => fa[k] !== fb[k])
            .map((k) => [k, fa[k] ?? "—", fb[k] ?? "—"]),
        );
      } catch {
        if (alive) setDiff([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [images, worldPath, a.id, b.id]);

  return (
    <div
      style={{
        marginTop: 10, border: "1px solid var(--border, #3a2f4a)",
        borderRadius: 10, padding: 12, fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <strong>
          {shortHash(a.id)} ({a.op}) vs current {shortHash(b.id)}
        </strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ cursor: "pointer" }}>✕</button>
      </div>
      {images ? (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <figure style={{ margin: 0, textAlign: "center" }}>
            <img src={thumbs[a.id]} alt="then" style={{ width: 128, imageRendering: "pixelated", background: "#000" }} />
            <figcaption style={{ color: "var(--text-3, #8a8398)" }}>then</figcaption>
          </figure>
          <figure style={{ margin: 0, textAlign: "center" }}>
            <img src={thumbs[b.id]} alt="now" style={{ width: 128, imageRendering: "pixelated", background: "#000" }} />
            <figcaption style={{ color: "var(--text-3, #8a8398)" }}>now</figcaption>
          </figure>
          <figure style={{ margin: 0, textAlign: "center" }}>
            <div style={{ position: "relative", width: 128, height: 128, background: "#000" }}>
              <img src={thumbs[a.id]} alt="" style={{ position: "absolute", inset: 0, width: 128, imageRendering: "pixelated" }} />
              <img
                src={thumbs[b.id]}
                alt=""
                style={{
                  position: "absolute", inset: 0, width: 128,
                  imageRendering: "pixelated", opacity: blend / 100,
                }}
              />
            </div>
            <figcaption style={{ color: "var(--text-3, #8a8398)" }}>
              onion skin{" "}
              <input
                type="range"
                min={0}
                max={100}
                value={blend}
                onChange={(e) => onBlend(Number(e.target.value))}
                style={{ width: 90, verticalAlign: "middle" }}
              />
            </figcaption>
          </figure>
        </div>
      ) : diff === null ? (
        <p>Loading diff…</p>
      ) : diff.length === 0 ? (
        <p style={{ color: "var(--text-3, #8a8398)" }}>No field differences.</p>
      ) : (
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--text-3, #8a8398)", textAlign: "left" }}>
              <th style={{ padding: "2px 10px 2px 0" }}>field</th>
              <th style={{ padding: "2px 10px 2px 0" }}>then</th>
              <th style={{ padding: "2px 10px 2px 0" }}>now</th>
            </tr>
          </thead>
          <tbody>
            {diff.map(([k, va, vb]) => (
              <tr key={k}>
                <td style={{ padding: "2px 10px 2px 0", fontWeight: 600 }}>{k}</td>
                <td style={{ padding: "2px 10px 2px 0", color: "#e0a15a" }}>{va}</td>
                <td style={{ padding: "2px 10px 2px 0", color: "#7bc98a" }}>{vb}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
