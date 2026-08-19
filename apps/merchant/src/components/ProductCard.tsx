import type { CSSProperties } from "react";
import type { ProductDto } from "@/lib/queries.js";
import { formatEuroCents, formatUnitPrice } from "@/lib/format.js";
import { AddToCartButton } from "./AddToCartButton.js";
import { AgeChip } from "./AgeChip.js";

/**
 * A shelf-edge ticket under a photograph.
 *
 * The hierarchy is the one a shopper already knows from a supermarket shelf:
 * name small, selling price large, pack size and unit price as fine print.
 * The unit price is required of a grocer by EU Directive 98/6/EC and is
 * derived from priceCents, so it cannot disagree with what is charged.
 *
 * `index` drives the load stagger declared in globals.css.
 */
export function ProductCard({ product, index = 0 }: { product: ProductDto; index?: number }) {
  const unitPrice = formatUnitPrice(
    product.priceCents,
    product.baseQuantity,
    product.baseUnit,
  );

  return (
    <article className="shelf-item" style={{ "--stagger": index } as CSSProperties}>
      {/*
        Plain <img> rather than next/image: the files are pre-cropped to a
        uniform 900×900 and served from /public, so the optimiser would add a
        sharp dependency to the standalone container for no gain.
      */}
      <img
        src={product.imageUrl}
        alt={product.name}
        width={900}
        height={900}
        loading={index < 4 ? "eager" : "lazy"}
        className="shelf-photo"
      />

      <div className="ticket py-3.5 pl-5 pr-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="ticket-name">{product.name}</h3>
          {product.ageRestricted ? <AgeChip className="mt-0.5" /> : null}
        </div>
        <p className="mt-1 text-xs leading-snug text-[var(--color-muted-foreground)]">
          {product.description}
        </p>

        {/* mt-auto pins the price to the bottom of the ticket, so prices sit
            on one baseline across a row of uneven descriptions. */}
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <p className="ticket-price">{formatEuroCents(product.priceCents)}</p>
            <p className="ticket-unit mt-1.5">
              {product.packLabel}
              {unitPrice ? ` · ${unitPrice}` : ""}
            </p>
          </div>
          <AddToCartButton product={product} />
        </div>
      </div>
    </article>
  );
}