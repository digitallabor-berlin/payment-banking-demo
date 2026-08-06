import { CheckoutForm } from "@/components/CheckoutForm.js";

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">Checkout</h1>
      <CheckoutForm />
    </main>
  );
}