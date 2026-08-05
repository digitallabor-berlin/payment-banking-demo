import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard.js";
import { LoginForm } from "@/components/LoginForm.js";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in? The login screen is not useful.
  if (await getSession()) redirect("/");

  return (
    <AuthCard
      title="Sparkasse"
      subtitle="Musterstadt"
      tagline="Ihr verlässlicher Partner"
    >
      <LoginForm />
    </AuthCard>
  );
}