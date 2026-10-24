import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ApiError, login } from '../api/client'
import { homeForRole, readSession, saveSession } from '../auth/session'
import { Brand } from '../components/Brand'
import { CITY_OPTIONS } from '../cities'
import { IconArrow } from '../components/icons'
import { ThemeToggle } from '../components/ThemeToggle'

const STEPS = [
  {
    title: 'Tandai lokasi kejadian',
    text: 'Klik titik di peta, isi jenis dan prioritas. Laporan langsung masuk ke antrean.',
  },
  {
    title: 'Pilih unit terdekat',
    text: 'Jarak dan waktu tiba dihitung lewat jalan sebenarnya, bukan garis lurus.',
  },
  {
    title: 'Pantau sampai tuntas',
    text: 'Posisi unit dan status tugas bergerak di layar dispatcher dan driver secara bersamaan.',
  },
]

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
      const firstName = session.user.name.trim().split(/\s+/)[0]
      toast.success(`Selamat datang kembali, ${firstName}`)
      navigate(homeForRole(session.user.role), { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Server tidak merespons. Periksa koneksi Anda atau hubungi admin sistem.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="lg-shell">
      <section className="lg-pane" aria-labelledby="login-title">
        <div className="lg-top">
          <Brand sub="Koordinasi unit darurat" size="md" />
          <ThemeToggle />
        </div>

        <div className="lg-center">
          <div className="lg-heading">
            <h1 id="login-title">Masuk ke Tanggap</h1>
            <p className="lg-lead">
              Gunakan akun dari instansi Anda. Halaman yang terbuka mengikuti peran akun: dispatcher, driver, atau admin.
            </p>
          </div>

          <form className="lg-form" onSubmit={handleSubmit}>
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
                  placeholder="nama@instansi.id"
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
                  placeholder="Password akun"
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
              {capsLock ? <p className="lg-hint">Caps Lock menyala.</p> : null}
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
                  Memeriksa…
                </>
              ) : (
                <>
                  Masuk
                  <IconArrow />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="lg-foot">Khusus petugas berwenang. Aktivitas akun tercatat.</p>
      </section>

      <aside className="lg-stage" aria-hidden="true">
        <svg className="lg-map" viewBox="0 60 760 320" preserveAspectRatio="xMidYMid slice" focusable="false">
          <path className="lg-water" d="M-20 300 C 90 270 150 330 260 310 S 430 250 520 290 S 700 350 790 320 V 470 H -20 Z" />
          <rect className="lg-park" x="540" y="-10" width="140" height="96" rx="14" />
          <g className="lg-blocks">
            <rect x="-20" y="-20" width="150" height="104" rx="8" />
            <rect x="160" y="-20" width="170" height="104" rx="8" />
            <rect x="360" y="-20" width="140" height="104" rx="8" />
            <rect x="700" y="-20" width="90" height="104" rx="8" />
            <rect x="-20" y="114" width="150" height="110" rx="8" />
            <rect x="160" y="114" width="170" height="110" rx="8" />
            <rect x="360" y="114" width="140" height="110" rx="8" />
            <rect x="530" y="114" width="110" height="110" rx="8" />
            <rect x="670" y="114" width="120" height="110" rx="8" />
          </g>
          <g>
            <path className="lg-street" d="M-20 99 H790 M-20 239 H790" />
            <path className="lg-street" d="M145 -20 V240 M345 -20 V240 M515 -20 V240 M655 -20 V240" />
            <path className="lg-street lg-street--minor" d="M-20 169 H790 M245 -20 V240 M425 -20 V240 M590 114 V240" />
          </g>
          <path className="lg-route-casing" d="M145 338 V239 H345 V99 H575" />
          <path className="lg-route" d="M145 338 V239 H345 V99 H575" />
          <g className="lg-pin lg-pin--unit" transform="translate(145 338)">
            <circle r="10" />
            <circle r="4" className="lg-pin-core" />
          </g>
          <g transform="translate(575 99)">
            <circle className="lg-pulse" r="14" />
          </g>
          <g className="lg-pin lg-pin--incident" transform="translate(575 99)">
            <rect x="-9" y="-9" width="18" height="18" rx="4" transform="rotate(45)" />
          </g>
        </svg>

        <div className="lg-stage-body">
          <h2>Dari laporan masuk sampai unit tiba, semuanya terlihat di satu peta.</h2>

          <ol className="lg-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="lg-step-no">{index + 1}</span>
                <div>
                  <p className="lg-step-title">{step.title}</p>
                  <p className="lg-step-text">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <dl className="lg-facts">
            <div>
              <dt>Kota terlayani</dt>
              <dd>{CITY_OPTIONS.length}</dd>
            </div>
            <div>
              <dt>Jenis unit</dt>
              <dd>3</dd>
            </div>
            <div>
              <dt>Peran akun</dt>
              <dd>3</dd>
            </div>
          </dl>
        </div>
      </aside>
    </main>
  )
}
