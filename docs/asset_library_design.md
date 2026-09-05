# Asset Library / CMS — design for sign-off

*2026-07-22 · draft for review — nothing here is built yet (per agreement: sign-off
before the library layer lands). Scope: cradle UI + canon verbs on top of the
existing provenance substrate.*

## 1. What we're building

Three user-facing capabilities, in build order:

1. **Version timeline per asset** — see every version of a thing (sprite, tile
   sheet, backdrop band, audio, DB row, level step), make any asset from an assets history the current asset. Doing this does not delete the more recent assets. We can keep any of the assets. We create a tree diagram to show 'lineage' - this shows the evolution of how assets are changing. I'd like the lineage/tree to show what assets exist in the history starting with upload/generation. We should see its prompt if generated. Then any changes we see as the branch line (reprompted, used with edit to animate, user did some paint/manual action - something we'll enable later). Multiple assets in a lineage can be used in different parts of the game, so we should also see badges on how/where its used. For instance a asset could be generated as a red enemy. The user could pass to an edit image call, creating an animation sheet. They could then update this sheet by painting red -> blue, and doing that both for the animation sheet+ whatever. They could then assign this to another enemy db row. We'd be able to see in lineage how these assets are connected, even if in the asset library/database they appeared as different assets. Some substrate exists that may enable this (journal +   CAS + `canon level versions/restore`); there is no UI and the verbs only
   cover level steps today.

2. **Browsable asset catalog** — every asset in the open pack, filterable by
   type / stage / status (generated · user_edited · imported · pinned), with
   history badges ("4 versions · last edit 2d ago"), independent of which DB
   row currently references it.

3. **Cross-project sharing** — a **global library** above per-pack stores:
   publish an asset from any pack, browse the library from any project, import
   into the current pack with full source provenance.

**Non-goals (v1):** remote sync (consent gate unresolved — spec §8), asset
marketplace semantics, editing library entries in place (a library entry is
immutable; you import it into a pack and edit *there*), MazeWorld types
(joins when its specs land in the generic registry).

## 2. Substrate we already have

- `.canon/objects/<sha256>` — append-only CAS; every write verb snapshots
  before/after bytes. Full history is already replayable.
- `.canon/journal.jsonl` — op events (`generate/edit/import/restore/…`) keyed
  by `artifact_id`, with `before_hash`/`after_hash` into the CAS.
- `canon level versions/restore` — chain reconstruction + restore, **level
  steps only**.
- Retention doctrine (spec §3a, §7): object store never pruned; deletes are
  soft; user-facing reads show the user-visible chain, internal reads see all.

## 3. Piece A — LINEAGE TREE + restore + visual diff

> **Status 2026-07-22: first cut BUILT (uncommitted).** Shipped per your §1
> rewrite: `canon asset lineage` derives the family tree from the journal +
> CAS — **nodes = versions (content hashes), edges = the ops between them**
> (edit / regenerate / import / restore, with actor + model). Cross-asset
> connection falls out of the CAS: identical bytes in two artifacts' chains
> is ONE node wearing both artifact badges. Restore (`canon asset restore`)
> never deletes newer versions — the new state hangs off the restored-from
> node as a branch. Prompts: db-row `generate`/`regenerate` events now
> persist the actual prompt in their journal `gen` block and the tree shows
> it per node ("🗒 prompt"); art-generation prompts are a follow-up (the art
> phases don't journal their prompts yet). Usage badges v1 = which levels
> place the enemy/item. Cradle: **History tab** on enemy/item/tileset/
> backdrop detail views — layered tree canvas, thumbnails pulled from the
> CAS (`canon object cat`), per-node restore (confirm-gated) and compare
> (side-by-side + onion-skin blend for images, field-level then/now diff for
> rows). The reference briefing's contract shape (root vs requested node,
> pruning metadata) is honored; the layout is a simple layered placement we
> can swap for ELK/React Flow when trees outgrow it, per your "starting
> piece" note. Manual paint / reprompt-in-place arrive as their ops land.

**Canon:** generalize the level-step verbs to any journaled artifact:

- `canon asset versions <pack> --target <artifact_id>` → the version chain
  (hash, op, actor, ts, gen-block summary) derived from the journal, exactly
  like `provenance.artifact_versions` does for level steps.
- `canon asset restore <pack> --target <artifact_id> --to <hash>` → CAS bytes
  back into place (journal `op:"restore"`), routed per family: sprite/band/
  tilesheet = binary write + rehash refs (reuse `replace_asset` plumbing);
  enemy/item row = JSON write + rehash (reuse `update_db_row` plumbing);
  level steps keep the existing verb.
- `canon object cat <pack> <hash> [--out <file>]` → raw bytes for previews
  (cradle needs to render *old* versions that live only in the CAS).

**Cradle:** a **History drawer** on every entity/asset detail view (enemies,
items, player, tilesets, backdrops, audio, levels): vertical timeline from
`asset versions`, each entry with op chip (🎲 generated · ✎ edited · ⬆
imported · ↩ restored), actor, time, and a thumbnail rendered from CAS bytes.
Actions per entry: **Restore this version** (confirm dialog), **Compare** →
side-by-side before/after; images additionally get an onion-skin slider
(50% blend) — cheap and catches subtle art drift. JSON artifacts diff as
field-level from→to lists (the journal `detail.changed` already carries this
for db edits).

## 4. Piece B — pack asset catalog

A new left-nav surface **LIBRARY · this pack**: grid of every asset file the
pack's manifests reference (sprite/tiles/backdrop/audio/props), each card
showing thumbnail, owning artifact link, status chips (user_edited, pinned,
versions count from the journal). Filters: type, stage, status, "edited only".
This is mostly a read-model join of manifests + journal — no new canon verbs
needed beyond `asset versions`.

## 5. Piece C — the global library (cross-project sharing)

**Store** (local-first, no remote): `~/.canon/library/`
```
~/.canon/library/
  objects/<sha256>        # CAS, same format as pack stores — dedup is free
  index.jsonl             # append-only: one entry per published asset
```
Index entry: `{library_id, kind (sprite|tile|backdrop|audio|enemy_def|item_def),
name, tags, content_hash(es), preview_hash, source: {pack_path, pack_name,
artifact_id, provenance_hash}, published_ts, actor}`.

Composite assets travel whole: publishing an **enemy definition** bundles row
JSON + base sprite + animation atlas/frames (each a CAS object, listed in the
entry); publishing a **tile** bundles the flattened tile art + its slot params.

**Verbs:**
- `canon library publish <pack> --target <artifact_id> [--name --tags]` —
  snapshot bytes into the library CAS + append index entry. Journals
  `op:"keep"`-adjacent event in the *pack* (`detail.kind:"library_publish"`)
  — publishing is a strong positive signal (user chose to reuse it).
- `canon library list [--kind --tag --query]` — the index, for cradle's browser.
- `canon library import <pack> --id <library_id> [--as <new_id>]` — bytes into
  the pack (new row id / sprite path as appropriate), journal **`op:"import"`,
  `source:"import"`, `detail: {kind:"library_import", library_id, source_pack,
  source_artifact}`** — the provenance chain crosses projects without breaking:
  the pack knows exactly where the asset came from, and the training corpus
  sees "imported from own library" as distinct from "uploaded external bytes".

**Cradle:** the LIBRARY nav gains a second scope, **shared library**: browse/
search cards, "Import into this pack" per card (kind-aware: enemy defs land as
a new row + sprite; tiles prompt for target stage/tile). A "⬆ Publish to
library" action on asset detail views and History drawer entries (any version
can be published, not just the current one).

**Dedup:** content-hash keyed CAS means re-publishing identical bytes is a
no-op and imports of the same asset into many packs store bytes once per pack
tree (packs stay self-contained — no cross-tree references, so a pack still
zips/ships alone).

## 5a. Locked additions (agreed 2026-07-23) — baked into Piece C

1. **`library_id` stamping** — every import stamps a durable library identity
   (+ source hash) into the imported artifact's provenance, so a future
   "check for updates / re-import everywhere" op can find divergent copies.
   Copy semantics stay (packs ship alone); propagation becomes *possible*.
2. **The `assign` op** — the in-project Mario-Maker gesture: "use this
   asset here." Copies a source artifact's art bundle (sprite + animation)
   onto another row with a cross-artifact provenance edge (`op:"import"`,
   `detail.kind:"asset_assign"`). Deliberately distinct from `restore`
   (which only rewinds an artifact's own lineage).
3. **Style bundles** — first v2 library kind, ahead of levels: palette +
   tilesheets + backdrops + sprite treatment published once, applied to a
   pack. The quick-reskin-at-theme-scale gesture; style lanes + art-lock
   are the substrate.
4. **Project registry via cradle recents** — the global/project view toggle
   and sort-by-project filter are fed by cradle's recent-projects list; no
   cradle-owned database needed for v1. "Saves" = working sessions: the
   pack IS the save; persistence is the data tree itself.

## 6. Provenance & training data

New signals this generates (all local, spec doctrine unchanged): `library_publish`
(positive/curation), `library_import` (reuse-preference pair — what the user
reached for instead of generating), `restore` (regression signal: which
generation they went back to). No remote sink; consent gate untouched.

## 7. Build order & estimates

| Phase | Contents | Size |
|---|---|---|
| A | `asset versions/cat/restore` verbs + History drawer + restore + diffs | the big one — touches every detail view; ~1 session |
| B | pack catalog surface | small; read-model only |
| C | library store + publish/list/import verbs + shared-library UI | ~1 session |
| D | polish: onion-skin diff, publish-any-version, tags/search | trailing |

A ships alone (it's the user's "in-app version timeline" ask and needs no
sign-off beyond this doc). B/C are where the layout below needs your call.

## 8. Open questions — **ANSWERED 2026-07-22 (locked below)**

> Locked: (1) `~/.canon/library/` now, global-per-user with project links +
> a global/project view toggle and sort-by-project; long-term cradle owns
> its own DB, broadcasts back to project files, and publishes engine/exes.
> (2) v1 kinds as proposed; levels join in V2. (3) explicit ⬆ Publish AND
> auto-suggest on keep/pin (suggest lands with the keep op, task #7).
> (4) fresh id on collision, never overwrite.

1. **Library location** — `~/.canon/library/` global-per-user OK? - for now we can do this, and make sure the assets are global per user but also linked and easily found by project. We should be able to toggle on/off global or project view and sort by project so we don't have to see mazeworld stuff when we're messing with platformers. Eventually cradle should copy canon data into it's own database, and any updates, etc can be broadcast back to the proper project file to be a playable game. This will also allow cradle to publish games into the proper engine/exes 
2. **v1 shareable kinds** — proposal: enemy defs (bundled), item defs, single
   tiles, backdrops, audio tracks, player skin. Whole *levels/stages* excluded
   v1 (heavy cross-refs). Agree? yes, though eventually levels are also sharable (V2)
3. **Publish trigger** — explicit "⬆ Publish" only (proposal), or also
   auto-suggest on `keep`/pin ("add approved art to your library?")? Yes...
4. **Naming collisions on import** — proposal: always mint a fresh id
   (`wax_minnow_2`) and never overwrite; "replace existing" is a separate
   explicit choice that routes through `asset replace` (keeps op semantics clean). Yes...

some code to refer to on this machine for the concept of how lineage can look/connect - but isn't fully complete or as expansive as what we've described above can be seen here:

```
Briefing: Asset Lineage Viewer — Reference Architecture
How to use this document. This describes a working lineage feature from another codebase. Draw on its data model, contracts, algorithms, and design decisions — but do not reproduce it verbatim. Where code appears, treat it as illustrative: schema names, styling, and library choices should follow your own project's conventions. Source stack, so you know what maps to what: Next.js App Router, Postgres (recursive CTEs), TanStack Query, elkjs for graph layout, React Flow for canvas rendering, Redis for server caching. All of these are swappable.

1. Concept and data model
Generated assets ("primitives") form a family tree: an image is upscaled, turned into a video, inpainted, etc. Each operation creates a child asset. Lineage is the interactive graph of that ancestry.

The entire data model is two nullable columns on the asset row — there is no separate lineage table:

parentPrimitiveId — self-referential FK to the asset this one was derived from (NULL for roots, e.g. uploads).
requestId — FK to the generation request (model, task, status, cost) that produced this asset.
Everything else is derived at read time: edges come from parent pointers, and edge metadata comes from joining the child's request. The load-bearing idea: content lives on nodes, provenance lives on edges. Parent pointers are written once at creation and never re-parented, so the graph is acyclic by construction. (If your system allows re-parenting, add cycle guards to the recursive queries below.)

Index the parent column for the traversals: CREATE INDEX ON assets(parent_id) WHERE deleted_at IS NULL;

2. The API contract
One endpoint, one response shape. This contract is the spine of the feature — get this right and the client and server can be built independently.

GET /api/primitives/:id/lineage — query params: maxNodes (prune threshold, default 500), subtreeOf (lazy-load expansion, see §3.3).

type AssetType = 'image' | 'audio' | 'video' | 'text' | '3d' | 'world';

interface LineageNode {
  id: string;
  parentId: string | null;
  name: string | null;
  type: AssetType;
  filePath: string;        // storage path; client resolves thumbnails itself
  projectId: string;
  depth: number;           // 0 at tree root, increases downward
  isExternal: boolean;     // viewer lacks access to this node's project (see §3.1)
}

interface LineageEdgeRequestData {
  requestId: string;
  generationTask: string;  // e.g. TEXT2IMAGE, IMAGE2IMAGE, UPSCALE, IMAGE2VIDEO
  modelName: string;
  status: string;
  createdAt: string;       // ISO
  provider?: string | null;
  cost?: number | null;
}

interface LineageEdge {
  from: string;            // parent id
  to: string;              // child id
  request?: LineageEdgeRequestData; // the generation that produced the CHILD
}

interface LineageTreeResponse {
  rootId: string;          // top of the accessible tree
  requestedNodeId: string; // the node the user asked about — UI centers here, not on root
  nodes: LineageNode[];
  edges: LineageEdge[];
  metadata: {
    totalNodes: number;    // true size BEFORE pruning
    maxDepth: number;
    isPruned: boolean;
    prunedAt?: string[];   // node ids whose children were cut — drives "Load children"
  };
}
Three fields encode non-obvious decisions: requestedNodeId (the tree is rooted at the top but centered on the queried node — users want to see ancestors above them, not just descendants), isExternal, and prunedAt (the lazy-loading handshake between server and client).

3. Server-side traversal
3.1 Two-phase walk with access boundaries
Phase 1 — walk up from the requested node to find the root, via recursive CTE:

WITH RECURSIVE ancestors AS (
  SELECT id, parent_id, project_id, 0 AS depth
  FROM assets WHERE id = $1 AND deleted_at IS NULL
  UNION ALL
  SELECT a.id, a.parent_id, a.project_id, anc.depth + 1
  FROM assets a JOIN ancestors anc ON a.id = anc.parent_id
  WHERE a.deleted_at IS NULL
)
SELECT * FROM ancestors ORDER BY depth ASC;
Then batch-check the viewer's access to every project_id in the chain (one query, build a Map<projectId, boolean>). Walk the ancestor list in order; the accessible root is the last node before access fails, or the true root (parent_id IS NULL) if access never fails. Lineage can legitimately cross project boundaries (an asset derived from another project's asset), so this is a correctness feature, not an edge case.

Phase 2 — walk down from the accessible root with the mirror-image CTE (JOIN tree t ON a.parent_id = t.id), collecting the entire subtree ordered by depth.

Nodes inside the tree whose project the viewer can't access are kept but flagged isExternal: true and stripped to a stub. The graph keeps its true shape without leaking content — never silently drop them, or the tree lies about its structure.

3.2 Pruning for large trees
Applied in memory after the downward walk when totalNodes > maxNodes (default 500):

keep = path(requestedNode → root)
     ∪ first-level children of every node on that path
prunedAt = kept children that have hidden grandchildren (excluding path nodes)
if still over budget:
  keep = path ∪ first-level children of requestedNode only
  recompute prunedAt
The invariant: the requested node's context (full ancestor path plus immediate siblings/children) always survives pruning. Report the true totalNodes so the UI can warn honestly.

3.3 Lazy subtree expansion
?subtreeOf=<nodeId> runs the downward CTE from that node with a depth cap (AND t.depth < $2, cap = 2), returning the same response shape. Nodes sitting at the cap become the new prunedAt, so expansion is naturally recursive. Don't cache these (see §6).

3.4 Batch enrichment and edge building
Never query per node. Collect all non-null requestIds → one bulk query (requests joined to models) → Map<requestId, LineageEdgeRequestData>. Same pattern for any other per-node decoration (the source app also attaches comment-author avatars this way). Run the bulk queries with Promise.all. Then derive edges:

const nodeIds = new Set(nodes.map(n => n.id));
for (const node of nodes) {
  if (node.parentId && nodeIds.has(node.parentId)) {
    edges.push({
      from: node.parentId,
      to: node.id,
      request: requestMap.get(requestIdOf(node.id)), // the CHILD's request
    });
  }
}
The nodeIds.has guard matters after pruning — never emit an edge to a node you didn't return.

3.5 Route shape
Auth → load the primitive → check viewer-level access on its project → serve. Subtree requests bypass the cache; full-tree requests go through it (§6). Fail with 404 for missing/soft-deleted assets.

4. Client pipeline
Strictly staged: fetch → layout → render, each stage swappable.

Fetch. One query per tree, keyed by asset id (e.g. ['lineage','tree',assetId]), staleTime ~5 min. Structured keys let you invalidate all lineage at once or one tree.

Layout. Treat layout as a pure async transform, done by a real DAG layout engine — do not hand-roll node positioning. ELK's layered algorithm works well; import it dynamically so the ~1 MB library stays out of the main bundle. Fixed node dimensions (source uses 256×144 — 16:9 to match media thumbnails) make layout deterministic:

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.spacing.nodeNode': '80',
  'elk.layered.spacing.nodeNodeBetweenLayers': '160',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.direction': horizontal ? 'RIGHT_TO_LEFT' : 'DOWN',
};
Map the layout result to renderer nodes, computing per-node flags the renderer shouldn't have to derive: isRoot, isRequested (id === requestedNodeId), hasPrunedChildren (id ∈ prunedAt).

Viewport. Center the initial viewport on the requested node (window center minus node position minus half node size, zoom 1), animated over ~800ms. Falling back to fit-all or centering on the root feels wrong — the user navigated here from a specific asset.

Subtree merge. "Load children" fetches the subtree and merges it into the cached tree without refetching:

mergedNodes = existing ∪ (subtree nodes not already present, by id)
mergedEdges = existing ∪ (subtree edges not already present, by `${from}-${to}`)
prunedAt    = (existing prunedAt − expandedNodeId) ∪ subtree.prunedAt
queryClient.setQueryData(treeKey, merged)  // layout re-runs reactively
Live updates. Subscribe to whatever generation-completion events your app already has. When a request completes: if its input asset is a node currently in the tree, invalidate the tree query. Cheap, targeted, no polling loop in the viewer itself.

5. Rendering and UX vocabulary
The canvas is any pan/zoom graph surface (React Flow in the source). Decisions that matter more than the library:

Nodes are not draggable or connectable. The layout engine is authoritative; this is a viewer, not an editor.
Node = thumbnail card with minimal chrome. Visual states: root gets a badge/ring; the requested node gets an unmissable highlight (source uses an animated gradient border); external nodes get a lock icon, dashed border, no thumbnail, and are excluded from navigation; pruned nodes show a "Load children" button with a spinner while loading.
Provenance appears on edge hover, keeping nodes quiet. Render an invisible ~20px-wide hit path over each edge, require ~200ms of hover intent, then show a popover: task (humanized, e.g. "Image to Video"), model, status badge, date, provider, cost. Highlight the hovered edge.
Double-click a node → navigate to that node's lineage URL (re-roots and re-centers the whole view). During the transition, keep the previous canvas rendered under a blurred "Navigating…" overlay — never flash to a blank loading screen when a layout is already on screen.
States: pruned → persistent warning banner ("tree too large, showing a portion"); exactly one node and no edges → friendly empty state ("no parent or child relationships"); error → message plus retry. The lineage page is a full-screen standalone route, linked from the asset detail view ("View lineage").
6. Caching and invalidation
Server cache key must include the user id: project:{projectId}:lineage:{assetId}:{userId}. Access boundaries (§3.1) make tree shape user-specific; a shared key leaks one user's visibility to another. TTL ~15 min.
Invalidate by key pattern (project:{projectId}:lineage:*) whenever assets in the project are created or deleted — fire-and-forget with logged errors, on every mutation path.
Subtree responses are never server-cached (cheap, depth-capped, rarely repeated).
Client: staleTime ~5 min plus the event-driven invalidation from §4.
7. Pitfalls checklist
Root at the accessible root, center on the requested node — the two ids differ and both matter.
Show inaccessible nodes as external stubs; don't drop them.
Filter soft-deleted rows in every CTE, both directions.
Edge metadata comes from the child's requestId — attaching the parent's is the classic off-by-one here.
Prune server-side and report true totalNodes; never silently truncate.
Guard edge emission on both endpoints existing post-prune.
Batch every enrichment query; recursive CTE + N-per-node queries is the death of this endpoint.
If parents can be rewritten in your system, add cycle protection to the CTEs.
8. Explicitly out of scope
The source implementation also contains: a theming system, a shared thumbnail component with signed-URL handling, comment-author avatar stacks on nodes, custom trackpad wheel/zoom handling, CSS keyframe animations, and its test fixtures. None of that is lineage — use your own project's equivalents. Likewise, library choices (React Flow, ELK, TanStack Query, Redis) are proven-good defaults, not requirements; preserve the contracts and decisions, not the dependency list.

```

Note: the above talks about databases and decisions - we don't have any of that rooted from canon. Canon creates jsons. Cradle is able to then use those jsons and form it's own working backend database. We can make some decisions 

consider it as a starting piece - but again, we want something more evolved... 

