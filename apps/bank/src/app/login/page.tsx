import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard.js";
import { LocaleSwitcher } from "@/components/LocaleSwitcher.js";
import { LoginForm } from "@/components/LoginForm.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { getLocale } from "@/lib/i18n/server.js";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in? The login screen is not useful.
  if (await getSession()) redirect("/");

  const locale = await getLocale();

  return (
    <AuthCard
      title="Sparkasse"
      subtitle="Musterstadt"
      tagline={MESSAGES[locale].login.tagline}
      locale={locale}
      switcher={<LocaleSwitcher locale={locale} />}
    >
      <LoginForm locale={locale} />
    </AuthCard>
  );
}