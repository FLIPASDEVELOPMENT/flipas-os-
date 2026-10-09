"use client";
import { Children, isValidElement, useState } from "react";
const labels: Record<string, string> = {
  scope: "Overview",
  schedule: "Schedule",
  tasks: "Tasks",
  crew: "Crew & hours",
  materials: "Materials",
  logs: "Daily logs",
  quality: "Quality & evidence",
  changes: "Scope changes",
  financial: "OWNER finances",
  history: "Activity",
};
export function ProjectSections({
  children,
  initialTab,
}: {
  children: React.ReactNode;
  initialTab: string;
}) {
  const panels = Children.toArray(children).filter(
    (child) => isValidElement<{ id: string }>(child) && !!child.props.id,
  ) as React.ReactElement<{ id: string }>[];
  const initial = panels.some((p) => p.props.id === initialTab)
    ? initialTab
    : panels[0]?.props.id;
  const [active, setActive] = useState(initial);
  return (
    <>
      <nav className="project-tabs" aria-label="Project sections">
        {panels.map((p) => (
          <button
            key={p.props.id}
            type="button"
            aria-current={active === p.props.id ? "page" : undefined}
            onClick={() => {
              setActive(p.props.id);
              const url = new URL(window.location.href);
              url.searchParams.set("tab", p.props.id);
              window.history.replaceState(null, "", url);
            }}
          >
            {labels[p.props.id] ?? p.props.id}
          </button>
        ))}
      </nav>
      <div key={active} className="project-tab-panel" aria-live="polite">
        {panels.find((p) => p.props.id === active)}
      </div>
    </>
  );
}
