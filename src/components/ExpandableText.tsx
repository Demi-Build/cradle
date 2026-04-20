import { useState } from "react";

export function ExpandableText({
  text,
  limit = 200,
  className,
}: {
  text: string | undefined | null;
  limit?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  if (text.length <= limit) {
    return <span className={className}>{text}</span>;
  }
  return (
    <span className={className}>
      {expanded ? text : `${text.slice(0, limit).trimEnd()}…`}{" "}
      <button className="expand-toggle" onClick={() => setExpanded((e) => !e)}>
        {expanded ? "show less" : "show more"}
      </button>
    </span>
  );
}
