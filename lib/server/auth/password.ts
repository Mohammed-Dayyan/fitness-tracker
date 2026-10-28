import "server-only";
import { hash, verify } from "@node-rs/argon2";

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

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
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
