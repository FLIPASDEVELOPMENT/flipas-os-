import sharp from "sharp";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import type { Prisma, User } from "@/generated/prisma/client";
import { authorized } from "./service";
const MAX_FILE = 5 * 1024 * 1024,
  PROJECT_QUOTA = 100 * 1024 * 1024,
  COMPANY_QUOTA = 500 * 1024 * 1024;
export function validateEvidenceFile(bytes: Uint8Array, name: string) {
  if (!bytes.length || bytes.length > MAX_FILE)
    throw new Error("FILE_SIZE_LIMIT");
  const b = Buffer.from(bytes);
  let mime = "";
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.subarray(12, 16).toString() === "IHDR"
  ) {
    if (
      b.readUInt32BE(16) * b.readUInt32BE(20) > 20000000 ||
      !b.readUInt32BE(16) ||
      !b.readUInt32BE(20)
    )
      throw new Error("IMAGE_DIMENSION_LIMIT");
    mime = "image/png";
  } else if (
    b.length >= 4 &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b.at(-2) === 255 &&
    b.at(-1) === 217
  )
    mime = "image/jpeg";
  else if (
    b.length >= 20 &&
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP" &&
    b.readUInt32LE(4) + 8 === b.length
  )
    mime = "image/webp";
  else throw new Error("FILE_TYPE_NOT_ALLOWED");
  const fileName = name.replace(/[^\p{L}\p{N}_. -]/gu, "_").slice(0, 100);
  if (!fileName) throw new Error("INVALID_FILE_NAME");
  return {
    mimeType: mime,
    fileName,
    sha256: createHash("sha256").update(b).digest("hex"),
  };
}
/** Replaceable persistence boundary. PostgreSQL backups include content, not only metadata. */
export interface EvidenceStore {
  put(
    tx: Prisma.TransactionClient,
    input: Prisma.ProjectEvidenceUncheckedCreateInput,
  ): Promise<string>;
  get(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ data: Uint8Array; mimeType: string; fileName: string }>;
}
export const postgresEvidenceStore: EvidenceStore = {
  put: async (tx, input) =>
    (await tx.projectEvidence.create({ data: input })).id,
  get: async (tx, id) =>
    tx.projectEvidence.findUniqueOrThrow({
      where: { id },
      select: { data: true, mimeType: true, fileName: true },
    }),
};
export async function uploadEvidence(
  u: User,
  projectId: string,
  file: { bytes: Uint8Array; name: string },
  links: unknown,
) {
  const d = z
    .object({
      taskId: z.string().min(1).optional(),
      logId: z.string().min(1).optional(),
      inspectionId: z.string().min(1).optional(),
    })
    .strict()
    .parse(links);
  if (Object.keys(d).length !== 1) throw new Error("EVIDENCE_TARGET_REQUIRED");
  await db.$transaction(async (tx) => {
    await authorized(tx, u, projectId);
    if (!["OWNER", "ADMIN", "PROJECT_MANAGER", "CREW"].includes(u.role))
      throw new Error("ACCESS_DENIED");
  });
  validateEvidenceFile(file.bytes, file.name);
  let clean: Uint8Array;
  try {
    const image = sharp(file.bytes, {
      limitInputPixels: 20000000,
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !["png", "jpeg", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("Invalid image");
    clean = new Uint8Array(
      await image
        .rotate()
        .toFormat(metadata.format as "png" | "jpeg" | "webp")
        .toBuffer(),
    );
  } catch {
    throw new Error("INVALID_IMAGE");
  }
  const validated = validateEvidenceFile(clean, file.name);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('project-evidence-quota'))`;
      const p = await authorized(tx, u, projectId);
      if (
        ["COMPLETED", "CANCELLED"].includes(p.status) ||
        !["OWNER", "ADMIN", "PROJECT_MANAGER", "CREW"].includes(u.role)
      )
        throw new Error("ACCESS_DENIED");
      if (d.taskId) {
        const task = await tx.projectTask.findFirstOrThrow({
          where: { id: d.taskId, projectId },
        });
        if (u.role === "CREW" && task.assigneeId !== u.id)
          throw new Error("ACCESS_DENIED");
      }
      if (d.logId) {
        const log = await tx.projectDailyLog.findFirstOrThrow({
          where: { id: d.logId, projectId },
        });
        if (u.role === "CREW" && log.recordedById !== u.id)
          throw new Error("ACCESS_DENIED");
      }
      if (d.inspectionId) {
        if (u.role === "CREW") throw new Error("ACCESS_DENIED");
        await tx.projectInspection.findFirstOrThrow({
          where: { id: d.inspectionId, projectId },
        });
      }
      const prior = await tx.projectEvidence.findFirst({
        where: {
          projectId,
          uploadedById: u.id,
          sha256: validated.sha256,
          ...d,
        },
        select: { id: true },
      });
      if (prior) return prior.id;
      const totals = await tx.projectEvidence.aggregate({
          _sum: { byteSize: true },
        }),
        project = await tx.projectEvidence.aggregate({
          where: { projectId },
          _sum: { byteSize: true },
        });
      if (
        (totals._sum.byteSize ?? 0) + clean.length > COMPANY_QUOTA ||
        (project._sum.byteSize ?? 0) + clean.length > PROJECT_QUOTA
      )
        throw new Error("FILE_QUOTA_LIMIT");
      const evidenceId = await postgresEvidenceStore.put(tx, {
        projectId,
        ...validated,
        ...d,
        data: new Uint8Array(clean),
        byteSize: clean.length,
        uploadedById: u.id,
      });
      await tx.projectEvent.create({
        data: {
          projectId,
          type: "PROJECT_EVIDENCE_ADDED",
          actorId: u.id,
          metadata: {
            evidenceId,
            byteSize: clean.length,
            mimeType: validated.mimeType,
          },
        },
      });
      return evidenceId;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function readEvidence(u: User, id: string) {
  return db.$transaction(async (tx) => {
    const record = await tx.projectEvidence.findUniqueOrThrow({
      where: { id },
      select: { projectId: true },
    });
    await authorized(tx, u, record.projectId);
    return postgresEvidenceStore.get(tx, id);
  });
}
