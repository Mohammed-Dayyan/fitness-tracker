import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { redirectIfSignedIn } from "@/lib/server/auth/current-owner";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <AuthShell alternative={{ prompt: "Already have an account?", label: "Sign in", href: "/login" }}>
      <Suspense>
        <SignedInRedirect />
      </Suspense>
      <RegisterForm />
    </AuthShell>
  );
}

/** Renders nothing; redirects when a valid sign-in already exists. */
async function SignedInRedirect() {
  await redirectIfSignedIn(null);
  return null;
}
