export interface CartItem {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
  /**
   * Shelf photograph and pack size, carried so the cart can show what was
   * picked without a round trip to the products table.
   *
   * Optional on purpose: the cart lives in localStorage, and a cart written
   * before these fields existed must still load. Consumers fall back rather
   * than assume.
   */
  imageUrl?: string;
  packLabel?: string;
}

export function addItem(
  items: CartItem[],
  item: Omit<CartItem, "quantity">,
  quantity = 1,
): CartItem[] {
  const existing = items.find((row) => row.productId === item.productId);
  if (existing) {
    return items.map((row) =>
      row.productId === item.productId ? { ...row, quantity: row.quantity + quantity } : row,
    );
  }
  return [...items, { ...item, quantity }];
}

/** A quantity of 0 or less removes the item. */
export function updateQuantity(items: CartItem[], productId: string, quantity: number): CartItem[] {
  if (quantity <= 0) return items.filter((row) => row.productId !== productId);
  return items.map((row) => (row.productId === productId ? { ...row, quantity } : row));
}

export function removeItem(items: CartItem[], productId: string): CartItem[] {
  return items.filter((row) => row.productId !== productId);
}

export function cartTotalCents(items: CartItem[]): number {
  return items.reduce((sum, row) => sum + row.priceCents * row.quantity, 0);
}

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, row) => sum + row.quantity, 0);
}