import { z } from "zod";
import { db } from "@/server/db";
import { decryptSecret, encryptSecret } from "../domain/security";
export const tokenSet = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.coerce.date(),
});
export type Tokens = z.infer<typeof tokenSet>;
export interface TokenRefresher {
  refresh(connectionId: string, tokens: Tokens): Promise<Tokens>;
}
/** Serialized encrypted token refresh; the verified provider adapter supplies the renewal operation. */
export async function accessToken(
  connectionId: string,
  refresher: TokenRefresher,
) {
  return db
    .$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "MailConnection" WHERE "id"=${connectionId} FOR UPDATE`;
        const c = await tx.mailConnection.findUniqueOrThrow({
          where: { id: connectionId },
        });
        if (!c.connected || !c.consented || !c.tokenCipher)
          throw new Error("AUTH_REQUIRED");
        const tokens = tokenSet.parse(JSON.parse(decryptSecret(c.tokenCipher)));
        if (tokens.expiresAt.getTime() > Date.now() + 60000)
          return tokens.accessToken;
        let next: Tokens;
        try {
          next = tokenSet.parse(await refresher.refresh(connectionId, tokens));
          if (next.expiresAt <= new Date()) throw new Error("Invalid expiry");
        } catch {
          await tx.mailConnection.update({
            where: { id: connectionId },
            data: { lastError: "TOKEN_REFRESH_FAILED" },
          });
          return null;
        }
        await tx.mailConnection.update({
          where: { id: connectionId },
          data: {
            tokenCipher: encryptSecret(JSON.stringify(next)),
            tokenExpiresAt: next.expiresAt,
            lastError: null,
          },
        });
        return next.accessToken;
      },
      { timeout: 20000 },
    )
    .then((token) => {
      if (!token) throw new Error("TOKEN_REFRESH_FAILED");
      return token;
    });
}
