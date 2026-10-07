import { db } from "../src/server/db";
async function main() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ALLOW_DEMO_SEED !== "true"
  )
    throw new Error("Set ALLOW_DEMO_SEED=true in development only");
  await db.$transaction(async (tx) => {
    const owner = await tx.user.findFirst({
      where: { role: "OWNER", active: true },
    });
    if (!owner) throw new Error("Provision an owner first");
    if (
      await tx.customer.findFirst({
        where: { email: "demo-customer@example.invalid" },
      })
    )
      return;
    const customer = await tx.customer.create({
      data: {
        firstName: "Development",
        lastName: "Demo Customer",
        email: "demo-customer@example.invalid",
        city: "Orlando",
        state: "FL",
        notes: "Development seed data. Not a real customer.",
      },
    });
    const lead = await tx.lead.create({
      data: {
        customerId: customer.id,
        source: "REFERRAL",
        serviceType: "Kitchen remodeling (DEMO)",
        description: "Development fixture only",
        assignedToId: owner.id,
        leadScore: 80,
        budgetMin: "25000",
        budgetMax: "40000",
      },
    });
    await tx.opportunity.create({
      data: {
        customerId: customer.id,
        leadId: lead.id,
        ownerId: owner.id,
        estimatedValue: "32000",
        nextAction: "DEMO: confirm site visit",
        nextActionDate: new Date(),
        stage: "QUALIFYING",
        probability: 30,
      },
    });
    await tx.activity.create({
      data: {
        actorId: owner.id,
        customerId: customer.id,
        leadId: lead.id,
        type: "DEVELOPMENT_SEED",
        message: "Explicit development/demo data created",
      },
    });
  });
  console.log("Development seed complete");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
