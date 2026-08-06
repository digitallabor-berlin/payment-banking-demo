import { describe, expect, it } from "vitest";
import {
  addItem,
  cartItemCount,
  cartTotalCents,
  removeItem,
  updateQuantity,
  type CartItem,
} from "./cart.js";

const headphones = { productId: "prod_1", name: "Wireless Headphones", priceCents: 12_999 };
const keyboard = { productId: "prod_2", name: "Mechanical Keyboard", priceCents: 8_999 };

describe("addItem", () => {
  it("adds a new item with quantity 1 by default", () => {
    const items = addItem([], headphones);
    expect(items).toEqual([{ ...headphones, quantity: 1 }]);
  });

  it("merges quantities when the product is already in the cart", () => {
    const items = addItem([{ ...headphones, quantity: 1 }], headphones, 2);
    expect(items).toEqual([{ ...headphones, quantity: 3 }]);
  });

  it("leaves other items untouched", () => {
    const items = addItem([{ ...headphones, quantity: 1 }], keyboard);
    expect(items).toHaveLength(2);
  });
});

describe("updateQuantity", () => {
  const cart: CartItem[] = [{ ...headphones, quantity: 2 }];

  it("sets a new quantity", () => {
    expect(updateQuantity(cart, "prod_1", 5)).toEqual([{ ...headphones, quantity: 5 }]);
  });

  it("removes the item when the quantity drops to zero or below", () => {
    expect(updateQuantity(cart, "prod_1", 0)).toEqual([]);
    expect(updateQuantity(cart, "prod_1", -1)).toEqual([]);
  });
});

describe("removeItem", () => {
  it("removes only the named product", () => {
    const cart: CartItem[] = [
      { ...headphones, quantity: 1 },
      { ...keyboard, quantity: 1 },
    ];
    expect(removeItem(cart, "prod_1")).toEqual([{ ...keyboard, quantity: 1 }]);
  });
});

describe("cartTotalCents", () => {
  it("sums price times quantity across items", () => {
    const cart: CartItem[] = [
      { ...headphones, quantity: 2 },
      { ...keyboard, quantity: 1 },
    ];
    expect(cartTotalCents(cart)).toBe(12_999 * 2 + 8_999);
  });

  it("is zero for an empty cart", () => {
    expect(cartTotalCents([])).toBe(0);
  });
});

describe("cartItemCount", () => {
  it("sums quantities, not item rows", () => {
    const cart: CartItem[] = [
      { ...headphones, quantity: 2 },
      { ...keyboard, quantity: 3 },
    ];
    expect(cartItemCount(cart)).toBe(5);
  });
});