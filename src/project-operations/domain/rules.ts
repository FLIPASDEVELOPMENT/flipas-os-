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
export const financialRoles = ["OWNER"];
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
const stage = (title: string, tasks: Record<string, string[]>) => ({
  title,
  tasks: Object.keys(tasks),
  checklists: tasks,
});
export const templates = [
  {
    name: "Kitchen Remodeling",
    stages: [
      stage("Preparation and protection", {
        "Protect occupied areas": [
          "Confirm access, isolation and dust protection",
          "Photograph existing surfaces and appliance condition",
        ],
        "Confirm field measurements": [
          "Verify cabinet dimensions, openings and approved scope",
          "Record conflicting site conditions before work",
        ],
      }),
      stage("Pre-installation checks", {
        "Verify materials and rough services": [
          "Check delivery counts and visible damage",
          "Verify approved cabinet layout and service clearances; escalate discrepancies",
        ],
      }),
      stage("Installation", {
        "Install cabinets": [
          "Check level, alignment, anchorage and door operation",
          "Photograph anchorage before concealment",
        ],
        "Install countertops": [
          "Verify fit, seams and supports against approved specifications",
          "Check finish and protect installed surfaces",
        ],
        "Install backsplash and lighting": [
          "Check alignment, joints and approved lighting layout",
          "Record electrical verification by authorized personnel",
        ],
      }),
      stage("Inspection and punch list", {
        "Inspect finishes": [
          "Check doors, drawers, joints and surface defects",
          "Record inspection photos",
        ],
        "Resolve punch list": [
          "Record defects and blocking status",
          "Verify repairs before requesting final inspection",
        ],
      }),
      stage("Handover", {
        "Document final handover": [
          "Record final approved inspection and handover photos",
          "Record care documentation and outstanding items; do not promise unconfigured warranties",
        ],
      }),
    ],
  },
  {
    name: "Bathroom Remodeling",
    stages: [
      stage("Preparation", {
        "Protect occupied areas": [
          "Confirm isolation, access and surface protection",
          "Photograph existing conditions",
        ],
        "Confirm plumbing scope": [
          "Verify approved fixture layout and dimensions",
          "Escalate concealed conditions before scope changes",
        ],
      }),
      stage("Pre-installation checks", {
        "Verify substrate and materials": [
          "Check substrate condition and delivered materials",
          "Confirm approved waterproofing system and manufacturer requirements",
        ],
      }),
      stage("Installation", {
        "Inspect waterproofing": [
          "Document membrane, corners and penetrations before concealment",
          "Record required inspection/test result before covering",
        ],
        "Install fixtures and tile": [
          "Check alignment, joints, drainage and fixture operation",
          "Document authorized plumbing/electrical verification",
        ],
      }),
      stage("Inspection and punch list", {
        "Check leaks and drainage": [
          "Document test conditions and results",
          "Report defects and any unresolved blocking issue",
        ],
        "Inspect finishes": [
          "Check sealants, edges and fixtures",
          "Photograph finish defects and verified repairs",
        ],
      }),
      stage("Handover", {
        "Document final handover": [
          "Record final inspection approval and handover evidence",
          "Provide care documentation and list any outstanding items",
        ],
      }),
    ],
  },
  {
    name: "LVP Flooring",
    stages: [
      stage("Preparation", {
        "Measure floor areas": [
          "Verify dimensions, transitions and approved installation scope",
          "Photograph existing floor and protect adjacent finishes",
        ],
        "Check substrate and moisture": [
          "Record moisture/flatness checks against product requirements",
          "Escalate unsuitable substrate before installation",
        ],
      }),
      stage("Pre-installation checks", {
        "Verify flooring materials": [
          "Check product, batch, damage and quantities",
          "Confirm manufacturer acclimation and expansion requirements",
        ],
      }),
      stage("Installation", {
        "Prepare substrate": [
          "Document repairs and readiness before covering",
          "Confirm cleanliness and approved underlay",
        ],
        "Install LVP and transitions": [
          "Verify approved layout, joints and expansion gaps",
          "Photograph transitions and perimeter details",
        ],
      }),
      stage("Inspection and punch list", {
        "Inspect floor and trims": [
          "Check joints, edges, movement and trim finish",
          "Record inspection photos",
        ],
        "Resolve punch list": [
          "Record and resolve blocking defects",
          "Verify repairs with evidence",
        ],
      }),
      stage("Handover", {
        "Document final handover": [
          "Record approved final inspection and handover photos",
          "Provide product care documentation without inventing warranties",
        ],
      }),
    ],
  },
];
export const templateDefinition = z
  .object({
    stages: z
      .array(
        z
          .object({
            title: text,
            tasks: z.array(text).min(1).max(30),
            checklists: z
              .record(z.string(), z.array(text).min(1).max(15))
              .optional(),
          })
          .strict()
          .refine(
            (s) =>
              Object.keys(s.checklists ?? {}).every((key) =>
                s.tasks.includes(key),
              ),
            "Checklist must reference an existing task",
          ),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine(
    (d) => d.stages.reduce((n, s) => n + s.tasks.length, 0) <= 200,
    "Template exceeds 200 tasks",
  );
