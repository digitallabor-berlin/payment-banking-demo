/**
 * The EU's twelve-star ring, as geometry rather than as a component.
 *
 * Both apps draw this mark — the bank to signal a live credential, the merchant
 * as the payment sheet's status indicator — and both must draw the same stars.
 * Behaviour is shared between the apps; design tokens deliberately are not, so
 * this module returns numbers and path strings and never a colour or a size.
 *
 * Angles start at twelve o'clock and advance clockwise, matching how the mark
 * is read and how a progress indicator built on it is expected to fill.
 */

export interface RingPoint {
  x: number;
  y: number;
}

export function ringPoints(
  cx: number,
  cy: number,
  radius: number,
  count = 12,
): RingPoint[] {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

/**
 * A five-pointed star centred on (cx, cy). The 0.382 inner ratio is the one the
 * EU flag's construction implies, and is what the bank's mark already used.
 */
export function starPath(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.382;
  const vertices: string[] = [];

  for (let step = 0; step < 10; step++) {
    const radius = step % 2 === 0 ? outer : inner;
    const angle = (step / 10) * Math.PI * 2 - Math.PI / 2;
    vertices.push(
      `${(cx + Math.cos(angle) * radius).toFixed(2)} ${(cy + Math.sin(angle) * radius).toFixed(2)}`,
    );
  }

  return `M${vertices.join("L")}Z`;
}