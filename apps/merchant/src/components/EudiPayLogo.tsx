export function EudiPayLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="6" y="22" width="88" height="58" rx="12" fill="#004DD7" />
      <rect x="6" y="38" width="88" height="12" fill="#003BA8" />
      <circle cx="74" cy="64" r="9" fill="#FFCC00" />
      {/* Twelve stars, the EU mark, arranged on a circle. */}
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={index}
            cx={30 + Math.cos(angle) * 11}
            cy={51 + Math.sin(angle) * 11}
            r="1.9"
            fill="#FFCC00"
          />
        );
      })}
    </svg>
  );
}