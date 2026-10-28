import type { Metadata } from "next";
import { Suspense } from "react";
import { redirectIfSignedIn } from "@/lib/server/auth/current-owner";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center bg-plane px-4">
      <Suspense>
        <SignedInRedirect searchParams={searchParams} />
      </Suspense>
      <div className="w-full max-w-sm card rounded-2xl p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Fitness Tracker</h1>
        <p className="mt-1 text-sm text-ink-2">Enter your password to continue.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

/** Renders nothing; redirects when a valid session already exists. */
async function SignedInRedirect({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = (await searchParams).next;
  await redirectIfSignedIn(typeof next === "string" ? next : null);
  return null;
}
