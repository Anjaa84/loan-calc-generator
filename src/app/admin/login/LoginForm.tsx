"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { login } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-4 py-10">
      <form action={action} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
        <div>
          <h1 className="text-xl font-semibold">Admin sign in</h1>
          <p className="mt-1 text-sm text-muted">
            {next === "/admin/new"
              ? "Sign in to upload an Excel sheet and generate a calculator."
              : "Enter the admin password to manage calculators."}
          </p>
        </div>
        <input type="hidden" name="next" value={next} />
        <Field label="Password" htmlFor="password">
          <TextInput id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
        </Field>
        {state?.error && (
          <p className="text-sm text-danger" role="alert">
            {state.error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Checking…" : "Sign in"}
        </Button>
      </form>
      <Link href="/" className="self-center text-sm text-muted hover:text-text">
        ← Back to calculators
      </Link>
    </main>
  );
}
