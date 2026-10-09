import { z } from "zod";
export const states = [
  "PLANNING",
  "SCHEDULED",
  "IN_PROGRESS",
  "ON_HOLD",
  "QUALITY_REVIEW",
  "COMPLETED",
  "CANCELLED",
] as const;
export type State = (typeof states)[number];
export function canonicalState(value: string): State {
  if (["PRE_CONSTRUCTION", "MATERIAL_ORDERING"].includes(value))
    return "PLANNING";
  if (value === "PUNCH_LIST") return "QUALITY_REVIEW";
  if (!states.includes(value as State)) throw new Error("INVALID_STATE");
  return value as State;
}
const transitions: Record<State, State[]> = {
  PLANNING: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["PLANNING", "IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "QUALITY_REVIEW", "CANCELLED"],
  ON_HOLD: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  QUALITY_REVIEW: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
export function validTransition(from: string, to: State) {
  if (!transitions[canonicalState(from)].includes(to))
    throw new Error("INVALID_TRANSITION");
}
export const text = z.string().trim().min(1).max(2000);
export const id = z.string().min(1).max(200);
export const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
export const signedMoney = z.string().regex(/^-?\d{1,10}(?:\.\d{1,2})?$/);
export const quantity = z
  .string()
  .regex(/^\d{1,10}(?:\.\d{1,4})?$/)
  .refine((v) => Number(v) > 0);
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  )
  .transform((v) => new Date(v + "T12:00:00Z"));
export const managers = ["OWNER", "ADMIN", "PROJECT_MANAGER"];
export const financialRoles = ["OWNER", "ADMIN"];
export function overdue(
  due: Date | null,
  completed: Date | null,
  now = new Date(),
) {
  return !!due && !completed && due < now;
}
export function assertAcyclic(
  taskId: string,
  prerequisiteId: string,
  edges: { taskId: string; prerequisiteId: string }[],
) {
  if (taskId === prerequisiteId) throw new Error("DEPENDENCY_CYCLE");
  const visit = (current: string, seen = new Set<string>()): boolean => {
    if (current === taskId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    return edges
      .filter((e) => e.taskId === current)
      .some((e) => visit(e.prerequisiteId, seen));
  };
  if (visit(prerequisiteId)) throw new Error("DEPENDENCY_CYCLE");
}
export const templates = [
  {
    name: "Kitchen Remodeling",
    stages: [
      {
        title: "Site preparation",
        tasks: ["Protect occupied areas", "Confirm field measurements"],
      },
      {
        title: "Installation",
        tasks: [
          "Install cabinets",
          "Install countertops",
          "Install backsplash and lighting",
        ],
      },
      {
        title: "Quality review",
        tasks: ["Inspect finishes", "Review punch list"],
      },
    ],
  },
  {
    name: "Bathroom Remodeling",
    stages: [
      {
        title: "Preparation",
        tasks: ["Protect occupied areas", "Confirm plumbing scope"],
      },
      {
        title: "Installation",
        tasks: ["Inspect waterproofing", "Install fixtures and tile"],
      },
      {
        title: "Quality review",
        tasks: ["Check leaks and drainage", "Inspect finishes"],
      },
    ],
  },
  {
    name: "LVP Flooring",
    stages: [
      {
        title: "Preparation",
        tasks: ["Measure floor areas", "Check substrate and moisture"],
      },
      {
        title: "Installation",
        tasks: ["Prepare substrate", "Install LVP and transitions"],
      },
      {
        title: "Quality review",
        tasks: ["Inspect floor and trims", "Review punch list"],
      },
    ],
  },
];
export const templateDefinition = z
  .object({
    stages: z
      .array(z.object({ title: text, tasks: z.array(text).min(1).max(30) }))
      .min(1)
      .max(20),
  })
  .strict();
