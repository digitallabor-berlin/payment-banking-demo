import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard.js";
import { LocaleSwitcher } from "@/components/LocaleSwitcher.js";
import { LoginForm } from "@/components/LoginForm.js";
import { WalletLoginButton } from "@/components/WalletLoginButton.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { getLocale } from "@/lib/i18n/server.js";
import { getSession } from "@/lib/session.js";
import { parseDcApiForm } from "@/lib/transport.js";

export const dynamic = "force-dynamic";

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ dcapi?: string }>;
}) {
    // Already signed in? The login screen is not useful.
    if (await getSession()) redirect("/");

    const locale = await getLocale();
    // `?dcapi=unsigned` opts this attempt out of the signed DC API request
    // object. Read here rather than with useSearchParams so no client component
    // needs a Suspense boundary for it, and so the button has the answer before
    // the click — the transport is fixed when the session is created.
    const { dcapi } = await searchParams;
    const dcApiForm = parseDcApiForm(dcapi ?? null);

    return (
        <AuthCard
            title="Sparkasse"
            subtitle="Musterstadt"
            tagline={MESSAGES[locale].login.tagline}
            locale={locale}
            switcher={<LocaleSwitcher locale={locale} />}
        >
            <LoginForm locale={locale} />
            <WalletLoginButton locale={locale} dcApiForm={dcApiForm} />
        </AuthCard>
    );
}
