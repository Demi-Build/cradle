export function IconSymbols() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <symbol id="g-folder" viewBox="0 0 16 16">
          <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" />
        </symbol>
        <symbol id="g-doc" viewBox="0 0 16 16">
          <path d="M3 1.5h6l3.5 3.5v9h-9.5z" />
          <path d="M9 1.5V5h3.5" />
        </symbol>
        <symbol id="g-sun" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" />
        </symbol>
        <symbol id="g-moon" viewBox="0 0 16 16">
          <path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" />
        </symbol>
        <symbol id="g-cog" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="2" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" />
        </symbol>
        <symbol id="g-panel" viewBox="0 0 16 16">
          <rect x="1.5" y="2.5" width="13" height="11" />
          <path d="M10 2.5v11" />
        </symbol>
        <symbol id="g-book" viewBox="0 0 16 16">
          <path d="M2.5 2.5h5l1 1v10l-1-1h-5zM13.5 2.5h-5l-1 1v10l1-1h5z" />
        </symbol>
        <symbol id="g-chev-l" viewBox="0 0 16 16">
          <path d="M10 3l-5 5 5 5" />
        </symbol>
        <symbol id="g-chev-r" viewBox="0 0 16 16">
          <path d="M6 3l5 5-5 5" />
        </symbol>
        <symbol id="g-chev-d" viewBox="0 0 16 16">
          <path d="M3 6l5 5 5-5" />
        </symbol>
        <symbol id="g-plus" viewBox="0 0 16 16">
          <path d="M8 3v10M3 8h10" />
        </symbol>
        {/* Level-editor tools. Same rules as the rest: 16px box, stroke-only,
            square caps, no circles — the design rejected blobby iconography. */}
        <symbol id="g-cursor" viewBox="0 0 16 16">
          <path d="M3.5 2.5l9 4.5-4 1.2-1.6 3.8z" />
        </symbol>
        <symbol id="g-brush" viewBox="0 0 16 16">
          <path d="M13 3l-6.5 6.5M9.5 4.5l2 2" />
          <path d="M6.5 9.5l-2.5.8-.8 2.5 2.5-.8z" />
        </symbol>
        <symbol id="g-fill" viewBox="0 0 16 16">
          <path d="M6 2.5l6 6-5 5-6-6z" />
          <path d="M13.5 11c0 1-.7 1.7-1.5 1.7" />
        </symbol>
        <symbol id="g-eraser" viewBox="0 0 16 16">
          <path d="M9 2.5l4.5 4.5-6 6H4L2.5 11.5z" />
          <path d="M6 13H14" />
        </symbol>
        <symbol id="g-bounds" viewBox="0 0 16 16">
          <path d="M2 2.5h12M2 13.5h12" />
          <path d="M2.5 6h4M9.5 6h4M2.5 10h2M7 10h6" />
        </symbol>
        <symbol id="g-music" viewBox="0 0 16 16">
          <path d="M6 12V3.5l7-1.2V11" />
          <path d="M3 13.5h3V10H3zM10 12.5h3V9h-3z" />
        </symbol>
        <symbol id="g-x" viewBox="0 0 16 16">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </symbol>
        <symbol id="g-ext" viewBox="0 0 16 16">
          <path d="M6 3h-3v10h10v-3M9 3h4v4M13 3l-6 6" />
        </symbol>
        <symbol id="g-flag" viewBox="0 0 16 16">
          <path d="M3 2v12M3 2.5h10l-2 3 2 3H3" />
        </symbol>
        <symbol id="g-search" viewBox="0 0 16 16">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5l3 3" />
        </symbol>
        <symbol id="g-grid" viewBox="0 0 16 16">
          <rect x="2" y="2" width="5" height="5" />
          <rect x="9" y="2" width="5" height="5" />
          <rect x="2" y="9" width="5" height="5" />
          <rect x="9" y="9" width="5" height="5" />
        </symbol>
        <symbol id="g-rows" viewBox="0 0 16 16">
          <path d="M2 4h12M2 8h12M2 12h12" />
        </symbol>
        <symbol id="g-pin" viewBox="0 0 16 16">
          <path d="M6 1.5l4 4-1.5 1.5-1 3.5-2.5 2-5-5 2-2.5 3.5-1z" />
        </symbol>
        <symbol id="g-exclaim" viewBox="0 0 16 16">
          <path d="M8 2v7" />
          <path d="M8 12.5v0.2" />
          <circle cx="8" cy="8" r="6.5" />
        </symbol>
        <symbol id="g-star" viewBox="0 0 16 16">
          <path d="M8 1.5l2 4.5 5 0.5-3.8 3.3 1.2 4.7L8 12l-4.4 2.5 1.2-4.7L1 6.5l5-0.5z" />
        </symbol>
        {/* World-map tools + chrome. Paths copied from `05 World map.html`,
            which is the contract for this screen. */}
        <symbol id="g-select" viewBox="0 0 16 16">
          <path d="M2 2h4M10 2h4M2 14h4M10 14h4M2 2v4M2 10v4M14 2v4M14 10v4" />
        </symbol>
        <symbol id="g-place" viewBox="0 0 16 16">
          <path d="M2 4h12v8H2z" />
          <path d="M8 6v4M6 8h4" />
        </symbol>
        <symbol id="g-path" viewBox="0 0 16 16">
          <path d="M3 12h4a3 3 0 000-6H6" />
          <circle cx="3" cy="12" r="1.6" />
          <circle cx="12" cy="6" r="1.6" />
          <path d="M9 6h1.5" />
        </symbol>
        <symbol id="g-area" viewBox="0 0 16 16">
          <path d="M2 5a3 3 0 013-3h6a3 3 0 013 3v6a3 3 0 01-3 3H5a3 3 0 01-3-3z" />
        </symbol>
        <symbol id="g-stop" viewBox="0 0 16 16">
          <path d="M2 8h3M11 8h3" />
          <path d="M8 5l3 3-3 3-3-3z" />
        </symbol>
        <symbol id="g-start" viewBox="0 0 16 16">
          <circle cx="8" cy="4" r="2" />
          <path d="M8 6v5M5 14l3-3 3 3M5 8h6" />
        </symbol>
        <symbol id="g-rerun" viewBox="0 0 16 16">
          <path d="M13 8a5 5 0 11-2-4M13 2v3h-3" />
        </symbol>
        <symbol id="g-lock" viewBox="0 0 16 16">
          <path d="M4 7h8v7H4z" />
          <path d="M6 7V5a2 2 0 014 0v2" />
        </symbol>
        <symbol id="g-unlock" viewBox="0 0 16 16">
          <path d="M4 7h8v7H4z" />
          <path d="M6 7V5a2 2 0 013.9-.5" />
        </symbol>
      </defs>
    </svg>
  );
}

export function Icon({
  id,
  size = 16,
  className = "g",
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg className={className} width={size} height={size}>
      <use href={`#${id}`} />
    </svg>
  );
}
