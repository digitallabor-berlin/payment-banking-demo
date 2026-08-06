/**
 * The EU's twelve-star ring, drawn rather than typed as the 🇪🇺 emoji — flag
 * emoji render as the letters "EU" on Windows and as a different shape on
 * every platform, which is not acceptable for a mark that signals "this
 * credential is live".
 *
 * Rendered in currentColor so it inherits whatever surface it sits on and
 * introduces no colour of its own.
 */
export function EuStars({ className }: { className?: string }) {
  const points = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
    return { x: 24 + Math.cos(angle) * 15, y: 24 + Math.sin(angle) * 15 };
  });

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {points.map((point, index) => (
        <path key={index} d={star(point.x, point.y, 3.1)} />
      ))}
    </svg>
  );
}

/** A five-pointed star centred on (cx, cy) with the given outer radius. */
function star(cx: number, cy: number, outer: number): string {
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