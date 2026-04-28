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
