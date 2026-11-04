import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { MAX_PASSWORD_LENGTH, unmetPasswordRules } from "@/lib/shared/password-rules";

// Algorithm.Argon2id; the package exports it as a const enum, which
// isolatedModules cannot import.
const ARGON2ID = 2;

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/shared/password-rules";

/** A message for the first rule the password breaks, or null when it is acceptable. */
export function validateNewPassword(password: string): string | null {
  const [unmet] = unmetPasswordRules(password);
  return unmet ? `Password must be ${unmet.label}.` : null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

// A real hash of a random string, used so that a login attempt costs the same
// time whether or not a password has been configured.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  if (!storedHash) {
    dummyHash ??= hashPassword(crypto.randomUUID());
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
