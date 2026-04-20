import type { ReactNode } from "react";

export type Tab = { id: string; label: string; content: ReactNode };

export function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (id: string) => void }) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="tabs">
      <div className="tabs-header">
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
      <div className="tabs-body">{current?.content}</div>
    </div>
  );
}
