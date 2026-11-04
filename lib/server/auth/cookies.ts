// Cookie names and attributes. Deliberately free of "server-only" and the
// database so proxy.ts can import it.

const isProduction = () => process.env.NODE_ENV === "production";

/** In production the __Host- prefix makes browsers require Secure, Path=/ and no Domain. */
export const accessCookieName = () => (isProduction() ? "__Host-ft_access" : "ft_access");
export const refreshCookieName = () => (isProduction() ? "__Host-ft_refresh" : "ft_refresh");

export function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export const expiredCookieOptions = () => ({ ...cookieOptions(new Date(0)), maxAge: 0 });
