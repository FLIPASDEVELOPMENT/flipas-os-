import { requireUser } from "@/server/auth";
import { notFound } from "next/navigation";
import { isOwner } from "./policy";
export async function requireOwner() {
  const user = await requireUser();
  if (!isOwner(user)) notFound();
  return user;
}
