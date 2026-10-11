"use client";
import { useState } from "react";
import { categories } from "./categories";
import type { Allocations } from "./validation";
import { purchaseAction } from "./actions";
import { Submit } from "@/project-operations/components/submit";
type Project = {
  id: string;
  name: string;
  lines: { id: string; name: string }[];
};
export function ReviewForm({
  purchaseId,
  version,
  initial,
  projects,
  lines,
}: {
  purchaseId: string;
  version: number;
  initial: Allocations;
  projects: Project[];
  lines: { id: string; description: string }[];
}) {
  const [rows, setRows] = useState(
    initial.map((a) => ({
      ...a,
      projectId:
        a.projectId ?? (a.category === "General Overhead" ? "__overhead" : ""),
    })),
  );
  const set = (i: number, key: string, value: string) =>
    setRows((old) =>
      old.map((a, j) =>
        j === i
          ? {
              ...a,
              [key]: value,
              ...(key === "projectId"
                ? {
                    estimateLineId: undefined,
                    existingLedgerId: undefined,
                    ...(value === "__overhead"
                      ? { category: "General Overhead" as const }
                      : {}),
                  }
                : {}),
            }
          : a,
      ),
    );
  return (
    <form action={purchaseAction}>
      <input type="hidden" name="operation" value="review" />
      <input type="hidden" name="purchaseId" value={purchaseId} />
      <input type="hidden" name="version" value={version} />
      <input
        type="hidden"
        name="allocations"
        value={JSON.stringify(
          rows.map((a) => ({
            ...a,
            projectId:
              a.projectId && a.projectId !== "__overhead"
                ? a.projectId
                : undefined,
            estimateLineId: a.estimateLineId || undefined,
            existingLedgerId: a.existingLedgerId || undefined,
          })),
        )}
      />
      {rows.map((a, i) => (
        <fieldset className="panel" key={i}>
          <legend>Allocation {i + 1}</legend>
          <div className="operations-fields">
            <label>
              Purchase line
              <select
                value={a.lineId}
                onChange={(e) => set(i, "lineId", e.target.value)}
              >
                {lines.map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.description} · {l.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount including tax/discount (USD)
              <input
                required
                inputMode="decimal"
                value={a.amount}
                onChange={(e) => set(i, "amount", e.target.value)}
              />
            </label>
            <label>
              Project or company expense
              <select
                required
                value={a.projectId}
                onChange={(e) => set(i, "projectId", e.target.value)}
              >
                <option value="">Select destination</option>
                <option value="__overhead">
                  Company overhead (no project cost)
                </option>
                {projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name} · {p.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                value={a.category}
                onChange={(e) => set(i, "category", e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Project cost type
              <select
                value={a.costType}
                onChange={(e) => set(i, "costType", e.target.value)}
              >
                {["MATERIAL", "LABOR", "SUBCONTRACTOR", "OTHER"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Original estimate line (optional)
              <select
                value={a.estimateLineId ?? ""}
                onChange={(e) => set(i, "estimateLineId", e.target.value)}
              >
                <option value="">Unallocated to an estimate line</option>
                {projects
                  .find((p) => p.id === a.projectId)
                  ?.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <details>
            <summary>
              Link a cost already recorded — advanced reconciliation
            </summary>
            <p>
              Use only a verified existing ACTUAL entry matching this project,
              cost type and exact amount. This links evidence without adding a
              cost.
            </p>
            <label>
              Existing ledger reference
              <input
                value={a.existingLedgerId ?? ""}
                onChange={(e) => set(i, "existingLedgerId", e.target.value)}
              />
            </label>
          </details>
          <button
            type="button"
            onClick={() => setRows((old) => old.filter((_, j) => i !== j))}
          >
            Remove allocation
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setRows((old) => [
            ...old,
            {
              lineId: lines[0].id,
              amount: "0.00",
              category: "Other",
              costType: "MATERIAL",
              projectId: "",
            },
          ])
        }
      >
        Add split allocation
      </button>
      <label>
        Review / correction reason
        <input name="reason" required minLength={5} maxLength={1000} />
      </label>
      <p>
        All allocations for each line must equal that line total. Saving a
        review does not record any cost.
      </p>
      <Submit>Save classification for review</Submit>
    </form>
  );
}
