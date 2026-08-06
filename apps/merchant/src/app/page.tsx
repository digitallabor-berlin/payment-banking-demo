import { CartBadge } from "@/components/CartBadge.js";
import { ProductCard } from "@/components/ProductCard.js";
import { getDb } from "@/db/index.js";
import { listProducts } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export default function ShopPage() {
  const products = listProducts(getDb());

  return (
    <>
      <header className="shop-header">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-xl font-bold text-[var(--color-brand-dark)]">Demo Shop</span>
          <CartBadge />
        </div>
      </header>

      <section className="shop-hero px-4 py-16 text-center">
        <h1 className="text-3xl font-bold">Pay with your EUDI Wallet</h1>
        <p className="mt-2 text-[var(--color-muted-foreground)]">
          A demo shop that settles payments through a real digital wallet.
        </p>
      </section>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </main>

      <footer className="mt-10 border-t border-[var(--color-border)] py-6 text-center text-sm text-[var(--color-muted-foreground)]">
        Demo Shop — a payment-banking-demo storefront.
      </footer>
    </>
  );
}