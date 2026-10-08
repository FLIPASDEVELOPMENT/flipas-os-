"use server";
import Decimal from "decimal.js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "./auth";
import { saveFinancialPolicy } from "./service";
import { decideEstimate } from "@/estimator/server/service";
async function ownerMutation() {
  const user = await requireOwner();
  if (
    (await headers()).get("origin") !==
    (process.env.APP_ORIGIN ?? "http://localhost:3000")
  )
    throw new Error("Origin denied");
  return user;
}
export async function policyAction(form: FormData) {
  const user = await ownerMutation();
  let error = "";
  try {
    const input = Object.fromEntries(form);
    for (const key of [
      "targetMargin",
      "minimumMargin",
      "significantDiscountThreshold",
    ])
      input[key] = new Decimal(String(form.get(key + "Percent")))
        .div(100)
        .toString();
    await saveFinancialPolicy(user, input);
  } catch (e) {
    error =
      e instanceof Error && !/prisma|invocation/i.test(e.message)
        ? e.message
        : "Unable to save; reload and check inputs";
  }
  revalidatePath("/owner");
  revalidatePath("/owner/policies");
  redirect(
    "/owner/policies" +
      (error ? "?error=" + encodeURIComponent(error) : "?saved=1"),
  );
}
export async function ownerApprovalAction(form: FormData) {
  const user = await ownerMutation();
  let error = "";
  try {
    const action = String(form.get("decision"));
    if (!["approve", "reject"].includes(action))
      throw new Error("Invalid decision");
    await decideEstimate(
      user,
      String(form.get("id")),
      action === "approve",
      String(form.get("rationale") ?? ""),
    );
  } catch (e) {
    error =
      e instanceof Error && !/prisma|invocation/i.test(e.message)
        ? e.message
        : "Unable to review; reload";
  }
  revalidatePath("/owner/approvals");
  revalidatePath("/estimates");
  redirect(
    "/owner/approvals" + (error ? "?error=" + encodeURIComponent(error) : ""),
  );
}
