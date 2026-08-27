import { CheckoutPanel } from "@/components/CheckoutPanel.js";
import { SiteHeader } from "@/components/SiteHeader.js";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";
import { loadCheckoutSession } from "@/lib/checkout-session.js";
import { parseDcApiForm } from "@/lib/transport.js";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; dcapi?: string }>;
}) {
  const { session, dcapi } = await searchParams;
  // `?dcapi=unsigned` opts this attempt out of the signed DC API request object.
  // Read here rather than with useSearchParams so no client component needs a
  // Suspense boundary for it, and so the form has the answer on first render —
  // the transport is fixed when the session is created and cannot be revisited.
  const dcApiForm = parseDcApiForm(dcapi ?? null);
  // A wallet round trip on a phone leaves this page and comes back with nothing
  // but the URL, so the sheet is rebuilt from `?session=` rather than from
  // client state. An unknown id renders the ordinary form.
  const initialSession = session ? loadCheckoutSession(getDb(), session) : null;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="display text-4xl">Check out</h1>
        {/*
          "on this page", not "on the next screen": the payment sheet opens over
          this page now and never navigates away, so promising a next screen
          would describe a route that no longer exists in the happy path.
        */}
        <p className="mt-3 text-[15px] text-[var(--color-muted-foreground)]">
          We need a name and an email for the receipt. Payment happens in your
          wallet, on this page.
        </p>

        <div className="mt-8">
          <CheckoutPanel
            initialSession={initialSession}
            merchantName={env.MERCHANT_NAME}
            dcApiForm={dcApiForm}
          />
        </div>
      </main>
    </>
  );
}
