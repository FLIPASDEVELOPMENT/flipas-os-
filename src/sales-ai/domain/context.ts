import type { AnalysisMessage, Intelligence } from "./intelligence";
import { textOnly } from "./security";

/** Allowlisted CRM fields only. Notes, financial policies and inferred identities are excluded. */
export type VerifiedCRM = {
  customerName?: string;
  city?: string;
  address?: string;
  serviceType?: string;
  budget?: string;
  timeline?: string;
  stage?: string;
};
export type ReplyContext = {
  known: {
    name: string | null;
    location: string | null;
    address: string | null;
    availability: string | null;
    service: string | null;
    budget: string | null;
    timeline: string | null;
    materials: string[];
  };
  questions: string[];
  crm: VerifiedCRM;
  followUp?: { stage: string; dueAt: string; action: string };
};
const quotedForward =
  /(?:^-{2,}\s*(?:forwarded|original|mensaje)|^Begin forwarded message:|^From:|^De:|^On .+wrote:|^El .+escribi[oó]:)/im;
export function hasForward(messages: AnalysisMessage[]) {
  return messages.some(
    (m) => /^(?:fw|fwd|rv):/i.test(m.subject) || quotedForward.test(m.body),
  );
}
export function directBody(body: string) {
  return textOnly(body).split(quotedForward)[0];
}
export function replyContext(
  info: Intelligence,
  crm: VerifiedCRM,
  language: "EN" | "ES",
): ReplyContext {
  const known = {
    name: crm.customerName || info.customerName,
    location: crm.city || info.projectLocation,
    address: crm.address || info.propertyAddress,
    availability: info.consultationAvailability,
    service:
      crm.serviceType ||
      (info.category === "Other" || info.category === "Not a sales lead"
        ? null
        : info.category),
    budget: crm.budget || info.budget,
    timeline: crm.timeline || info.timeline,
    materials: info.materials,
  };
  // Never ask for email. Ask only what is missing, at most three short questions.
  const questions: string[] = [];
  if (!known.service)
    questions.push(
      language === "ES"
        ? "¿Qué trabajo de remodelación tiene en mente?"
        : "What remodeling work do you have in mind?",
    );
  if (!known.address)
    questions.push(
      language === "ES"
        ? "¿Podría compartir la dirección aproximada de la propiedad?"
        : "Could you share the approximate property address?",
    );
  if (!known.availability)
    questions.push(
      language === "ES"
        ? "¿Qué días u horarios le convienen para una consulta?"
        : "What days or times would suit you for a consultation?",
    );
  return { known, questions: questions.slice(0, 3), crm };
}
export function contextualReply(
  context: ReplyContext,
  language: "EN" | "ES",
  followUp = false,
) {
  const opening =
    language === "ES"
      ? followUp
        ? "Hola, le escribimos para dar seguimiento a su consulta de remodelación."
        : "Gracias por compartir los detalles de su proyecto de remodelación con FLIPAS Home Remodeling."
      : followUp
        ? "Hello, we are following up on your remodeling inquiry."
        : "Thank you for sharing your remodeling project details with FLIPAS Home Remodeling.";
  return (
    opening +
    (context.known.materials.length
      ? (language === "ES"
          ? "\n\nTomamos nota de estos elementos: "
          : "\n\nWe have noted these items: ") +
        context.known.materials.join(", ") +
        "."
      : "") +
    "\n\n" +
    context.questions.join(" ") +
    (language === "ES"
      ? "\n\nQuedamos atentos a su respuesta."
      : "\n\nWe look forward to hearing from you.")
  );
}
export function validateContextualReply(body: string, context: ReplyContext) {
  if (body.length > 1800) throw new Error("INVALID_AI_OUTPUT_UNSAFE");
  // Exact, locally selected questions prevent asking for already known facts.
  if (
    (body.match(/\?/g) ?? []).length !== context.questions.length ||
    !context.questions.every((q) => body.includes(q))
  )
    throw new Error("INVALID_AI_OUTPUT_UNSAFE");
  if (
    /\b(?:free|complimentary|no[- ]cost|gratis|gratuit[ao]s?|sin costo|available|availability confirmed|we can start|we will complete|disponibles?|podemos comenzar|terminaremos)\b/i.test(
      body,
    )
  )
    throw new Error("INVALID_AI_OUTPUT_UNSAFE");
  const extra = context.questions.reduce(
    (text, question) => text.replace(question, ""),
    body,
  );
  if (
    /\b(?:please|could you|can you|share|provide|tell us|env[ií]e|comparta|indique|d[ií]ganos|podr[ií]a)\b[^.!?\n]{0,100}\b(?:email|e-mail|correo|budget|presupuesto|timeline|plazo|materials|materiales|phone|tel[eé]fono)\b/i.test(
      extra,
    )
  )
    throw new Error("INVALID_AI_OUTPUT_UNSAFE");
  // Do not allow a generated greeting to introduce an unverified identity.
  const greeting = body.match(
    /^(?:Dear|Hi|Hello|Hola|Estimad[oa])\s+([^,\n.!?]+)[,!.]/i,
  );
  if (
    greeting &&
    !context.known.name
      ?.toLowerCase()
      .includes(greeting[1].trim().toLowerCase())
  )
    throw new Error("INVALID_AI_OUTPUT_UNSAFE");
  return body;
}
export function followUpSuggestion(
  stage: string | undefined,
  nextAction: string | null,
  nextAt: Date | null,
) {
  if (!stage || ["WON", "LOST"].includes(stage)) return null;
  if (nextAction && nextAt) return { reason: nextAction, dueAt: nextAt, stage };
  return null; // No invented visit or arbitrary two-day schedule.
}
