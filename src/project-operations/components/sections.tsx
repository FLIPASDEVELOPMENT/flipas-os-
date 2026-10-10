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
  crew = false,
}: {
  children: React.ReactNode;
  initialTab: string;
  crew?: boolean;
}) {
  const panels = Children.toArray(children).filter(
    (child) => isValidElement<{ id: string }>(child) && !!child.props.id,
  ) as React.ReactElement<{ id: string }>[];
  const initial = panels.some((p) => p.props.id === initialTab)
    ? initialTab
    : panels[0]?.props.id;
  const [active, setActive] = useState(initial);
  function selectSection(id: string) {
    setActive(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  }
  return (
    <>
      <div className="project-mobile-navigation">
        <label htmlFor="project-section-select">
          Project section · {panels.length} available
        </label>
        <select
          id="project-section-select"
          value={active}
          onChange={(event) => selectSection(event.target.value)}
        >
          {panels.map((p) => (
            <option key={p.props.id} value={p.props.id}>
              {labels[p.props.id] ?? p.props.id}
            </option>
          ))}
        </select>
        {crew && (
          <nav className="field-quick-actions" aria-label="Field actions">
            {[
              ["tasks", "My tasks"],
              ["crew", "My hours"],
              ["logs", "Report incident"],
            ].map(
              ([id, label]) =>
                panels.some((p) => p.props.id === id) && (
                  <button
                    type="button"
                    key={id}
                    aria-current={active === id ? "page" : undefined}
                    onClick={() => selectSection(id)}
                  >
                    {label}
                  </button>
                ),
            )}
          </nav>
        )}
      </div>
      <nav className="project-tabs" aria-label="Project sections">
        {panels.map((p) => (
          <button
            key={p.props.id}
            type="button"
            aria-current={active === p.props.id ? "page" : undefined}
            onClick={() => selectSection(p.props.id)}
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
