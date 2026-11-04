// Access tokens: short-lived, signed JWTs (HS256) verified without a database
// lookup. Free of "server-only" so proxy.ts can verify them.
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "fitness-tracker";
const AUDIENCE = "fitness-tracker:access";

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

function secretKey(): Uint8Array {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(ownerId: string, now = Date.now()): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(now + ACCESS_TOKEN_TTL_MS);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ownerId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(crypto.randomUUID())
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());
  return { token, expiresAt };
}

/** Returns the owner id and expiry for a valid, unexpired token; null for anything else. */
export async function verifyAccessToken(
  token: string | undefined | null,
): Promise<{ ownerId: string; expiresAt: Date } | null> {
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sub || !payload.exp) return null;
    return { ownerId: payload.sub, expiresAt: new Date(payload.exp * 1000) };
  } catch (e) {
    // A missing/short secret is a deployment error, not a bad token.
    if (e instanceof Error && e.message.startsWith("JWT_ACCESS_SECRET")) throw e;
    return null;
  }
}
