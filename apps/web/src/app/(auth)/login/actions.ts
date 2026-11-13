"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestLocale } from "@/app/request-locale";

export interface LoginState {
  error?: string;
  info?: string;
}

/** Only same-site relative targets, so `?next=` can't redirect off the app. */
function safeNext(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/home";
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signInWithPassword(_prev: LoginState, form: FormData): Promise<LoginState> {
  enterRequestLocale(await requestLocale());
  const email = field(form, "email");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: t("Enter email and password.") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: t("Sign-in failed. Check email and password.") };
  redirect(safeNext(form.get("next")));
}

export async function signUp(_prev: LoginState, form: FormData): Promise<LoginState> {
  enterRequestLocale(await requestLocale());
  const email = field(form, "email");
  const password = String(form.get("password") ?? "");
  if (!email || password.length < 8) return { error: t("Enter an email and a password with at least 8 characters.") };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=/home` },
  });
  if (error) return { error: t("Sign-up failed: {message}", { message: error.message }) };
  // With e-mail confirmation off the user is signed in right away.
  if (data.session) redirect("/home");
  return { info: t("Almost there: confirm the email we sent you.") };
}

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  enterRequestLocale(await requestLocale());
  const email = field(form, "email");
  if (!email) return { error: t("Enter an email.") };
  const supabase = await createSupabaseServerClient();
  const next = safeNext(form.get("next"));
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: false },
  });
  if (error) return { error: t("The magic link could not be sent: {message}", { message: error.message }) };
  return { info: t("The magic link is on its way. Open it on this device.") };
}
