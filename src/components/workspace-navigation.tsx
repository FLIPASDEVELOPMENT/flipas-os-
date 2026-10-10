"use client";
import { useId, useState } from "react";

export function WorkspaceNavigation({
  children,
  role,
}: {
  children: React.ReactNode;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="workspace-navigation">
      <button
        className="mobile-menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? "Close menu" : "Menu"} <span>{role.replaceAll("_", " ")}</span>
      </button>
      <div
        id={id}
        className={`workspace-menu${open ? " is-open" : ""}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
