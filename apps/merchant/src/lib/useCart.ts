"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addItem,
  cartItemCount,
  cartTotalCents,
  removeItem,
  updateQuantity,
  type CartItem,
} from "./cart.js";

const STORAGE_KEY = "demo-shop-cart";
/** Fired after every write so other mounted components resync in the same tab
 *  — the native `storage` event only fires cross-tab. */
const CART_EVENT = "demo-shop-cart-change";

function readStorage(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(items: CartItem[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(CART_EVENT));
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    setItems(readStorage());
    const onChange = () => setItems(readStorage());
    window.addEventListener(CART_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CART_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const add = useCallback((item: Omit<CartItem, "quantity">, quantity = 1) => {
    writeStorage(addItem(readStorage(), item, quantity));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    writeStorage(updateQuantity(readStorage(), productId, quantity));
  }, []);

  const remove = useCallback((productId: string) => {
    writeStorage(removeItem(readStorage(), productId));
  }, []);

  const clear = useCallback(() => writeStorage([]), []);

  return {
    items,
    add,
    setQuantity,
    remove,
    clear,
    totalCents: cartTotalCents(items),
    itemCount: cartItemCount(items),
  };
}