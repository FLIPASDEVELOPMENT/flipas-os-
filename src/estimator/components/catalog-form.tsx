"use client";
import { useState } from "react";
import { catalogAction } from "../server/actions";
import type { CatalogRow } from "./builder";
export default function CatalogForm({
  item,
  categories,
}: {
  item?: CatalogRow;
  categories: { id: string; name: string }[];
}) {
  const [data, setData] = useState({
    ...item,
    id: item?.id ?? undefined,
    categoryId: item?.categoryId ?? categories[0]?.id ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    unit: item?.unit ?? "EACH",
    materialCost: item?.materialCost ?? "0",
    laborCost: item?.laborCost ?? "0",
    subcontractorCost: item?.subcontractorCost ?? "0",
    otherDirectCost: item?.otherDirectCost ?? "0",
    overheadAllocation: item?.overheadAllocation ?? "0",
    targetMargin: item?.targetMargin ?? "0",
    minimumMargin: item?.minimumMargin ?? "0",
    active: item?.active ?? true,
    effectiveFrom: item?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
    effectiveTo: item?.effectiveTo ?? "",
    reason: "",
  });
  const set = (key: string, value: unknown) =>
    setData((d) => ({ ...d, [key]: value }));
  return (
    <form action={catalogAction} className="form">
      <input type="hidden" name="payload" value={JSON.stringify(data)} />
      <label>
        Name
        <input
          required
          value={data.name}
          maxLength={200}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>
      <label>
        Category
        <select
          value={data.categoryId}
          onChange={(e) => set("categoryId", e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Description
        <textarea
          value={data.description}
          maxLength={4000}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <label>
        Unit
        <select value={data.unit} onChange={(e) => set("unit", e.target.value)}>
          {["EACH", "SQFT", "LINEAR_FT", "HOUR", "DAY", "FLAT"].map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
      {(
        [
          "materialCost",
          "laborCost",
          "subcontractorCost",
          "otherDirectCost",
          "overheadAllocation",
          "targetMargin",
          "minimumMargin",
        ] as const
      ).map((key) => (
        <label key={key}>
          {key.replace(/([A-Z])/g, " $1")}
          {key.includes("Margin") ? " ratio (0.30 = 30%)" : " (USD/unit)"}
          <input
            type="number"
            min="0"
            step={key.includes("Margin") ? "0.0001" : "0.01"}
            required
            value={data[key]}
            onChange={(e) => set(key, e.target.value)}
          />
        </label>
      ))}
      <label>
        Effective from
        <input
          type="date"
          required
          value={data.effectiveFrom}
          onChange={(e) => set("effectiveFrom", e.target.value)}
        />
      </label>
      <label>
        Effective until (exclusive)
        <input
          type="date"
          value={data.effectiveTo}
          onChange={(e) => set("effectiveTo", e.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={data.active}
          onChange={(e) => set("active", e.target.checked)}
        />
        Active
      </label>
      <label className="wide">
        Reason for this pricing change
        <input
          required
          value={data.reason}
          maxLength={4000}
          onChange={(e) => set("reason", e.target.value)}
        />
      </label>
      <button>{item ? "Save catalog change" : "Create service item"}</button>
    </form>
  );
}
