export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 380 380" fill="none" width={size} height={size}>
        <path
          className="ring"
          d="M 190 10 A 180 180 0 0 1 190 370"
          strokeWidth={14}
          strokeLinecap="round"
        />
        <path
          className="ring"
          d="M 190 50 A 140 140 0 0 1 190 330"
          strokeWidth={10}
          strokeLinecap="round"
          opacity={0.7}
        />
        <line className="glyph" x1={190} y1={10} x2={190} y2={370} strokeWidth={14} />
        <path
          className="glyph"
          d="M 190 150 A 40 40 0 1 0 190 230"
          strokeWidth={16}
          strokeLinecap="round"
          fill="none"
        />
        <circle className="dot" cx={190} cy={190} r={12} />
      </svg>
    </div>
  );
}

export function Branding({ version = "v0.1.2" }: { version?: string }) {
  return (
    <div className="branding">
      <BrandMark />
      <div>
        <div className="brand-name">Cradle</div>
        <div className="brand-ver">{version}</div>
      </div>
    </div>
  );
}
