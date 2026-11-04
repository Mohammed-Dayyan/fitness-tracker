// Password rules, shared by the sign-up form (live hint) and the server (final
// check), so the two can never disagree.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordRule = { id: string; label: string; test: (password: string) => boolean };

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters`,
    test: (p) => p.length >= MIN_PASSWORD_LENGTH && p.length <= MAX_PASSWORD_LENGTH,
  },
];

/** The rules this password does not meet yet (empty when it is acceptable). */
export function unmetPasswordRules(password: string): PasswordRule[] {
  return PASSWORD_RULES.filter((r) => !r.test(password));
}
