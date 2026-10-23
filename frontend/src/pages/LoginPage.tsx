import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError, login } from '../api/client'
import { homeForRole, readSession, saveSession } from '../auth/session'
import { ThemeToggle } from '../components/ThemeToggle'

const FEATURES = [
  'Auth dengan role dispatcher, driver, dan admin',
  'Posisi kendaraan langsung dari PostGIS',
  'Peta Google Maps untuk 6 kota operasi',
]

const FLEET = [
  { label: 'Ambulans', tone: 'ambulance' },
  { label: 'Damkar', tone: 'fire' },
  { label: 'Patroli', tone: 'police' },
] as const

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </svg>
  )
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="3" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  )
}

function IconEye({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  )
}

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </svg>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const session = readSession()
    if (session) {
      navigate(homeForRole(session.user.role), { replace: true })
    }
  }, [navigate])

  function detectCaps(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState('CapsLock'))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const session = await login(email.trim(), password)
      saveSession(session)
      navigate(homeForRole(session.user.role), { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Tidak bisa menghubungi server. Pastikan backend sedang berjalan.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="lg-shell">
      <section className="lg-pane" aria-labelledby="login-title">
        <div className="lg-pane-inner">
          <div className="lg-theme-toggle-wrapper">
            <ThemeToggle />
          </div>
          <header className="brand lg-brand">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <div>
              <p className="brand-name">Dispatch</p>
              <p className="brand-sub">Emergency Response Command Center</p>
            </div>
          </header>

          <div className="lg-heading">
            <p className="lg-kicker">
              <span className="lg-kicker-dot" aria-hidden="true" />
              Masuk ke command center
            </p>
            <h1 id="login-title">Siap menerima laporan?</h1>
            <p className="lg-lead">
              Gunakan akun yang terdaftar untuk mengakses peta kendaraan dan panel sesuai role.
            </p>
          </div>

          <form className="lg-form" onSubmit={handleSubmit} noValidate={false}>
            <div className="lg-field">
              <label htmlFor="login-email">Email</label>
              <div className="lg-control">
                <span className="lg-icon">
                  <IconMail />
                </span>
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="nama@dispatch.local"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="lg-field">
              <label htmlFor="login-password">Password</label>
              <div className="lg-control">
                <span className="lg-icon">
                  <IconLock />
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyUp={detectCaps}
                  onKeyDown={detectCaps}
                  onBlur={() => setCapsLock(false)}
                  required
                />
                <button
                  type="button"
                  className="lg-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  aria-pressed={showPassword}
                >
                  <IconEye off={showPassword} />
                </button>
              </div>
              {capsLock ? <p className="lg-hint">Caps Lock sedang aktif.</p> : null}
            </div>

            {error ? (
              <p className="lg-error" role="alert">
                <IconAlert />
                <span>{error}</span>
              </p>
            ) : null}

            <button className="lg-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="lg-spinner" aria-hidden="true" />
                  Memeriksa kredensial…
                </>
              ) : (
                <>
                  Masuk
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </>
              )}
            </button>
          </form>

          <p className="lg-foot">
            <span className="lg-foot-dot" aria-hidden="true" />
            Akses terbatas untuk petugas Dispatch. Semua aktivitas tercatat.
          </p>
        </div>
      </section>

      <aside className="lg-stage" aria-hidden="true">
        <div className="lg-grid" />

        <svg className="lg-radar" viewBox="0 0 400 400" focusable="false">
          <circle cx="200" cy="200" r="196" className="lg-ring" />
          <circle cx="200" cy="200" r="130" className="lg-ring" />
          <circle cx="200" cy="200" r="64" className="lg-ring" />
          <path d="M200 4v392M4 200h392" className="lg-axis" />
          <g className="lg-sweep">
            <path d="M200 200 L200 4 A196 196 0 0 1 338.6 61.4 Z" className="lg-wedge" />
            <path d="M200 200 L200 4" className="lg-sweep-line" />
          </g>
          <circle cx="200" cy="200" r="4" className="lg-core" />
          <g className="lg-blip lg-blip--ambulance"><circle cx="268" cy="104" r="6" /><circle cx="268" cy="104" r="6" className="lg-pulse" /></g>
          <g className="lg-blip lg-blip--fire"><circle cx="128" cy="244" r="6" /><circle cx="128" cy="244" r="6" className="lg-pulse" /></g>
          <g className="lg-blip lg-blip--police"><circle cx="276" cy="288" r="6" /><circle cx="276" cy="288" r="6" className="lg-pulse" /></g>
        </svg>

        <div className="lg-stage-body">
          <p className="lg-stage-kicker">Fase 1 · Foundation</p>
          <h2>Koordinasi respons dimulai dari satu layar.</h2>

          <ul className="lg-features">
            {FEATURES.map((item) => (
              <li key={item}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>

          <div className="lg-fleet">
            <span className="lg-live">
              <i />
              Realtime
            </span>
            <span className="lg-tag">6 kota</span>
            {FLEET.map((item) => (
              <span key={item.label} className={`lg-tag lg-tag--${item.tone}`}>
                <i />
                {item.label}
              </span>
            ))}
          </div>

          <p className="lg-stage-note">Dispatcher · Driver · Administrator</p>
        </div>
      </aside>
    </main>
  )
}
