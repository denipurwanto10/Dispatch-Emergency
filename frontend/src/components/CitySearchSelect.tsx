import { createPortal } from 'react-dom'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import indonesiaCities from '../data/indonesia-cities.json'
import type { ProvinceGroup } from '../data/indonesia-cities'

export interface CitySearchSelectProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel?: string
  /** Ikon di kiri tombol (opsional). */
  icon?: ReactNode
  /** "filter" memakai latar abu-abu muda untuk bilah alat; "field" untuk form. */
  variant?: 'field' | 'filter'
  /** Apakah menampilkan opsi "Semua kota" */
  showAllOption?: boolean
  /** Label untuk opsi "Semua kota" */
  allLabel?: string
  /** Placeholder teks pencarian */
  searchPlaceholder?: string
  /** Mode: 'flat' = daftar lengkap dengan pencarian, 'province-first' = pilih provinsi dulu lalu kota */
  mode?: 'flat' | 'province-first'
}

function IconChevron() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

function IconArrowRight() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

interface FlatOption {
  value: string
  label: string
  province: string
  type: 'city' | 'province-header' | 'all' | 'province'
  gid?: string
  cityType?: 'Kota' | 'Kabupaten'
  provinceKey?: string
}

function flattenOptions(
  provinces: ProvinceGroup[],
  showAllOption: boolean,
  allLabel: string,
  searchQuery: string
): FlatOption[] {
  const result: FlatOption[] = []

  if (showAllOption) {
    result.push({ value: '', label: allLabel, province: '', type: 'all' })
  }

  const query = searchQuery.toLowerCase().trim()

  for (const prov of provinces) {
    const provMatches = !query || prov.province.toLowerCase().includes(query)
    const matchingCities = prov.cities.filter(
      (city: { name: string; search: string }) => !query || city.name.toLowerCase().includes(query) || city.search.toLowerCase().includes(query)
    )

    if (matchingCities.length > 0 || provMatches) {
      // Tambahkan header provinsi
      result.push({
        value: `__province_${prov.provinceKey}`,
        label: prov.province,
        province: prov.province,
        type: 'province-header',
        provinceKey: prov.provinceKey
      })

      // Tambahkan kota-kota yang match
      for (const city of matchingCities) {
        result.push({
          value: city.name,
          label: city.name,
          province: prov.province,
          type: 'city',
          gid: city.gid,
          cityType: city.type as 'Kota' | 'Kabupaten'
        })
      }
    }
  }

  return result
}

export function CitySearchSelect({
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Pilih kota/kabupaten',
  icon,
  variant = 'field',
  showAllOption = true,
  allLabel = 'Semua kota',
  searchPlaceholder = 'Cari nama kota atau provinsi…',
  mode = 'flat'
}: CitySearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<CSSProperties>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProvince, setSelectedProvince] = useState<ProvinceGroup | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const listId = useId()

  const current = useMemo(() => {
    if (!value) return { value: '', label: allLabel }
    // Cari di kota
    const found = indonesiaCities.flatMap((p: ProvinceGroup) => p.cities).find((c: { name: string }) => c.name === value)
    if (found) return { value: found.name, label: found.name }
    // Cari di provinsi (untuk mode province-first)
    const foundProv = indonesiaCities.find((p: ProvinceGroup) => p.province === value)
    if (foundProv) return { value: foundProv.province, label: foundProv.province }
    return { value, label: value }
  }, [value, allLabel])

  // Mode flat: gunakan flattenOptions seperti biasa
  const flatOptions = useMemo(() => flattenOptions(indonesiaCities, showAllOption, allLabel, searchQuery), [searchQuery, showAllOption, allLabel])

  // Mode province-first: logika dua level
  const provinceOptions = useMemo(() => {
    const result: FlatOption[] = []
    if (showAllOption) {
      result.push({ value: '', label: allLabel, province: '', type: 'all' })
    }
    const query = searchQuery.toLowerCase().trim()
    for (const prov of indonesiaCities) {
      if (!query || prov.province.toLowerCase().includes(query)) {
        result.push({
          value: prov.provinceKey,
          label: prov.province,
          province: prov.province,
          type: 'province',
          provinceKey: prov.provinceKey
        })
      }
    }
    return result
  }, [searchQuery, showAllOption])

  const cityOptions = useMemo(() => {
    if (!selectedProvince) return []
    const result: FlatOption[] = []
    const query = searchQuery.toLowerCase().trim()
    for (const city of selectedProvince.cities) {
      if (!query || city.name.toLowerCase().includes(query) || city.search.toLowerCase().includes(query)) {
        result.push({
          value: city.name,
          label: city.name,
          province: selectedProvince.province,
          type: 'city',
          gid: city.gid,
          cityType: city.type as 'Kota' | 'Kabupaten'
        })
      }
    }
    // Sort by name
    result.sort((a, b) => a.label.localeCompare(b.label, 'id'))
    return result
  }, [selectedProvince, searchQuery])

  // Gabungkan options berdasarkan mode
  const options = mode === 'province-first'
    ? (selectedProvince ? cityOptions : provinceOptions)
    : flatOptions

  // Reset active index when options change
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((opt) => opt.value === value)
      setActive(idx >= 0 ? idx : (showAllOption ? 1 : 0))
    }
  }, [options, value, open, showAllOption])

  function openList() {
    if (disabled) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom - 16
      const above = rect.top - 16
      const needed = Math.min(360, options.length * 36 + 60)
      const flip = below < needed && above > below
      const maxHeight = Math.max(160, Math.min(360, flip ? above : below))
      setPos({
        left: rect.left,
        minWidth: Math.max(rect.width, 220),
        maxHeight,
        ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      })
    }
    setSearchQuery('')
    setActive(showAllOption ? 1 : 0)
    setOpen(true)
  }

  function choose(next: string) {
    if (mode === 'province-first' && !selectedProvince) {
      // Pilih provinsi
      const prov = indonesiaCities.find((p: ProvinceGroup) => p.provinceKey === next || p.province === next)
      if (prov) {
        setSelectedProvince(prov)
        setSearchQuery('')
        setActive(0)
        // Trigger onChange dengan provinceKey agar parent bisa flyTo provinsi
        if (next !== value) onChange(prov.provinceKey)
        return
      }
    }
    // Pilih kota (atau flat mode)
    setOpen(false)
    setSearchQuery('')
    setSelectedProvince(null)
    buttonRef.current?.focus()
    if (next !== value) onChange(next)
  }

  function goBackToProvinces() {
    setSelectedProvince(null)
    setSearchQuery('')
    setActive(showAllOption ? 1 : 0)
  }

  useEffect(() => {
    if (!open) return
    // Fokus ke input pencarian
    requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true })
    })

    const anchor = buttonRef.current?.getBoundingClientRect()
    const close = (event: Event) => {
      const target = event.target as Node
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
      setSelectedProvince(null)
    }
    const dismissOnScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return
      const now = buttonRef.current?.getBoundingClientRect()
      if (anchor && now && Math.abs(now.top - anchor.top) < 2 && Math.abs(now.left - anchor.left) < 2) return
      setOpen(false)
      setSelectedProvince(null)
    }
    const dismiss = () => { setOpen(false); setSelectedProvince(null) }
    document.addEventListener('pointerdown', close)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismissOnScroll, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismissOnScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    // Gulir hanya di dalam daftar
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>('.is-active')
    if (!list || !item) return
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop - 6
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight + 6
  }, [open, active])

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => {
        let next = index + 1
        // Skip province headers in flat mode
        while (next < options.length && options[next].type === 'province-header') next++
        return Math.min(options.length - 1, next)
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => {
        let next = index - 1
        while (next >= 0 && options[next].type === 'province-header') next--
        return Math.max(0, next)
      })
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(showAllOption ? 1 : 0)
    } else if (event.key === 'End') {
      event.preventDefault()
      let last = options.length - 1
      while (last >= 0 && options[last].type === 'province-header') last--
      setActive(last)
    } else if (event.key === 'Enter' || event.key === ' ') {
      const opt = options[active]
      if (opt) {
        if (mode === 'province-first' && opt.type === 'province') {
          event.preventDefault()
          choose(opt.value)
        } else if (opt.type !== 'province-header') {
          event.preventDefault()
          choose(opt.value)
        }
      }
    } else if (event.key === 'Escape') {
      if (mode === 'province-first' && selectedProvince) {
        event.preventDefault()
        goBackToProvinces()
      } else {
        setOpen(false)
        setSelectedProvince(null)
        buttonRef.current?.focus()
      }
    } else if (event.key === 'Tab') {
      setOpen(false)
      setSelectedProvince(null)
      buttonRef.current?.focus()
    }
  }

  function onSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(event.target.value)
    setActive(showAllOption ? 1 : 0)
  }

  // Render functions
  const renderProvinceItem = (option: FlatOption, index: number, isSelected: boolean) => (
    <li
      key={option.value}
      id={`${listId}-${index}`}
      role="option"
      aria-selected={isSelected}
      className={`select-option ${index === active ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
      onPointerEnter={() => setActive(index)}
      onClick={() => choose(option.value)}
    >
      <span>{option.label}</span>
      <IconArrowRight />
    </li>
  )

  const renderCityItem = (option: FlatOption, index: number, isSelected: boolean) => (
    <li
      key={option.value}
      id={`${listId}-${index}`}
      role="option"
      aria-selected={isSelected}
      className={`select-option ${index === active ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
      onPointerEnter={() => setActive(index)}
      onClick={() => choose(option.value)}
    >
      <span>{option.label}</span>
      {option.province && <span className="select-option-province">{option.province}</span>}
      {isSelected && <IconCheck />}
    </li>
  )

  const renderAllOption = (index: number, isSelected: boolean) => (
    <li
      key="all"
      id={`${listId}-${index}`}
      role="option"
      aria-selected={isSelected}
      className={`select-option ${index === active ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''} select-option--all`}
      onPointerEnter={() => setActive(index)}
      onClick={() => choose('')}
    >
      <span>{allLabel}</span>
      {isSelected && <IconCheck />}
    </li>
  )

  const renderProvinceHeader = (option: FlatOption, _index: number) => (
    <li key={option.value} className="select-province-header" role="separator" aria-label={option.label}>
      <span>{option.label}</span>
    </li>
  )

  return (
    <div className={`select select--${variant} select--searchable`}>
      <button
        ref={buttonRef}
        className="select-button"
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.preventDefault()
          if (open) {
            setOpen(false)
            setSelectedProvince(null)
          } else {
            openList()
          }
        }}
      >
        {icon}
        <span className="select-value">{current.label}</span>
        <IconChevron />
      </button>

      {open
        ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            className="select-list select-list--searchable"
            role="listbox"
            tabIndex={-1}
            style={pos}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKey}
          >
            {/* Search input */}
            <li className="select-search-wrapper">
              <div className="select-search">
                <IconSearch />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="select-search-input"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={onSearchChange}
                  aria-label="Cari kota atau provinsi"
                  autoComplete="off"
                />
              </div>
            </li>

            {/* Back button for province-first mode when in city view */}
            {mode === 'province-first' && selectedProvince && (
              <li className="select-back-wrapper">
                <button
                  type="button"
                  className="select-back-button"
                  onClick={goBackToProvinces}
                  aria-label="Kembali ke daftar provinsi"
                >
                  <IconChevron />
                  <span>Kembali ke provinsi</span>
                </button>
              </li>
            )}

            {options.length === 0 ? (
              <li className="select-option select-option--empty" role="option" aria-disabled="true">
                <span>Tidak ditemukan</span>
              </li>
            ) : (
              options.map((option, index) => {
                const isSelected = option.value === value
                if (option.type === 'province-header') {
                  return renderProvinceHeader(option, index)
                }
                if (option.type === 'all') {
                  return renderAllOption(index, isSelected)
                }
                if (option.type === 'province') {
                  return renderProvinceItem(option, index, isSelected)
                }
                return renderCityItem(option, index, isSelected)
              })
            )}
          </ul>,
          document.body
        )
        : null}
    </div>
  )
}

// Re-export types for convenience
export type { ProvinceGroup } from '../data/indonesia-cities'