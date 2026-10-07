export interface ProposalSource {
  number: string | null;
  id: string;
  revision: number;
  status: string;
  category: string;
  projectAddress: string;
  scope: string;
  inclusions: string;
  exclusions: string;
  durationDays: number | null;
  expiresAt: Date | null;
  paymentSchedule: unknown;
  customerSnapshot: unknown;
  businessSnapshot: unknown;
  sellingPrice: { toString(): string };
  discountAmount: { toString(): string };
  taxAmount: { toString(): string };
  totalInvestment: { toString(): string };
  sections: {
    name: string;
    lines: {
      name: string;
      description: string;
      unit: string;
      quantity: { toString(): string };
      unitPrice: { toString(): string };
      sellingPrice: { toString(): string };
    }[];
  }[];
}
function strings(v: unknown) {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
export function proposalDTO(e: ProposalSource) {
  const c = strings(e.customerSnapshot),
    b = strings(e.businessSnapshot);
  return {
    number: e.number ?? e.id,
    revision: e.revision,
    status: e.status,
    draft: !["SENT", "ACCEPTED"].includes(e.status),
    company: {
      name:
        typeof b.companyName === "string"
          ? b.companyName
          : "Flipas Home Remodeling",
      contact:
        typeof b.contactInfo === "string"
          ? b.contactInfo
          : "[Business contact information pending]",
      color: typeof b.brandingColor === "string" ? b.brandingColor : "#172b30",
      terms:
        typeof b.terms === "string"
          ? b.terms
          : "[Terms require business-owner review]",
    },
    customer: {
      name: typeof c.name === "string" ? c.name : "Customer",
      email: typeof c.email === "string" ? c.email : "",
      phone: typeof c.phone === "string" ? c.phone : "",
    },
    category: e.category,
    address: e.projectAddress,
    scope: e.scope,
    inclusions: e.inclusions,
    exclusions: e.exclusions,
    durationDays: e.durationDays,
    expiresAt: e.expiresAt?.toISOString().slice(0, 10) ?? "Not set",
    milestones: Array.isArray(e.paymentSchedule)
      ? e.paymentSchedule.map((p) => {
          const v = strings(p);
          return {
            label: typeof v.label === "string" ? v.label : "Milestone",
            percentage: typeof v.percentage === "string" ? v.percentage : "0",
          };
        })
      : [],
    sections: e.sections.map((s) => ({
      name: s.name,
      lines: s.lines.map((l) => ({
        name: l.name,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        price: l.sellingPrice.toString(),
      })),
    })),
    discount: e.discountAmount.toString(),
    netPrice: e.sellingPrice.toString(),
    tax: e.taxAmount.toString(),
    total: e.totalInvestment.toString(),
  };
}
export type Proposal = ReturnType<typeof proposalDTO>;
