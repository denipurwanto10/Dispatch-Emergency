interface BrandProps {
  /** Keterangan kecil di bawah nama aplikasi. */
  sub?: string
  size?: 'md' | 'sm'
}

/** Tanda merek: titik lokasi dengan cincin, di dalam kotak membulat. */
function BrandMark({ size }: { size: 'md' | 'sm' }) {
  return (
    <svg
      className={`brand-mark ${size === 'md' ? 'brand-mark--md' : ''}`}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="bm-bg" width="40" height="40" rx="11" />
      <circle className="bm-ring" cx="20" cy="20" r="10" fill="none" strokeWidth="2.4" />
      <circle className="bm-dot" cx="20" cy="20" r="4.2" />
      <path className="bm-fg" d="M20 5.5v5M20 29.5v5M5.5 20h5M29.5 20h5" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export function Brand({ sub, size = 'sm' }: BrandProps) {
  return (
    <div className="brand">
      <BrandMark size={size} />
      <div className="brand-text">
        <p className="brand-name">Tanggap</p>
        {sub ? <p className="brand-sub">{sub}</p> : null}
      </div>
    </div>
  )
}
