/* The DeepAI mark: a top layer and two layers below it, going from purple to coral as it goes deeper.
   "onDark" is the version for purple backgrounds (sidebar, sign-in). */
export function BrandMark({ size = 32, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="brand-mark">
      <path d="M32 6l25 12.5L32 31 7 18.5z" fill={onDark ? "#fff" : "#4F008C"} />
      <path d="M9 31.5L32 43l23-11.5" fill="none" stroke={onDark ? "#C9A8F2" : "#8B45E0"} strokeWidth={5.5}
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 44.5L32 56l23-11.5" fill="none" stroke="#FF375E" strokeWidth={5.5}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
