import { LoginForm } from "./LoginForm";
import { msg, t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("Sign in") };
}

const ERRORS: Record<string, string> = {
  link: msg("The sign-in link is invalid or has expired. Request a new one."),
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  enterRequestLocale(await requestLocale());
  const { next, error } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
  return <LoginForm next={target} error={error ? t(ERRORS[error] ?? ERRORS.link!) : undefined} />;
}
