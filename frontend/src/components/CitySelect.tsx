import { Select } from './Select'

interface CitySelectProps {
  value: string
  options: string[]
  allLabel: string
  onChange: (value: string) => void
}

function IconPin() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  )
}

/** Filter kota untuk bilah peta dan panel armada. */
export function CitySelect({ value, options, allLabel, onChange }: CitySelectProps) {
  return (
    <Select
      variant="filter"
      ariaLabel="Filter kota operasi"
      icon={<IconPin />}
      value={value}
      onChange={onChange}
      options={[{ value: '', label: allLabel }, ...options.map((name) => ({ value: name, label: name }))]}
    />
  )
}
