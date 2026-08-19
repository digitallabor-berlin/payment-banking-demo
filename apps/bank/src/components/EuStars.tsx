import { ringPoints, starPath } from "@demo/ui";

/**
 * The EU's twelve-star ring, drawn rather than typed as the 🇪🇺 emoji — flag
 * emoji render as the letters "EU" on Windows and as a different shape on
 * every platform, which is not acceptable for a mark that signals "this
 * credential is live".
 *
 * Rendered in currentColor so it inherits whatever surface it sits on and
 * introduces no colour of its own. The geometry lives in @demo/ui because the
 * merchant's payment sheet draws the same stars.
 */
export function EuStars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {ringPoints(24, 24, 15).map((point, index) => (
        <path key={index} d={starPath(point.x, point.y, 3.1)} />
      ))}
    </svg>
  );
}