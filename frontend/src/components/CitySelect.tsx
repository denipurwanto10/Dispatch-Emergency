import { CitySearchSelect, type CitySearchSelectProps } from './CitySearchSelect'

function IconPin() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  )
}

/** Filter kota untuk bilah peta dan panel armada. Menggunakan CitySearchSelect dengan dataset lengkap Indonesia. */
export function CitySelect({ value, options, allLabel, onChange }: {
  value: string
  options: string[]
  allLabel: string
  onChange: (value: string) => void
}) {
  // Gunakan CitySearchSelect yang sudah memiliki data lengkap Indonesia
  // Props `options` dijaga untuk kompatibilitas tapi tidak dipakai karena data sudah internal
  void options
  return (
    <CitySearchSelect
      mode="province-first"
      variant="filter"
      ariaLabel="Filter kota operasi"
      icon={<IconPin />}
      value={value}
      onChange={onChange}
      showAllOption={true}
      allLabel={allLabel}
      searchPlaceholder="Cari kota atau provinsi…"
    />
  )
}

// Re-export types for consumers
export type { CitySearchSelectProps }