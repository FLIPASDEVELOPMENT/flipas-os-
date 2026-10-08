"use client";
import {
  BuilderPolicy,
  policyLine,
  allocatedOverheadFromRate,
} from "@/owner/policy";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { DraftInput, LineInput } from "../domain/input";
import { calculateEstimate } from "../domain/calculations";
import { saveEstimatorDraft } from "../server/actions";
export type CatalogRow = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  unit: LineInput["unit"];
  materialCost: string;
  laborCost: string;
  subcontractorCost: string;
  otherDirectCost: string;
  overheadAllocation: string;
  targetMargin: string;
  minimumMargin: string;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string;
};
export type TemplateRow = {
  id: string;
  name: string;
  category: string;
  sections: {
    name: string;
    items: { name: string; unit: LineInput["unit"]; serviceItemId?: string }[];
  }[];
};
export const blankLine = (name = "New service"): LineInput => ({
  name,
  description: "",
  unit: "EACH",
  quantity: "1",
  materialCost: "0",
  laborCost: "0",
  subcontractorCost: "0",
  otherDirectCost: "0",
  overheadAllocation: "0",
  targetMargin: "0",
  minimumMargin: "0",
  overrideUnitPrice: "",
  overrideReason: "",
  taxable: false,
  serviceItemId: "",
});
export default function Builder({
  initial,
  customers,
  opportunities,
  catalog,
  templates,
  canReview,
  threshold,
  policy,
}: {
  initial: DraftInput;
  customers: { id: string; name: string; address: string }[];
  opportunities: { id: string; customerId: string; name: string }[];
  catalog: CatalogRow[];
  templates: TemplateRow[];
  canReview: boolean;
  threshold: string;
  policy?: BuilderPolicy | null;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof DraftInput>(key: K, value: DraftInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const line = (s: number, l: number, patch: Partial<LineInput>) =>
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((sec, i) =>
        i !== s
          ? sec
          : {
              ...sec,
              lines: sec.lines.map((old, j) =>
                j === l ? { ...old, ...patch } : old,
              ),
            },
      ),
    }));
  const select = (s: number, l: number, id: string) => {
    const item = catalog.find((c) => c.id === id);
    line(
      s,
      l,
      item
        ? {
            ...item,
            serviceItemId: id,
            snapshotId: undefined,
            quantity: draft.sections[s].lines[l].quantity,
            overrideUnitPrice: "",
            overrideReason: "",
            taxable: draft.sections[s].lines[l].taxable,
          }
        : { serviceItemId: "", snapshotId: undefined },
    );
  };
  function editSections(
    fn: (v: DraftInput["sections"]) => DraftInput["sections"],
  ) {
    setDraft((d) => ({ ...d, sections: fn(d.sections) }));
  }
  function move(s: number, l: number, delta: number) {
    editSections((sections) =>
      sections.map((sec, i) => {
        if (i !== s) return sec;
        const items = [...sec.lines],
          dest = l + delta;
        if (dest < 0 || dest >= items.length) return sec;
        [items[l], items[dest]] = [items[dest], items[l]];
        return { ...sec, lines: items };
      }),
    );
  }
  let totals: ReturnType<typeof calculateEstimate> | null = null,
    calculationError = "";
  try {
    totals = calculateEstimate(
      draft.sections
        .flatMap((s) => s.lines)
        .map((l) => (policy ? policyLine(l, policy) : l)),
      draft.discountRate,
      draft.taxRate,
      draft.taxTreatment,
      policy?.significantDiscountThreshold ?? threshold,
    );
    if (policy) {
      totals.allocatedOverhead = allocatedOverheadFromRate(
        totals.sellingPrice,
        policy.overheadRate,
      );
      totals.contributionProfit = new Decimal(totals.grossProfit)
        .minus(totals.allocatedOverhead)
        .toFixed(2);
    }
  } catch (e) {
    calculationError =
      e instanceof Error ? e.message : "Complete the financial fields";
  }
  const number = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    disabled = false,
    step = "0.01",
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </label>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        start(async () => {
          try {
            const result = await saveEstimatorDraft(draft);
            if (result.error) setError(result.error);
            else {
              router.push(`/estimates/${result.id}`);
              router.refresh();
            }
          } catch {
            setError("Request failed; check your connection and reload.");
          }
        });
      }}
    >
      <div className="estimator-toolbar">
        <h2>Draft builder</h2>
        {policy && (
          <p className="muted">
            Financial policy v{policy.version} · Target{" "}
            {new Decimal(policy.targetMargin).mul(100).toString()}% · Minimum{" "}
            {new Decimal(policy.minimumMargin).mul(100).toString()}% · Automatic
            project overhead
          </p>
        )}
        <button disabled={pending}>{pending ? "Saving…" : "Save draft"}</button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="form">
          <label>
            Customer
            <select
              value={draft.customerId}
              disabled={!!draft.id}
              onChange={(e) => {
                const c = customers.find((c) => c.id === e.target.value);
                setDraft((d) => ({
                  ...d,
                  customerId: e.target.value,
                  opportunityId: "",
                  projectAddress: c?.address ?? "",
                }));
              }}
              required
            >
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opportunity (optional)
            <select
              value={draft.opportunityId}
              disabled={!!draft.id}
              onChange={(e) => set("opportunityId", e.target.value)}
            >
              <option value="">No opportunity</option>
              {opportunities
                .filter((o) => o.customerId === draft.customerId)
                .map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Service category
            <input
              value={draft.category}
              maxLength={100}
              onChange={(e) => set("category", e.target.value)}
              required
            />
          </label>
          <label>
            Project address
            <input
              value={draft.projectAddress}
              onChange={(e) => set("projectAddress", e.target.value)}
            />
          </label>
          <label className="wide">
            Scope of work
            <textarea
              value={draft.scope}
              maxLength={4000}
              onChange={(e) => set("scope", e.target.value)}
            />
          </label>
          <label>
            Estimated duration (days)
            <input
              type="number"
              min="1"
              max="3650"
              value={draft.durationDays ?? ""}
              onChange={(e) =>
                set(
                  "durationDays",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </label>
          <label>
            Expiration
            <input
              type="date"
              value={draft.expiresAt}
              onChange={(e) => set("expiresAt", e.target.value)}
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <h2>Scope templates</h2>
        <p className="muted">
          Applying a template replaces the current draft sections. Scope
          checklists contain no company prices; price and review every item.
        </p>
        <select
          defaultValue=""
          onChange={(e) => {
            const t = templates.find((t) => t.id === e.target.value);
            if (!t) return;
            setDraft((d) => ({
              ...d,
              category: t.category,
              sections: t.sections.map((s) => ({
                name: s.name,
                lines: s.items.map((item) => {
                  const c = catalog.find((c) => c.id === item.serviceItemId);
                  return c
                    ? { ...blankLine(), ...c, serviceItemId: c.id }
                    : { ...blankLine(item.name), unit: item.unit };
                }),
              })),
            }));
            e.target.value = "";
          }}
        >
          <option value="">Select a template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </section>
      <label className="catalog-search">
        Search catalog
        <input
          value={search}
          placeholder="Search service names…"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {draft.sections.map((sec, s) => (
        <section className="panel" key={s}>
          <div className="estimator-toolbar">
            <label>
              Section name
              <input
                value={sec.name}
                maxLength={200}
                onChange={(e) =>
                  editSections((sections) =>
                    sections.map((v, i) =>
                      i === s ? { ...v, name: e.target.value } : v,
                    ),
                  )
                }
                required
              />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                editSections((sections) => sections.filter((_, i) => i !== s))
              }
            >
              Remove section
            </button>
          </div>
          {sec.lines.map((item, l) => (
            <article className="estimate-line" key={l}>
              <div className="estimator-toolbar">
                <strong>Item {l + 1}</strong>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={l === 0}
                    onClick={() => move(s, l, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={l === sec.lines.length - 1}
                    onClick={() => move(s, l, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      editSections((sections) =>
                        sections.map((v, i) =>
                          i === s
                            ? { ...v, lines: v.lines.filter((_, j) => j !== l) }
                            : v,
                        ),
                      )
                    }
                  >
                    Remove item
                  </button>
                </div>
              </div>
              <div className="form">
                <label>
                  Catalog service
                  <select
                    value={item.serviceItemId ?? ""}
                    onChange={(e) => select(s, l, e.target.value)}
                  >
                    <option value="">Custom service — approval required</option>
                    {item.serviceItemId &&
                      !catalog.some((c) => c.id === item.serviceItemId) && (
                        <option value={item.serviceItemId}>
                          Retained catalog snapshot
                        </option>
                      )}
                    {catalog
                      .filter(
                        (c) =>
                          c.name.toLowerCase().includes(search.toLowerCase()) ||
                          c.id === item.serviceItemId,
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Customer-facing item name
                  <input
                    value={item.name}
                    maxLength={200}
                    onChange={(e) => line(s, l, { name: e.target.value })}
                    required
                  />
                </label>
                <label className="wide">
                  Description
                  <textarea
                    value={item.description}
                    maxLength={4000}
                    onChange={(e) =>
                      line(s, l, { description: e.target.value })
                    }
                  />
                </label>
                <label>
                  Unit
                  <select
                    value={item.unit}
                    disabled={!!item.serviceItemId}
                    onChange={(e) =>
                      line(s, l, { unit: e.target.value as LineInput["unit"] })
                    }
                  >
                    {["EACH", "SQFT", "LINEAR_FT", "HOUR", "DAY", "FLAT"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      ),
                    )}
                  </select>
                </label>
                {number(
                  "Quantity",
                  item.quantity,
                  (v) => line(s, l, { quantity: v }),
                  false,
                  "0.001",
                )}
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
                  <div key={key}>
                    {number(
                      key === "targetMargin"
                        ? "Target gross margin ratio (0.30 = 30%)"
                        : key === "minimumMargin"
                          ? "Minimum gross margin ratio"
                          : key.replace(/([A-Z])/g, " $1"),
                      policy && key.includes("Margin")
                        ? policyLine(item, policy)[key]
                        : item[key],
                      (value) => line(s, l, { [key]: value }),
                      !!item.serviceItemId ||
                        (!!policy &&
                          (key.includes("Margin") ||
                            key === "overheadAllocation")),
                      key.includes("Margin") ? "0.0001" : "0.01",
                    )}
                  </div>
                ))}
                <label>
                  Manual unit selling price override (USD)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.overrideUnitPrice}
                    placeholder="Use calculated price"
                    onChange={(e) =>
                      line(s, l, { overrideUnitPrice: e.target.value })
                    }
                  />
                </label>
                <label>
                  Override audit reason
                  <input
                    value={item.overrideReason}
                    maxLength={4000}
                    onChange={(e) =>
                      line(s, l, { overrideReason: e.target.value })
                    }
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={item.taxable}
                    onChange={(e) => line(s, l, { taxable: e.target.checked })}
                  />
                  Taxable under reviewed tax policy
                </label>
              </div>
              <p className="muted">
                Catalog costs are snapshots; changes here never update the
                catalog. Profitability is internal only.
              </p>
            </article>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              editSections((sections) =>
                sections.map((v, i) =>
                  i === s ? { ...v, lines: [...v.lines, blankLine()] } : v,
                ),
              )
            }
          >
            Add service / custom item
          </button>
        </section>
      ))}
      <p>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            editSections((sections) => [
              ...sections,
              { name: "New section", lines: [] },
            ])
          }
        >
          Add section
        </button>
      </p>
      <section className="panel">
        <h2>Commercial terms</h2>
        <div className="form">
          {number(
            "Discount ratio (0.05 = 5%)",
            draft.discountRate,
            (v) => set("discountRate", v),
            false,
            "0.0001",
          )}
          <label>
            Tax treatment — Owner/Admin review
            <select
              value={draft.taxTreatment}
              disabled={!canReview}
              onChange={(e) =>
                set(
                  "taxTreatment",
                  e.target.value as DraftInput["taxTreatment"],
                )
              }
            >
              <option>UNREVIEWED</option>
              <option>EXEMPT</option>
              <option>TAXABLE</option>
            </select>
          </label>
          {number(
            "Reviewed tax rate ratio",
            draft.taxRate,
            (v) => set("taxRate", v),
            !canReview,
            "0.0001",
          )}
          {(["inclusions", "exclusions", "notes"] as const).map((key) => (
            <label key={key}>
              {key === "notes"
                ? "Internal notes — excluded from proposal"
                : key}
              <textarea
                maxLength={4000}
                value={draft[key]}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <h2 style={{ marginTop: 24 }}>Payment milestones</h2>
        <p className="muted">
          Ratios must sum to 1 (100%). Approval requires a complete schedule.
        </p>
        {draft.paymentSchedule.map((m, i) => (
          <div className="milestone" key={i}>
            <input
              aria-label="Milestone label"
              value={m.label}
              onChange={(e) =>
                set(
                  "paymentSchedule",
                  draft.paymentSchedule.map((v, j) =>
                    j === i ? { ...v, label: e.target.value } : v,
                  ),
                )
              }
              required
            />
            <input
              aria-label="Milestone ratio"
              type="number"
              step="0.0001"
              min="0"
              max="1"
              value={m.percentage}
              onChange={(e) =>
                set(
                  "paymentSchedule",
                  draft.paymentSchedule.map((v, j) =>
                    j === i ? { ...v, percentage: e.target.value } : v,
                  ),
                )
              }
              required
            />
            <button
              className="secondary"
              type="button"
              onClick={() =>
                set(
                  "paymentSchedule",
                  draft.paymentSchedule.filter((_, j) => j !== i),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            set("paymentSchedule", [
              ...draft.paymentSchedule,
              { label: "New milestone", percentage: "0" },
            ])
          }
        >
          Add milestone
        </button>
      </section>
      <section className="panel totals-panel" aria-live="polite">
        <h2>Internal financial summary · USD</h2>
        {calculationError && <p className="error">{calculationError}</p>}
        {totals && (
          <>
            <div className="financial-grid">
              {[
                ["Direct cost", totals.directCost],
                ["Allocated overhead", totals.allocatedOverhead],
                ["Discount", totals.discountAmount],
                ["Net selling price", totals.sellingPrice],
                ["Tax", totals.taxAmount],
                ["Customer investment", totals.totalInvestment],
                ["Gross profit", totals.grossProfit],
                ["Profit after allocated overhead", totals.contributionProfit],
              ].map(([k, v]) => (
                <div key={k}>
                  <span className="muted">{k}</span>
                  <strong>${v}</strong>
                </div>
              ))}
              <div>
                <span className="muted">Gross margin</span>
                <strong>
                  {totals.grossMargin === null
                    ? "N/A"
                    : `${new Decimal(totals.grossMargin).mul(100).toFixed(2)}%`}
                </strong>
              </div>
            </div>
            <p className="muted">Review flags: {totals.reasons.join(" · ")}</p>
          </>
        )}
        <button disabled={pending || !!calculationError}>
          {pending ? "Saving…" : "Save draft"}
        </button>
      </section>
    </form>
  );
}
