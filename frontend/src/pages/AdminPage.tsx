import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import {
  ApiError,
  createAdminUser,
  createAdminVehicle,
  deleteAdminUser,
  deleteAdminVehicle,
  fetchAdminUsers,
  fetchAdminVehicles,
  updateAdminUser,
  updateAdminVehicle,
} from '../api/client'
import { clearSession, readSession } from '../auth/session'
import { CITY_OPTIONS, findCity } from '../cities'
import type {
  AdminUserInput,
  AdminVehicle,
  AdminVehicleInput,
  Role,
  Session,
  User,
  VehicleType,
} from '../types'

type Tab = 'users' | 'vehicles'

interface UserForm {
  id: number | null
  name: string
  email: string
  password: string
  role: Role
  operating_city: string
}

interface VehicleForm {
  id: number | null
  name: string
  plate: string
  type: VehicleType
  operating_city: string
  home_lat: string
  home_lng: string
  driver_id: string
  status: 'available' | 'offline'
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
}

const TYPE_LABEL: Record<VehicleType, string> = {
  ambulance: 'Ambulans',
  fire: 'Damkar',
  police: 'Patroli',
}

const STATUS_LABEL: Record<string, string> = {
  available: 'Tersedia',
  assigned: 'Ditugaskan',
  en_route: 'Menuju lokasi',
  on_scene: 'Di lokasi',
  offline: 'Offline',
}

function emptyUserForm(): UserForm {
  return {
    id: null,
    name: '',
    email: '',
    password: '',
    role: 'dispatcher',
    operating_city: '',
  }
}

function emptyVehicleForm(): VehicleForm {
  const city = CITY_OPTIONS[0]
  return {
    id: null,
    name: '',
    plate: '',
    type: 'ambulance',
    operating_city: city.name,
    home_lat: String(city.center[0]),
    home_lng: String(city.center[1]),
    driver_id: '',
    status: 'available',
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export function AdminPage() {
  const navigate = useNavigate()
  const [session] = useState<Session | null>(() => readSession())
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [vehicles, setVehicles] = useState<AdminVehicle[]>([])
  const [cityFilter, setCityFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [userForm, setUserForm] = useState<UserForm | null>(null)
  const [vehicleForm, setVehicleForm] = useState<VehicleForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleUnauthorized = useCallback(() => {
    clearSession()
    navigate('/login', { replace: true })
  }, [navigate])

  const loadAll = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setLoadError(null)
    try {
      const [nextUsers, nextVehicles] = await Promise.all([
        fetchAdminUsers(session.token),
        fetchAdminVehicles(session.token, cityFilter),
      ])
      setUsers(nextUsers)
      setVehicles(nextVehicles)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      if (err instanceof ApiError && err.status === 403) {
        setLoadError('Halaman ini khusus admin.')
        return
      }
      setLoadError(errorText(err, 'Gagal memuat data admin.'))
    } finally {
      setLoading(false)
    }
  }, [session, cityFilter, handleUnauthorized])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- memuat data admin dari API
    void loadAll()
  }, [loadAll])

  const drivers = useMemo(() => users.filter((user) => user.role === 'driver'), [users])
  const cityDrivers = useMemo(() => {
    if (!vehicleForm) return []
    return drivers.filter((driver) => driver.operating_city === vehicleForm.operating_city)
  }, [drivers, vehicleForm])

  function handleLogout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  function openCreateUser() {
    setTab('users')
    setUserForm(emptyUserForm())
    setFormError(null)
    setNotice(null)
  }

  function openEditUser(user: User) {
    setTab('users')
    setUserForm({
      id: user.id,
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      operating_city: user.operating_city ?? '',
    })
    setFormError(null)
    setNotice(null)
  }

  function openCreateVehicle() {
    setTab('vehicles')
    setVehicleForm(emptyVehicleForm())
    setFormError(null)
    setNotice(null)
  }

  function openEditVehicle(vehicle: AdminVehicle) {
    setTab('vehicles')
    setVehicleForm({
      id: vehicle.id,
      name: vehicle.name,
      plate: vehicle.plate,
      type: vehicle.type,
      operating_city: vehicle.operating_city ?? CITY_OPTIONS[0].name,
      home_lat: String(vehicle.home_lat),
      home_lng: String(vehicle.home_lng),
      driver_id: vehicle.driver_id ? String(vehicle.driver_id) : '',
      status: vehicle.status === 'offline' ? 'offline' : 'available',
    })
    setFormError(null)
    setNotice(null)
  }

  function updateUserField<K extends keyof UserForm>(field: K, value: UserForm[K]) {
    setUserForm((previous) => {
      if (!previous) return previous
      const next = { ...previous, [field]: value }
      if (field === 'role') {
        if (value === 'admin') next.operating_city = ''
        if (value === 'driver' && !next.operating_city) {
          next.operating_city = CITY_OPTIONS[0].name
        }
      }
      return next
    })
  }

  function updateVehicleField<K extends keyof VehicleForm>(field: K, value: VehicleForm[K]) {
    setVehicleForm((previous) => {
      if (!previous) return previous
      const next = { ...previous, [field]: value }
      if (field === 'operating_city') {
        const city = findCity(String(value))
        if (city) {
          next.home_lat = String(city.center[0])
          next.home_lng = String(city.center[1])
        }
        const driverStillValid = drivers.some(
          (driver) => String(driver.id) === next.driver_id && driver.operating_city === value,
        )
        if (!driverStillValid) next.driver_id = ''
      }
      return next
    })
  }

  async function submitUser(event: FormEvent) {
    event.preventDefault()
    if (!session || !userForm) return
    setSaving(true)
    setFormError(null)
    setNotice(null)

    const input: AdminUserInput = {
      name: userForm.name.trim(),
      email: userForm.email.trim().toLowerCase(),
      password: userForm.password,
      role: userForm.role,
      operating_city: userForm.role === 'admin' ? '' : userForm.operating_city,
    }

    try {
      if (userForm.id == null) {
        await createAdminUser(session.token, input)
        setNotice('User baru berhasil dibuat.')
      } else {
        await updateAdminUser(session.token, userForm.id, input)
        setNotice('User berhasil diperbarui.')
      }
      setUserForm(null)
      await loadAll()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setFormError(errorText(err, 'Gagal menyimpan user.'))
    } finally {
      setSaving(false)
    }
  }

  async function submitVehicle(event: FormEvent) {
    event.preventDefault()
    if (!session || !vehicleForm) return
    setSaving(true)
    setFormError(null)
    setNotice(null)

    const input: AdminVehicleInput = {
      name: vehicleForm.name.trim(),
      plate: vehicleForm.plate.trim(),
      type: vehicleForm.type,
      operating_city: vehicleForm.operating_city,
      home_lat: Number(vehicleForm.home_lat),
      home_lng: Number(vehicleForm.home_lng),
      driver_id: vehicleForm.driver_id ? Number(vehicleForm.driver_id) : null,
    }

    const current = vehicleForm.id == null ? null : vehicles.find((item) => item.id === vehicleForm.id)
    if (current && (current.status === 'available' || current.status === 'offline')) {
      input.status = vehicleForm.status
    }

    try {
      if (vehicleForm.id == null) {
        await createAdminVehicle(session.token, input)
        setNotice('Kendaraan baru berhasil dibuat.')
      } else {
        await updateAdminVehicle(session.token, vehicleForm.id, input)
        setNotice('Kendaraan berhasil diperbarui.')
      }
      setVehicleForm(null)
      await loadAll()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setFormError(errorText(err, 'Gagal menyimpan kendaraan.'))
    } finally {
      setSaving(false)
    }
  }

  async function removeUser(user: User) {
    if (!session) return
    if (!window.confirm(`Hapus user ${user.name} (${user.email})?`)) return
    setFormError(null)
    setNotice(null)
    try {
      await deleteAdminUser(session.token, user.id)
      setNotice(`User ${user.name} dihapus.`)
      if (userForm?.id === user.id) setUserForm(null)
      await loadAll()
    } catch (err) {
      setFormError(errorText(err, 'Gagal menghapus user.'))
    }
  }

  async function removeVehicle(vehicle: AdminVehicle) {
    if (!session) return
    if (!window.confirm(`Hapus kendaraan ${vehicle.name} (${vehicle.plate})?`)) return
    setFormError(null)
    setNotice(null)
    try {
      await deleteAdminVehicle(session.token, vehicle.id)
      setNotice(`Kendaraan ${vehicle.name} dihapus.`)
      if (vehicleForm?.id === vehicle.id) setVehicleForm(null)
      await loadAll()
    } catch (err) {
      setFormError(errorText(err, 'Gagal menghapus kendaraan.'))
    }
  }

  if (!session) return null

  return (
    <div className="admin-shell">
      <header className="topbar topbar--light">
        <div className="topbar-brand">
          <span className="brand-mark brand-mark--small" aria-hidden="true">
            <span />
            <span />
          </span>
          <div>
            <p className="brand-name">Dispatch</p>
            <p className="topbar-sub">Panel Admin · MVP</p>
          </div>
        </div>
        <div className="topbar-right">
          <Link className="button button-ghost" to="/map">
            Peta operasi
          </Link>
          <div className="user-chip">
            <span className="user-chip-name">{session.user.name}</span>
            <span className="user-chip-role">{session.user.role}</span>
          </div>
          <button className="button button-ghost" type="button" onClick={handleLogout}>
            Keluar
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-heading">
          <div>
            <p className="eyebrow">Pengelolaan operasi</p>
            <h1>Panel Admin</h1>
            <p className="muted">Kelola akun user dan armada yang dipakai dispatcher di seluruh kota.</p>
          </div>
          <div className="admin-tabs" role="tablist" aria-label="Bagian admin">
            <button
              className={`admin-tab ${tab === 'users' ? 'admin-tab--active' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === 'users'}
              onClick={() => setTab('users')}
            >
              Users <span>{users.length}</span>
            </button>
            <button
              className={`admin-tab ${tab === 'vehicles' ? 'admin-tab--active' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === 'vehicles'}
              onClick={() => setTab('vehicles')}
            >
              Kendaraan <span>{vehicles.length}</span>
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="admin-alert admin-alert--error" role="alert">
            {loadError}
          </div>
        ) : null}
        {notice ? (
          <div className="admin-alert admin-alert--success" role="status">
            {notice}
          </div>
        ) : null}
        {formError && !userForm && !vehicleForm ? (
          <div className="admin-alert admin-alert--error" role="alert">
            {formError}
          </div>
        ) : null}

        <div className={`admin-layout ${userForm || vehicleForm ? 'admin-layout--form' : ''}`}>
          <section className="admin-card">
            <div className="admin-card-head">
              <div>
                <h2>{tab === 'users' ? 'Daftar User' : 'Daftar Kendaraan'}</h2>
                <p className="muted">
                  {tab === 'users'
                    ? 'Admin, dispatcher, dan driver. Password tidak pernah ditampilkan.'
                    : 'Perubahan langsung dipakai dispatcher pada peta dan pencarian kandidat.'}
                </p>
              </div>
              {tab === 'users' ? (
                <button className="button button-primary" type="button" onClick={openCreateUser}>
                  + User
                </button>
              ) : (
                <div className="admin-card-actions">
                  <select
                    className="admin-inline-select"
                    value={cityFilter}
                    onChange={(event) => setCityFilter(event.target.value)}
                    aria-label="Filter kota kendaraan"
                  >
                    <option value="">Semua kota</option>
                    {CITY_OPTIONS.map((city) => (
                      <option key={city.name} value={city.name}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                  <button className="button button-primary" type="button" onClick={openCreateVehicle}>
                    + Kendaraan
                  </button>
                </div>
              )}
            </div>

            {loading ? (
              <div className="admin-loading">
                <span className="spinner" aria-hidden="true" />
                Memuat data…
              </div>
            ) : tab === 'users' ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Kota</th>
                      <th className="admin-col-actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>{user.name}</td>
                        <td className="admin-mono">{user.email}</td>
                        <td>
                          <span className={`admin-badge admin-badge--${user.role}`}>
                            {ROLE_LABEL[user.role]}
                          </span>
                        </td>
                        <td>{user.operating_city ?? 'Nasional'}</td>
                        <td className="admin-col-actions">
                          <button className="admin-link" type="button" onClick={() => openEditUser(user)}>
                            Edit
                          </button>
                          <button
                            className="admin-link admin-link--danger"
                            type="button"
                            onClick={() => void removeUser(user)}
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Plat</th>
                      <th>Tipe</th>
                      <th>Kota</th>
                      <th>Status</th>
                      <th>Driver</th>
                      <th className="admin-col-actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((vehicle) => (
                      <tr key={vehicle.id}>
                        <td>{vehicle.name}</td>
                        <td className="admin-mono">{vehicle.plate}</td>
                        <td>{TYPE_LABEL[vehicle.type]}</td>
                        <td>{vehicle.operating_city ?? '—'}</td>
                        <td>
                          <span className={`admin-badge admin-badge--status-${vehicle.status}`}>
                            {STATUS_LABEL[vehicle.status] ?? vehicle.status}
                          </span>
                        </td>
                        <td>{vehicle.driver_name ?? 'Tanpa driver'}</td>
                        <td className="admin-col-actions">
                          <button
                            className="admin-link"
                            type="button"
                            onClick={() => openEditVehicle(vehicle)}
                          >
                            Edit
                          </button>
                          <button
                            className="admin-link admin-link--danger"
                            type="button"
                            onClick={() => void removeVehicle(vehicle)}
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {userForm ? (
            <aside className="admin-form-card" aria-label="Form user">
              <div className="admin-form-head">
                <div>
                  <p className="eyebrow">{userForm.id == null ? 'User baru' : 'Edit user'}</p>
                  <h2>{userForm.id == null ? 'Buat User' : userForm.name || 'Ubah User'}</h2>
                </div>
                <button
                  className="button button-ghost admin-close"
                  type="button"
                  onClick={() => {
                    setUserForm(null)
                    setFormError(null)
                  }}
                >
                  Tutup
                </button>
              </div>

              <form className="admin-form" onSubmit={submitUser}>
                <label className="field">
                  Nama
                  <input
                    value={userForm.name}
                    onChange={(event) => updateUserField('name', event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  Email
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(event) => updateUserField('email', event.target.value)}
                    disabled={userForm.id != null}
                    required
                  />
                  {userForm.id != null ? <span className="field-hint">Email tidak bisa diubah.</span> : null}
                </label>
                <label className="field">
                  {userForm.id == null ? 'Password' : 'Password baru (opsional)'}
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(event) => updateUserField('password', event.target.value)}
                    placeholder={userForm.id == null ? 'Minimal 6 karakter' : 'Kosongkan bila tidak diubah'}
                    required={userForm.id == null}
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    Role
                    <select
                      value={userForm.role}
                      onChange={(event) => updateUserField('role', event.target.value as Role)}
                    >
                      <option value="dispatcher">Dispatcher</option>
                      <option value="driver">Driver</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                  <label className="field">
                    Kota operasi
                    <select
                      value={userForm.operating_city}
                      onChange={(event) => updateUserField('operating_city', event.target.value)}
                      disabled={userForm.role === 'admin'}
                      required={userForm.role === 'driver'}
                    >
                      {userForm.role !== 'driver' ? <option value="">Nasional (NULL)</option> : null}
                      {CITY_OPTIONS.map((city) => (
                        <option key={city.name} value={city.name}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                    {userForm.role === 'admin' ? (
                      <span className="field-hint">Admin selalu nasional (NULL).</span>
                    ) : null}
                  </label>
                </div>

                {formError ? (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                ) : null}

                <div className="form-actions">
                  <button className="button button-primary" type="submit" disabled={saving}>
                    {saving ? 'Menyimpan…' : 'Simpan User'}
                  </button>
                </div>
              </form>
            </aside>
          ) : null}

          {vehicleForm ? (
            <aside className="admin-form-card" aria-label="Form kendaraan">
              <div className="admin-form-head">
                <div>
                  <p className="eyebrow">{vehicleForm.id == null ? 'Kendaraan baru' : 'Edit kendaraan'}</p>
                  <h2>{vehicleForm.id == null ? 'Buat Kendaraan' : vehicleForm.name || 'Ubah Kendaraan'}</h2>
                </div>
                <button
                  className="button button-ghost admin-close"
                  type="button"
                  onClick={() => {
                    setVehicleForm(null)
                    setFormError(null)
                  }}
                >
                  Tutup
                </button>
              </div>

              <form className="admin-form" onSubmit={submitVehicle}>
                <label className="field">
                  Nama kendaraan
                  <input
                    value={vehicleForm.name}
                    onChange={(event) => updateVehicleField('name', event.target.value)}
                    required
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    Plat
                    <input
                      value={vehicleForm.plate}
                      onChange={(event) => updateVehicleField('plate', event.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    Tipe
                    <select
                      value={vehicleForm.type}
                      onChange={(event) => updateVehicleField('type', event.target.value as VehicleType)}
                    >
                      <option value="ambulance">Ambulans</option>
                      <option value="fire">Damkar</option>
                      <option value="police">Patroli</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label className="field">
                    Kota operasi
                    <select
                      value={vehicleForm.operating_city}
                      onChange={(event) => updateVehicleField('operating_city', event.target.value)}
                    >
                      {CITY_OPTIONS.map((city) => (
                        <option key={city.name} value={city.name}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Driver
                    <select
                      value={vehicleForm.driver_id}
                      onChange={(event) => updateVehicleField('driver_id', event.target.value)}
                    >
                      <option value="">Tanpa driver</option>
                      {cityDrivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label className="field">
                    Home latitude
                    <input
                      type="number"
                      step="0.000001"
                      value={vehicleForm.home_lat}
                      onChange={(event) => updateVehicleField('home_lat', event.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    Home longitude
                    <input
                      type="number"
                      step="0.000001"
                      value={vehicleForm.home_lng}
                      onChange={(event) => updateVehicleField('home_lng', event.target.value)}
                      required
                    />
                  </label>
                </div>
                {vehicleForm.id != null ? (
                  <label className="field">
                    Status manual
                    <select
                      value={vehicleForm.status}
                      onChange={(event) =>
                        updateVehicleField('status', event.target.value as 'available' | 'offline')
                      }
                      disabled={
                        vehicles.find((item) => item.id === vehicleForm.id)?.status !== 'available' &&
                        vehicles.find((item) => item.id === vehicleForm.id)?.status !== 'offline'
                      }
                    >
                      <option value="available">Tersedia</option>
                      <option value="offline">Offline</option>
                    </select>
                  </label>
                ) : null}

                {formError ? (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                ) : null}

                <div className="form-actions">
                  <button className="button button-primary" type="submit" disabled={saving}>
                    {saving ? 'Menyimpan…' : 'Simpan Kendaraan'}
                  </button>
                </div>
              </form>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  )
}
