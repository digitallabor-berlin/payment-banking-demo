import { ProductCard } from "@/components/ProductCard.js";
import { SiteHeader } from "@/components/SiteHeader.js";
import { getDb } from "@/db/index.js";
import { listAisles } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export default function ShopPage() {
  const aisles = listAisles(getDb());
  const itemCount = aisles.reduce((sum, aisle) => sum + aisle.products.length, 0);

  // A single running index across all aisles, so the load stagger cascades
  // down the page rather than restarting at every heading.
  let position = 0;

  return (
    <>
      <SiteHeader />

      <section className="masthead px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h1 className="display max-w-3xl text-[clamp(2.5rem,7vw,4.5rem)]">
            The corner shop,
            <br />
            open all night.
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[var(--color-muted-foreground)]">
            {itemCount} things worth keeping in the house. Pay at checkout with your
            EUDI Wallet — scan once, and your bank does the rest.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-14">
        <div className="space-y-14">
          {aisles.map((aisle) => (
            <section key={aisle.name}>
              <div className="rule-strong flex items-baseline justify-between gap-4 pb-2.5">
                <h2 className="display text-2xl">{aisle.name}</h2>
                <span className="eyebrow">
                  {aisle.products.length} {aisle.products.length === 1 ? "item" : "items"}
                </span>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {aisle.products.map((product) => (
                  <ProductCard key={product.id} product={product} index={position++} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer className="rule-strong border-b-0 border-t-[1.5px] border-t-[var(--color-ink)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
          <span className="eyebrow">Larder · Grocer · Berlin</span>
          <span className="data text-[var(--color-muted-foreground)]">
            Payments settled over EUDI Wallet
          </span>
        </div>
      </footer>
    </>
  );
}