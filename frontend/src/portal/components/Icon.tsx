/* Minimal inline icon set (stroke icons, 24px grid). Decorative unless a label is given. */
const PATHS: Record<string, string> = {
  dashboard: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z",
  briefcase: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
  plus: "M12 5v14M5 12h14",
  review: "M4 5h16v11H8l-4 4zM8 9h8M8 12h5",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  users: "M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.8M16 4.2a3 3 0 010 5.6",
  team: "M12 3v5M5 13v-2h14v2M5 13v3M12 11v5M19 13v3M3 16h4v4H3zM10 16h4v4h-4zM17 16h4v4h-4z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  bell: "M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  history: "M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 3v4h4M12 7v5l3 2",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  back: "M15 5l-7 7 7 7",
  check: "M5 12l5 5L20 7",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  warning: "M12 4l9 16H3zM12 10v4M12 17h.01",
  target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 13a1 1 0 100-2 1 1 0 000 2z",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h7M10 17h7",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  checkCircle: "M12 21a9 9 0 100-18 9 9 0 000 18zM8.5 12.5l2.5 2.5 4.5-5",
  archive: "M3.5 6.5h17v3.5h-17zM5.2 10v9.5h13.6V10M10 13.5h4",
  palette: "M12 21a9 9 0 110-18c4.9 0 9 3.4 9 7.7 0 2.2-1.9 3.8-4.1 3.8h-1.6a1.9 1.9 0 00-1.4 3.2c.4.5.1 1.3-.9 1.3zM7.6 12.2a1 1 0 100-2 1 1 0 000 2zM10.1 8.4a1 1 0 100-2 1 1 0 000 2zM14.6 8.4a1 1 0 100-2 1 1 0 000 2z",
  list: "M4 5h16M4 5v14h16V5M8 10h8M8 14h5",
  message: "M4 5h16v11H9l-5 4zM8 10h.01M12 10h.01M16 10h.01",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z",
  building: "M4 21V5h10v16M14 9h6v12M2 21h20M8 9h2M8 13h2M8 17h2M17 13h1M17 17h1",
  clipboard: "M8 4h8v3H8zM6 5H5v16h14V5h-1M9 14l2 2 4-4",
  shieldCheck: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-4.5",
  dollar: "M12 21a9 9 0 100-18 9 9 0 000 18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v1.5M12 16v1.5",
  checkSquare: "M4 4h16v16H4zM8 12l3 3 5-6",
  tools: "M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4zM5 5l4 4M3 7l4-4",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01",
  x: "M6 6l12 12M18 6L6 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  handshake: "M4 12l4-4 4 4 4-4 4 4M4 12l4 4 4-4 4 4 4-4",
};

export function Icon({ name, label }: { name: keyof typeof PATHS | string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
