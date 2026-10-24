/**
 * Membangun data batas wilayah untuk peta drill-down.
 *
 * Sumber: GADM 4.1 (https://gadm.org), level ADM1 (provinsi), ADM2
 * (kota/kabupaten), dan ADM3 (kecamatan) untuk Indonesia.
 *
 * Jalankan sekali saja dari folder frontend:
 *   node scripts/build-regions.mjs
 *
 * Hasil ditulis ke public/geo/ dan ikut disajikan oleh Vite. Script memakai
 * mapshaper lewat npx; tidak perlu dipasang sebagai dependency proyek.
 *
 * Catatan lisensi: GADM boleh dipakai untuk keperluan non-komersial. Untuk
 * produksi komersial, ganti sumber di bawah dengan dataset berlisensi ODbL
 * (mis. ekstraksi OSM) dan pertahankan struktur file yang sama.
 */
import { execSync } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(HERE, '..')
const CACHE = path.join(FRONTEND, '.cache', 'regions')
const OUT = path.join(FRONTEND, 'public', 'geo')

const SOURCES = {
  adm1: 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IDN_1.json',
  adm2: 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IDN_2.json',
  adm3: 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IDN_3.json',
}

/** Persentase vertex yang dipertahankan. Kecamatan butuh lebih banyak detail. */
const SIMPLIFY = { adm1: 2, adm2: 2, adm3: 10 }

/** Samakan dengan provinceFileKey() di src/lib/regions.ts. */
function fileKey(gid) {
  return gid
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function exists(file) {
  try {
    const info = await stat(file)
    return info.size > 1000
  } catch {
    return false
  }
}

async function download(name) {
  const target = path.join(CACHE, `${name}.json`)
  if (await exists(target)) return target
  console.log(`↓ ${name}: ${SOURCES[name]}`)
  const response = await fetch(SOURCES[name])
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
  return target
}

function simplify(input, output, percent) {
  console.log(`⋯ menyederhanakan ${path.basename(input)} (${percent}% vertex)`)
  execSync(
    `npx --yes mapshaper "${input}" -simplify ${percent}% keep-shapes -o "${output}" format=geojson`,
    { stdio: 'inherit', cwd: FRONTEND },
  )
}

function trim(props, keys) {
  const next = {}
  for (const key of keys) {
    if (props[key] != null) next[key] = props[key]
  }
  return next
}

async function writeCollection(file, collection) {
  await writeFile(file, JSON.stringify(collection))
  const info = await stat(file)
  console.log(`✓ ${path.relative(FRONTEND, file)} (${(info.size / 1024).toFixed(0)} KB)`)
}

async function main() {
  await mkdir(CACHE, { recursive: true })
  await mkdir(OUT, { recursive: true })

  const [adm1, adm2, adm3] = await Promise.all([
    download('adm1'),
    download('adm2'),
    download('adm3'),
  ])

  const work = path.join(CACHE, 'simplified')
  await mkdir(work, { recursive: true })

  const adm1Out = path.join(work, 'adm1.geojson')
  const adm2Out = path.join(work, 'adm2.geojson')
  const adm3Out = path.join(work, 'adm3.geojson')

  if (!(await exists(adm1Out))) simplify(adm1, adm1Out, SIMPLIFY.adm1)
  if (!(await exists(adm2Out))) simplify(adm2, adm2Out, SIMPLIFY.adm2)
  if (!(await exists(adm3Out))) simplify(adm3, adm3Out, SIMPLIFY.adm3)

  const provinces = JSON.parse(await readFile(adm1Out, 'utf8'))
  const cities = JSON.parse(await readFile(adm2Out, 'utf8'))
  const districts = JSON.parse(await readFile(adm3Out, 'utf8'))

  for (const feature of provinces.features) {
    feature.properties = trim(feature.properties, ['GID_1', 'NAME_1'])
  }
  for (const feature of cities.features) {
    feature.properties = trim(feature.properties, [
      'GID_1',
      'NAME_1',
      'GID_2',
      'NAME_2',
      'TYPE_2',
    ])
  }

  const districtKeys = ['GID_1', 'NAME_1', 'GID_2', 'NAME_2', 'GID_3', 'NAME_3']
  const byProvince = new Map()
  for (const feature of districts.features) {
    feature.properties = trim(feature.properties, districtKeys)
    const gid = feature.properties.GID_1
    if (!gid) continue
    if (!byProvince.has(gid)) byProvince.set(gid, [])
    byProvince.get(gid).push(feature)
  }

  await writeCollection(path.join(OUT, 'adm1.geojson'), provinces)
  await writeCollection(path.join(OUT, 'adm2.geojson'), cities)

  for (const [gid, features] of byProvince) {
    await writeCollection(path.join(OUT, `adm3-${fileKey(gid)}.geojson`), {
      type: 'FeatureCollection',
      features,
    })
  }

  console.log(`\nSelesai: ${byProvince.size} file kecamatan di ${path.relative(FRONTEND, OUT)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
