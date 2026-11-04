import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { redirectIfSignedIn } from "@/lib/server/auth/current-owner";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthShell alternative={{ prompt: "New here?", label: "Create an account", href: "/register" }}>
      <Suspense>
        <SignedInRedirect searchParams={searchParams} />
      </Suspense>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

/** Renders nothing; redirects when a valid sign-in already exists. */
async function SignedInRedirect({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = (await searchParams).next;
  await redirectIfSignedIn(typeof next === "string" ? next : null);
  return null;
}
