import type { ReactNode } from "react";

export type Tab = { id: string; label: string; content: ReactNode };

export function Tabs({
  tabs,
  active,
  onChange,
  trailing,
}: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  trailing?: ReactNode;
}) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="tabs">
      <div className="tabs-header">
        <div className="tabs-header-strip">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${t.id === current?.id ? "active" : ""}`}
              onClick={() => onChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {trailing && <div className="tabs-header-actions">{trailing}</div>}
      </div>
      <div className="tabs-body">{current?.content}</div>
    </div>
  );
}
