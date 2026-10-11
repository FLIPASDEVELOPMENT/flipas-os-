import { z } from "zod";
import { categories } from "./categories";
import type { PurchaseData, Allocations } from "./validation";
export const CLASSIFIER_VERSION = "purchase-classifier-v1";
export type Candidate = {
  projectId: string;
  code: string;
  name: string;
  aliases: string[];
  lines: { id: string; name: string }[];
};
export function aliasKey(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}
/** Code only at the beginning of a job label, followed by whitespace or end. No substrings, suffixes or zero stripping. */
export function jobCode(value: string): string | null {
  const m = /^f-?(\d{3,})(?=$|\s)/i.exec(value.normalize("NFKC").trim());
  if (!m || /^0+$/.test(m[1]) || (m[1].length > 3 && m[1].startsWith("0")))
    return null;
  return "F" + m[1];
}
export function matchProject(labels: string[], candidates: Candidate[]) {
  const codes = [
    ...new Set(labels.map(jobCode).filter((c): c is string => c !== null)),
  ];
  if (codes.length) {
    const found = candidates.filter((c) => codes.includes(c.code));
    return {
      projectId:
        codes.length === 1 && found.length === 1 ? found[0].projectId : null,
      candidates: found.map((c) => c.projectId),
      method: "CODE",
      ambiguous: codes.length !== 1 || found.length !== 1,
    };
  }
  const keys = labels.filter(Boolean).map(aliasKey);
  const aliases = candidates.filter((c) =>
    c.aliases.some((a) => keys.includes(aliasKey(a))),
  );
  if (aliases.length)
    return {
      projectId: aliases.length === 1 ? aliases[0].projectId : null,
      candidates: aliases.map((c) => c.projectId),
      method: "ALIAS",
      ambiguous: aliases.length !== 1,
    };
  const named = candidates.filter((c) => keys.includes(aliasKey(c.name)));
  return {
    projectId: null,
    candidates: named.map((c) => c.projectId),
    method: named.length ? "NAME_REVIEW" : "UNKNOWN",
    ambiguous: named.length > 1,
  };
}
export const suggestionSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        lineId: z.string().min(1).max(200),
        projectId: z.string().max(200).nullable(),
        category: z.enum(categories).nullable(),
        estimateLineId: z.string().max(200).nullable(),
        costType: z.enum(["MATERIAL", "LABOR", "SUBCONTRACTOR", "OTHER"]),
        overhead: z.boolean(),
        confidence: z.number().min(0).max(1),
        explanation: z.string().min(1).max(800),
        evidence: z
          .array(
            z.strictObject({
              field: z.enum([
                "description",
                "sku",
                "job_name",
                "project_name",
                "po_number",
              ]),
              quote: z.string().min(1).max(500),
            }),
          )
          .max(6),
      }),
    )
    .min(1)
    .max(20),
  needsHumanReview: z.boolean(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;
export function sourceView(d: PurchaseData) {
  const clean = (s: string) =>
    s
      .slice(0, 500)
      .replace(
        /(?:password|api[_ -]?key|secret|authorization)\s*[:=]\s*\S+|Bearer\s+[A-Za-z0-9._-]+|\bsk-[A-Za-z0-9_-]{10,}/gi,
        "[redacted]",
      );
  return {
    summaryOnly: Boolean(d.native),
    job_name: clean(d.header.job_name),
    project_name: clean(d.native?.projectName ?? ""),
    po_number: clean(d.header.po_number),
    lines: d.lines.map((l) => ({
      lineId: l.line_id,
      description: clean(l.description),
      sku: clean(l.sku),
    })),
  };
}
const categoryEvidence: Record<string, RegExp> = {
  Cabinets: /\b(cabinets?|cabinetry|gabinetes?|armarios?)\b/i,
  Countertops: /\b(countertops?|encimeras?|quartz|cuarzo|granite|granito)\b/i,
  Tile: /\b(tiles?|azulejos?|baldosas?|backsplash|ceramic|porcelain|porcelana)\b/i,
  Plumbing:
    /\b(plumbing|plomer[ií]a|pipes?|tuber[ií]as?|faucets?|grifos?|toilets?|inodoros?)\b/i,
  Electrical:
    /\b(electrical|el[eé]ctric[ao]s?|wires?|cables?|led|lighting|iluminaci[oó]n|outlets?)\b/i,
  Flooring: /\b(flooring|floors?|pisos?|lvp|laminate|laminado|vinyl|vinilo)\b/i,
  Drywall: /\b(drywall|sheetrock|yeso)\b/i,
  Paint: /\b(paint|painting|pintura|pintar|primer)\b/i,
  Labor:
    /\b(labor|labour|mano de obra|installation service|servicio de instalaci[oó]n)\b/i,
  Subcontractors: /\b(subcontractors?|subcontratistas?)\b/i,
  Equipment: /\b(equipment|equipos?|tool rental|alquiler de herramientas)\b/i,
  "General Overhead":
    /\b(overhead|office|oficina|administrative|administraci[oó]n)\b/i,
};
export function validateSuggestion(
  value: unknown,
  d: PurchaseData,
  candidates: Candidate[],
): Suggestion {
  const s = suggestionSchema.parse(value),
    source = sourceView(d);
  if (!s.needsHumanReview) throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
  if (
    s.lines.length !== d.lines.length ||
    new Set(s.lines.map((l) => l.lineId)).size !== d.lines.length
  )
    throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
  const match = matchProject(
    [d.header.job_name, d.native?.projectName ?? "", d.header.po_number],
    candidates,
  );
  for (const l of s.lines) {
    if (
      /[$€£]\s*\d|\b\d+(?:[.,]\d+)?\s*(?:USD|dollars?|d[oó]lares|units?|unidades)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\bsk-[A-Za-z0-9_-]{10,}/i.test(
        l.explanation,
      )
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    const original = source.lines.find((x) => x.lineId === l.lineId),
      project = candidates.find((p) => p.projectId === l.projectId);
    if (
      !original ||
      (l.projectId && !project) ||
      (l.estimateLineId &&
        !project?.lines.some((x) => x.id === l.estimateLineId))
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (
      l.evidence.some(
        (e) =>
          !(
            e.field === "description" || e.field === "sku"
              ? original[e.field]
              : source[e.field]
          ).includes(e.quote),
      )
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (
      l.projectId &&
      ![match.projectId, ...match.candidates].includes(l.projectId)
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (l.projectId && match.method === "NAME_REVIEW" && l.confidence > 0.6)
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (l.projectId && match.projectId && l.projectId !== match.projectId)
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (l.projectId && match.ambiguous)
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (
      l.projectId &&
      !l.evidence.some((e) =>
        ["job_name", "project_name", "po_number"].includes(e.field),
      )
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (
      l.overhead &&
      (l.projectId || l.estimateLineId || l.category !== "General Overhead")
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (
      l.category &&
      !["Other", "General Overhead"].includes(l.category) &&
      !l.evidence.some((e) => e.field === "description" || e.field === "sku")
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (
      l.estimateLineId &&
      !l.evidence.some((e) => e.field === "description" || e.field === "sku")
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    const itemEvidence = l.evidence
      .filter((e) => e.field === "description" || e.field === "sku")
      .map((e) => e.quote)
      .join(" ");
    if (
      l.category &&
      categoryEvidence[l.category] &&
      !categoryEvidence[l.category].test(itemEvidence)
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (l.costType === "LABOR" && !categoryEvidence.Labor.test(itemEvidence))
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (
      l.costType === "SUBCONTRACTOR" &&
      !categoryEvidence.Subcontractors.test(itemEvidence)
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (l.costType === "MATERIAL" && !itemEvidence)
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    if (l.estimateLineId) {
      const name = project!.lines.find((x) => x.id === l.estimateLineId)!.name;
      const tokens = aliasKey(name).match(/[\p{L}]{3,}/gu) ?? [];
      if (
        !tokens.some(
          (t) =>
            ![
              "the",
              "and",
              "for",
              "installation",
              "service",
              "material",
              "materials",
              "kitchen",
              "bathroom",
            ].includes(t) && aliasKey(itemEvidence).includes(t),
        )
      )
        throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
    }
    if (
      d.native &&
      (l.estimateLineId ||
        (l.category !== null && l.category !== "Other") ||
        l.costType !== "OTHER" ||
        l.overhead)
    )
      throw new Error("INVALID_AI_OUTPUT_EVIDENCE");
  }
  return s;
}
export function rulesSuggestion(
  d: PurchaseData,
  candidates: Candidate[],
): Suggestion {
  const m = matchProject(
      [d.header.job_name, d.native?.projectName ?? "", d.header.po_number],
      candidates,
    ),
    v = sourceView(d);
  return {
    needsHumanReview: true,
    lines: v.lines.map((l) => ({
      lineId: l.lineId,
      projectId: m.projectId,
      category: null,
      estimateLineId: null,
      costType: "OTHER",
      overhead: false,
      confidence: m.projectId ? 1 : 0,
      explanation: d.native
        ? "Transaction summary only: no item or original estimate line can be inferred. OWNER must classify from item evidence."
        : `Project matching: ${m.method}. Category and cost type require item evidence and OWNER review.`,
      evidence: m.projectId
        ? (["job_name", "project_name", "po_number"] as const)
            .filter((f) => v[f])
            .map((field) => ({ field, quote: v[field] }))
        : [],
    })),
  };
}
/** Copy amounts only from immutable evidence, never from the model. This is a form proposal, not a saved review or posting. */
export function proposedAllocations(
  s: Suggestion,
  d: PurchaseData,
): Allocations {
  return s.lines.map((l) => ({
    lineId: l.lineId,
    amount: d.lines.find((x) => x.line_id === l.lineId)!.line_total,
    category: l.category ?? "Other",
    costType: l.costType,
    ...(l.projectId ? { projectId: l.projectId } : {}),
    ...(l.estimateLineId ? { estimateLineId: l.estimateLineId } : {}),
  }));
}
