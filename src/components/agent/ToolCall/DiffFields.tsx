import { fmt } from "./diffText";
/** The row/schema diff (README §5): field · old (struck, red) · → · new
 *  (green), then "N fields · M unchanged hidden". */
export function DiffFields({
  fields,
  unchanged,
}: {
  fields: { name: string; old: unknown; new: unknown }[];
  unchanged: number;
}) {
  return (
    <div>
      <div className="ag-diff-fields" role="table">
        {fields.map((f) => (
          <div key={f.name} role="row" style={{ display: "contents" }}>
            <span className="k">{f.name}</span>
            <span className="old">{fmt(f.old)}</span>
            <span className="arr">→</span>
            <span className="new">{fmt(f.new)}</span>
          </div>
        ))}
      </div>
      <div className="ag-card-mono">
        {fields.length} field{fields.length === 1 ? "" : "s"} · {unchanged} unchanged hidden
      </div>
    </div>
  );
}
