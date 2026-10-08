import { directBody } from "./context";
import { z } from "zod";
export const classification = z.enum([
  "Kitchen Remodeling",
  "Bathroom Remodeling",
  "Flooring",
  "Painting",
  "Drywall",
  "General Remodeling",
  "Other",
  "Not a sales lead",
]);
const nullable = z.string().max(1000).nullable();
export const mailKind = z.enum([
  "POTENTIAL_CUSTOMER",
  "EXISTING_CUSTOMER",
  "SUPPLIER",
  "ADVERTISEMENT",
  "SPAM",
  "OTHER",
]);
export const intelligenceSchema = z.object({
  mailKind: mailKind.default("OTHER"),
  language: z.enum(["EN", "ES", "UNKNOWN"]).default("UNKNOWN"),
  needsHumanReview: z.boolean().default(true),
  category: classification,
  source: z.literal("MAIL"),
  customerName: nullable,
  email: z.email().nullable(),
  phone: nullable,
  projectLocation: nullable,
  propertyAddress: nullable.default(null),
  consultationAvailability: nullable.default(null),
  materials: z.array(z.string().max(200)).max(20).default([]),
  requestedServices: z.array(z.string().max(200)).max(20),
  budget: nullable,
  timeline: nullable,
  urgency: z.enum(["NORMAL", "URGENT", "UNKNOWN"]),
  missingInformation: z.array(z.string().max(200)).max(20),
  summary: z.string().max(2000),
  confidence: z.number().min(0).max(1),
  evidence: z
    .array(
      z.object({
        field: z.string().max(100),
        messageId: z.string(),
        quote: z.string().max(1000),
      }),
    )
    .max(30),
  questions: z.array(z.string().max(300)).max(10),
  recommendedTemplate: z.string().nullable(),
});
export type Intelligence = z.infer<typeof intelligenceSchema>;
export type AnalysisMessage = {
  direction?: string;
  id: string;
  fromEmail: string;
  subject: string;
  body: string;
};
export function validateEvidence(value: unknown, messages: AnalysisMessage[]) {
  const result = intelligenceSchema.parse(value);
  for (const proof of result.evidence) {
    const m = messages.find((m) => m.id === proof.messageId);
    if (!m || !`${m.subject}\n${m.body}`.includes(proof.quote))
      throw new Error("INVALID_AI_OUTPUT");
  }
  for (const material of result.materials)
    if (
      !result.evidence.some(
        (e) => e.field === "materials" && e.quote.includes(material),
      )
    )
      throw new Error("INVALID_AI_OUTPUT");
  for (const field of [
    "customerName",
    "phone",
    "projectLocation",
    "propertyAddress",
    "consultationAvailability",
    "budget",
    "timeline",
  ] as const)
    if (
      result[field] !== null &&
      !result.evidence.some(
        (e) => e.field === field && e.quote.includes(result[field]!),
      )
    )
      throw new Error("INVALID_AI_OUTPUT");
  if (
    result.email &&
    !messages.some(
      (m) => m.fromEmail.toLowerCase() === result.email!.toLowerCase(),
    )
  )
    throw new Error("INVALID_AI_OUTPUT");
  return result;
}
export function mockIntelligence(messages: AnalysisMessage[]): Intelligence {
  const m = messages.at(-1)!;
  const history = messages
    .filter((message) => message.direction !== "OUTBOUND")
    .slice(-6)
    .reverse();
  const direct = history.map((message) => directBody(message.body)).join("\n");
  const text = history
    .map((message) => message.subject + "\n" + directBody(message.body))
    .join("\n");
  const latestText = m.subject + "\n" + directBody(m.body);
  const notSales =
    /unsubscribe|newsletter|automated notification|password reset|offer expires|lottery|marketing specialist|custom website|create a.{0,20}website|sitio web|publicidad/i.test(
      latestText,
    );
  let category: Intelligence["category"] = "Not a sales lead";
  if (!notSales) {
    if (/kitchen|cabinet|cocina/i.test(text)) category = "Kitchen Remodeling";
    else if (/bathroom|shower|baño/i.test(text))
      category = "Bathroom Remodeling";
    else if (/flooring|lvp|pisos/i.test(text)) category = "Flooring";
    else if (/painting|pintura/i.test(text)) category = "Painting";
    else if (/drywall/i.test(text)) category = "Drywall";
    else if (/remodel|renova/i.test(text)) category = "General Remodeling";
  }
  const budget = text.match(
    /(?:budget|presupuesto)[^\n$]{0,60}(\$[\d,]+(?:\.\d{2})?)/i,
  );
  const evidence: Intelligence["evidence"] = [];
  const fact = (field: string, value: string | null) => {
    const source = value
      ? history.find((message) =>
          `${message.subject}\n${message.body}`.includes(value),
        )
      : null;
    if (value && source)
      evidence.push({ field, messageId: source.id, quote: value });
    return value;
  };
  const customerName =
    direct.match(
      /(?:my name is|I am|I'm|soy|me llamo)\s+([\p{L}]+(?: [\p{L}]+){1,3})/iu,
    )?.[1] ?? null;
  const location =
    text.match(/\b(?:Tampa|Orlando|Miami)(?:,? (?:FL|Florida))?\b/i)?.[0] ??
    null;
  const timeline =
    text.match(
      /\b\d+(?:\s*[-–]\s*\d+)?\s*(?:weeks?|semanas?|months?|meses)\b/i,
    )?.[0] ?? null;
  const range =
    text.match(
      /(?:budget|presupuesto)[^\n$]{0,60}(\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?)/i,
    )?.[1] ??
    budget?.[1] ??
    null;
  const materials = [
    ...new Set(
      text.match(
        /\b(?:cabinets|gabinetes|countertops|encimeras|backsplash|LED)\b/gi,
      ) ?? [],
    ),
  ];
  for (const value of materials) fact("materials", value);
  if (category !== "Not a sales lead")
    fact(
      "requestedServices",
      /kitchen|cabinet|cocina/i.test(text)
        ? (text.match(/kitchen|cabinet|cocina/i)?.[0] ?? null)
        : null,
    );

  return {
    mailKind:
      category === "Not a sales lead"
        ? /marketing|website|sitio web|publicidad/i.test(text)
          ? "ADVERTISEMENT"
          : "OTHER"
        : "POTENTIAL_CUSTOMER",
    language: /hola|quiero|presupuesto|cocina|baño/i.test(text) ? "ES" : "EN",
    needsHumanReview: true,
    category,
    source: "MAIL",
    customerName: fact("customerName", customerName),
    email: m.fromEmail,
    phone: null,
    projectLocation: fact("projectLocation", location),
    propertyAddress: fact(
      "propertyAddress",
      direct.match(
        /(?:address is|property is at|direcci[oó]n es|propiedad est[aá] en)\s+([^\n.!?]+)/i,
      )?.[1] ?? null,
    ),
    consultationAvailability: fact(
      "consultationAvailability",
      direct.match(/(?:available|disponible)\s+([^\n.!?]+)/i)?.[1] ?? null,
    ),
    materials,
    requestedServices: category === "Not a sales lead" ? [] : [category],
    budget: fact("budget", range),
    timeline: fact("timeline", timeline),
    urgency: "UNKNOWN",
    missingInformation: [
      "Customer name",
      "Property address",
      "Project timeline",
    ],
    summary:
      category === "Not a sales lead"
        ? "Development mock: unrelated or automated correspondence."
        : `Development mock: potential ${category.toLowerCase()} inquiry; human verification required.`,
    confidence: 0.5,
    evidence,
    questions: [
      "What is the property address?",
      "What work would you like completed?",
      "What is your desired timeline?",
    ],
    recommendedTemplate: [
      "Kitchen Remodeling",
      "Bathroom Remodeling",
      "Flooring",
    ].includes(category)
      ? category
      : null,
  };
}
export function mockReply(
  language: "EN" | "ES",
  purpose: "QUALIFY" | "FOLLOW_UP" = "QUALIFY",
) {
  if (purpose === "FOLLOW_UP")
    return language === "ES"
      ? "Le escribimos para dar seguimiento a su consulta de remodelación. Si aún planea realizar el proyecto, ¿qué horario prefiere para conversar sobre los próximos pasos?"
      : "Following up on your remodeling inquiry. If you are still planning the project, what time would you prefer to discuss the next steps?";
  return language === "ES"
    ? "Gracias por contactar a Flipas Home Remodeling. ¿Podría compartir la dirección de la propiedad, el alcance del trabajo y su fecha deseada? Con esa información podemos conversar sobre una visita para evaluar su proyecto."
    : "Thank you for contacting Flipas Home Remodeling. Could you share the property address, the work you need, and your desired timeline? With that information we can discuss a visit to assess your project.";
}
