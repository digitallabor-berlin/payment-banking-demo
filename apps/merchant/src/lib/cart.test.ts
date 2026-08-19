import { describe, expect, it } from "vitest";
import {
  addItem,
  cartHasAgeRestricted,
  cartItemCount,
  cartTotalCents,
  removeItem,
  updateQuantity,
  type CartItem,
} from "./cart.js";

const cheese = { productId: "cheese", name: "Aged Gouda", priceCents: 449 };
const berries = { productId: "berries", name: "Mixed Berries", priceCents: 349 };

describe("addItem", () => {
  it("adds a new item with quantity 1 by default", () => {
    const items = addItem([], cheese);
    expect(items).toEqual([{ ...cheese, quantity: 1 }]);
  });

  it("merges quantities when the product is already in the cart", () => {
    const items = addItem([{ ...cheese, quantity: 1 }], cheese, 2);
    expect(items).toEqual([{ ...cheese, quantity: 3 }]);
  });

  it("leaves other items untouched", () => {
    const items = addItem([{ ...cheese, quantity: 1 }], berries);
    expect(items).toHaveLength(2);
  });

  it("carries the photo and pack size through to the cart line", () => {
    const items = addItem([], {
      ...cheese,
      imageUrl: "/products/cheese.jpg",
      packLabel: "200 g",
    });
    expect(items[0]).toMatchObject({
      imageUrl: "/products/cheese.jpg",
      packLabel: "200 g",
    });
  });

  it("accepts a line saved before those fields existed", () => {
    // Carts persist in localStorage, so an older shape must still load.
    const items = addItem([{ ...cheese, quantity: 1 }], cheese, 1);
    expect(items[0]).toEqual({ ...cheese, quantity: 2 });
  });
});

describe("updateQuantity", () => {
  const cart: CartItem[] = [{ ...cheese, quantity: 2 }];

  it("sets a new quantity", () => {
    expect(updateQuantity(cart, "cheese", 5)).toEqual([{ ...cheese, quantity: 5 }]);
  });

  it("removes the item when the quantity drops to zero or below", () => {
    expect(updateQuantity(cart, "cheese", 0)).toEqual([]);
    expect(updateQuantity(cart, "cheese", -1)).toEqual([]);
  });
});

describe("removeItem", () => {
  it("removes only the named product", () => {
    const cart: CartItem[] = [
      { ...cheese, quantity: 1 },
      { ...berries, quantity: 1 },
    ];
    expect(removeItem(cart, "cheese")).toEqual([{ ...berries, quantity: 1 }]);
  });
});

describe("cartTotalCents", () => {
  it("sums price times quantity across items", () => {
    const cart: CartItem[] = [
      { ...cheese, quantity: 2 },
      { ...berries, quantity: 1 },
    ];
    expect(cartTotalCents(cart)).toBe(449 * 2 + 349);
  });

  it("is zero for an empty cart", () => {
    expect(cartTotalCents([])).toBe(0);
  });
});

describe("cartItemCount", () => {
  it("sums quantities, not item rows", () => {
    const cart: CartItem[] = [
      { ...cheese, quantity: 2 },
      { ...berries, quantity: 3 },
    ];
    expect(cartItemCount(cart)).toBe(5);
  });
});

describe("cartHasAgeRestricted", () => {
  const ordinary = { productId: "cheese", name: "Aged Gouda", priceCents: 449, quantity: 1 };
  const restricted = { productId: "wine", name: "Riesling, Trocken", priceCents: 899, quantity: 1 };

  it("is true when a restricted product is in the basket", () => {
    expect(cartHasAgeRestricted([ordinary, restricted])).toBe(true);
  });

  it("is false for an all-ordinary basket", () => {
    expect(cartHasAgeRestricted([ordinary])).toBe(false);
  });

  it("is false for an empty basket", () => {
    expect(cartHasAgeRestricted([])).toBe(false);
  });
});
