import { db } from "../src/server/db";
import { hashPassword } from "../src/server/password";
import { z } from "zod";
async function main() {
  const email = z.email().parse(process.env.USER_EMAIL).toLowerCase();
  const name = z.string().min(1).parse(process.env.USER_NAME);
  const password = z.string().min(12).max(256).parse(process.env.USER_PASSWORD);
  const role = z
    .enum(["OWNER", "ADMIN", "SALES", "PROJECT_MANAGER", "CREW", "CUSTOMER"])
    .parse(process.env.USER_ROLE ?? "OWNER");
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name, passwordHash: await hashPassword(password), role },
    });
    await tx.activity.create({
      data: {
        type: "USER_PROVISIONED",
        actorId: user.id,
        message: "Account provisioned by administrator CLI",
        metadata: { role },
      },
    });
  });
  console.log("Account created");
}
main()
  .catch(() => {
    console.error(
      "Account creation failed; verify required variables and unique email.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
