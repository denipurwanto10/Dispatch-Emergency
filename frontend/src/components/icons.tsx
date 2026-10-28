import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
)

export const IconBack = (p: IconProps) => (
  <Base {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Base>
)

export const IconArrow = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
)

export const IconMap = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z" />
    <path d="M9 4v14M15 6v14" />
  </Base>
)

export const IconLogout = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H9" />
    <path d="M15 8l4 4-4 4M19 12H9.5" />
  </Base>
)

export const IconPin = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </Base>
)

export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Base>
)

export const IconRefresh = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 11a8 8 0 0 0-14.2-4.6L4 8.5M4 4v4.5h4.5" />
    <path d="M4 13a8 8 0 0 0 14.2 4.6l1.8-2.1M20 20v-4.5h-4.5" />
  </Base>
)

export const IconExpand = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </Base>
)

export const IconMenu = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
)

export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
)

export const IconMoon = (p: IconProps) => (
  <Base {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
  </Base>
)

export const IconSun = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
  </Base>
)

export const IconSidebar = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </Base>
)

export const IconLayers = (p: IconProps) => (
  <Base {...p}>
    <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
  </Base>
)

export const IconTruck = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 6.5h11v9H3zM14 9.5h3.8l3.2 3.4v2.6h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Base>
)

export const IconSliders = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Base>
)

export const IconChevronDown = (p: IconProps) => (
  <Base {...p}>
    <path d="m6 9 6 6 6-6" />
  </Base>
)
