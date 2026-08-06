import { CheckoutForm } from "@/components/CheckoutForm.js";
import { SiteHeader } from "@/components/SiteHeader.js";

export default function CheckoutPage() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="display text-4xl">Check out</h1>
        <p className="mt-3 text-[15px] text-[var(--color-muted-foreground)]">
          We need a name and an email for the receipt. Payment happens in your wallet
          on the next screen.
        </p>

        <div className="mt-8">
          <CheckoutForm />
        </div>
      </main>
    </>
  );
}