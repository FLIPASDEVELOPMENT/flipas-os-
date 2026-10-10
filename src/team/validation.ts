import { z } from "zod";
export const employeeRoles = [
  "ADMIN",
  "SALES",
  "PROJECT_MANAGER",
  "CREW",
] as const;
export const roleInput = z.enum(employeeRoles);
export const passwordInput = z.string().min(12).max(256);
export const createAccountInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    role: roleInput,
    password: passwordInput,
    confirmation: passwordInput,
  })
  .strict()
  .refine((d) => d.password === d.confirmation, "PASSWORD_MISMATCH");
