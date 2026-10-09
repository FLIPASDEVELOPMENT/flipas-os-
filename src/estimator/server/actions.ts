"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCRM } from "@/server/auth";
import * as service from "./service";
async function user() {
  const origin = (await headers()).get("origin");
  const expected =
    process.env.APP_ORIGIN ??
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : null);
  if (!origin || !expected || origin !== new URL(expected).origin)
    throw new Error("Request origin denied");
  return requireCRM();
}
function errorText(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .slice(0, 4)
      .join("; ");
  if (
    error instanceof Error &&
    !/prisma|connector|password|connection|invocation/i.test(error.message)
  )
    return error.message.slice(0, 400);
  return "Unable to complete request. Check your inputs and reload the latest draft.";
}
export async function saveEstimatorDraft(input: unknown) {
  try {
    const id = await service.saveDraft(await user(), input);
    revalidatePath("/", "layout");
    return { id, error: null };
  } catch (error) {
    return { id: null, error: errorText(error) };
  }
}
export async function catalogAction(form: FormData) {
  let error = "";
  try {
    await service.saveCatalog(
      await user(),
      JSON.parse(String(form.get("payload"))),
    );
    revalidatePath("/", "layout");
  } catch (e) {
    error = errorText(e);
  }
  redirect(
    `/estimates/catalog${error ? `?error=${encodeURIComponent(error)}` : ""}`,
  );
}
export async function settingsAction(form: FormData) {
  let error = "";
  try {
    await service.saveSettings(await user(), {
      ...Object.fromEntries(form),
      significantDiscountThreshold: String(
        form.get("significantDiscountThreshold"),
      ),
    });
    revalidatePath("/", "layout");
  } catch (e) {
    error = errorText(e);
  }
  redirect(
    `/estimates/settings${error ? `?error=${encodeURIComponent(error)}` : ""}`,
  );
}
export async function templateAction(form: FormData) {
  let error = "";
  try {
    await service.saveTemplate(
      await user(),
      JSON.parse(String(form.get("payload"))),
    );
    revalidatePath("/", "layout");
  } catch (e) {
    error = errorText(e);
  }
  redirect(
    `/estimates/templates${error ? `?error=${encodeURIComponent(error)}` : ""}`,
  );
}
export async function initializeAction() {
  await service.initializeCatalog(await user());
  revalidatePath("/", "layout");
}
export async function estimateAction(form: FormData) {
  const id = z.string().min(1).max(100).parse(form.get("id"));
  const action = z
    .enum([
      "submit",
      "approve",
      "reject",
      "release",
      "accept",
      "duplicate",
      "revise",
      "handoff",
      "linked-copy",
    ])
    .parse(form.get("action"));
  let target = id,
    error = "";
  try {
    const u = await user();
    switch (action) {
      case "submit":
        await service.submitEstimate(
          u,
          id,
          z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(form.get("contentVersion")),
        );
        break;
      case "approve":
      case "reject":
        await service.decideEstimate(
          u,
          id,
          action === "approve",
          z.string().max(2000).parse(form.get("rationale")),
        );
        break;
      case "release":
      case "accept":
        await service.transitionEstimate(
          u,
          id,
          action,
          z
            .string()
            .max(2000)
            .parse(form.get("reference") ?? ""),
        );
        break;
      case "duplicate":
      case "revise":
        target = await service.copyEstimate(u, id, action === "revise");
        break;
      case "linked-copy":
        target = await service.copyEstimate(
          u,
          id,
          false,
          z.string().min(1).max(200).parse(form.get("opportunityId")),
        );
        break;
      case "handoff":
        await service.handoffProject(u, id);
        break;
    }
    revalidatePath("/", "layout");
  } catch (e) {
    error = errorText(e);
  }
  redirect(
    `/estimates/${target}${error ? `?error=${encodeURIComponent(error)}` : ""}`,
  );
}
