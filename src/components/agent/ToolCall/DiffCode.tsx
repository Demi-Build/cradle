import { kindOf } from "./diffText";
import { useState } from "react";

/** The code diff (README §5): a real unified diff with `@@` hunk headers,
 *  tinted add/remove lines, `open full diff` past the fold. The text is the
 *  service's (A7.5's `edit_project_code` returns it); nothing is diffed here. */
export function DiffCode({
  path,
  unified,
  added,
  removed,
}: {
  path: string;
  unified: string;
  added: number;
  removed: number;
}) {
  const [full, setFull] = useState(false);
  const lines = unified.split("\n");
  const long = lines.length > 12;
  return (
    <div>
      <pre className={`ag-diff-code${long && !full ? " folded" : ""}`} data-testid="diff-code">
        {lines.map((ln, i) => (
          <div key={i} className={`ln ${kindOf(ln)}`}>
            {ln || " "}
          </div>
        ))}
      </pre>
      <div className="ag-card-mono" style={{ display: "flex", gap: 8 }}>
        <span>
          1 file · <span style={{ color: "var(--ok)" }}>+{added}</span>{" "}
          <span style={{ color: "var(--err)" }}>−{removed}</span> · {path}
        </span>
        {long && (
          <button className="btn-link" onClick={() => setFull((v) => !v)}>
            {full ? "fold" : "open full diff"}
          </button>
        )}
      </div>
    </div>
  );
}
