import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel?: string
  /** Ikon di kiri tombol (opsional). */
  icon?: ReactNode
  /** "filter" memakai latar abu-abu muda untuk bilah alat; "field" untuk form. */
  variant?: 'field' | 'filter'
}

function IconChevron() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

/**
 * Pemilih kustom. Daftar memakai posisi fixed supaya tidak terpotong panel yang bisa digulir
 * (form admin, strip armada). Mendukung keyboard: panah, Home/End, Enter/Spasi, Esc.
 */
export function Select({ value, options, onChange, disabled = false, ariaLabel, icon, variant = 'field' }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const listId = useId()

  const current = options.find((option) => option.value === value)

  function openList() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom - 16
      const above = rect.top - 16
      const needed = Math.min(320, options.length * 42 + 12)
      const flip = below < needed && above > below
      const maxHeight = Math.max(140, Math.min(320, flip ? above : below))
      setPos({
        left: rect.left,
        minWidth: Math.max(rect.width, 160),
        maxHeight,
        ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      })
    }
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
  }

  function choose(next: string) {
    setOpen(false)
    buttonRef.current?.focus()
    if (next !== value) onChange(next)
  }

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const close = (event: Event) => {
      const target = event.target as Node
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const dismissOnScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const dismiss = () => setOpen(false)
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
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(options.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(options[active].value)
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false)
      buttonRef.current?.focus()
    }
  }

  return (
    <div className={`select select--${variant}`}>
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
          if (open) setOpen(false)
          else openList()
        }}
      >
        {icon}
        <span className="select-value">{current?.label ?? ''}</span>
        <IconChevron />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          className="select-list"
          role="listbox"
          tabIndex={-1}
          style={pos}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((option, index) => (
            <li
              key={option.value || 'empty'}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`select-option ${index === active ? 'is-active' : ''} ${option.value === value ? 'is-selected' : ''}`}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value ? <IconCheck /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
