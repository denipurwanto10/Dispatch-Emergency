/**
 * Generate indonesia-cities.json from GADM adm2.geojson
 * Run: node scripts/generate-cities-json.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(HERE, '..')
const ADM2_FILE = path.join(FRONTEND, 'public', 'geo', 'adm2.geojson')
const OUT_FILE = path.join(FRONTEND, 'src', 'data', 'indonesia-cities.json')

/** Better readable function for Indonesian names */
function readable(raw) {
  let result = raw
  // Handle "Kota" and "Kabupaten" prefixes first
  result = result.replace(/^Kota([A-Z])/, 'Kota $1')
  result = result.replace(/^Kabupaten([A-Z])/, 'Kabupaten $1')
  // Handle camelCase: lowercase followed by uppercase
  result = result.replace(/([a-z])([A-Z])/g, '$1 $2')
  // Handle consecutive capitals followed by lowercase (e.g., "KepulauanSeribu" -> "Kepulauan Seribu")
  result = result.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
  return result
}

// Province order by island (for better UX)
const provinceOrder = [
  'Aceh', 'SumateraUtara', 'SumateraBarat', 'Riau', 'Jambi', 'SumateraSelatan', 'Bengkulu', 'Lampung', 'BangkaBelitung', 'KepulauanRiau',
  'JakartaRaya', 'JawaBarat', 'JawaTengah', 'Yogyakarta', 'JawaTimur', 'Banten',
  'Bali', 'NusaTenggaraBarat', 'NusaTenggaraTimur',
  'KalimantanBarat', 'KalimantanTengah', 'KalimantanSelatan', 'KalimantanTimur', 'KalimantanUtara',
  'SulawesiUtara', 'SulawesiTengah', 'SulawesiSelatan', 'SulawesiTenggara', 'Gorontalo', 'SulawesiBarat',
  'Maluku', 'MalukuUtara',
  'Papua', 'PapuaBarat'
]

const provinceLabels = {
  'JakartaRaya': 'DKI Jakarta',
  'Yogyakarta': 'DI Yogyakarta',
  'BangkaBelitung': 'Kepulauan Bangka Belitung'
}

async function main() {
  const adm2 = JSON.parse(await readFile(ADM2_FILE, 'utf8'))

  // Group by province
  const byProvince = new Map()
  for (const feature of adm2.features) {
    const prov = feature.properties.NAME_1
    if (!byProvince.has(prov)) byProvince.set(prov, [])
    byProvince.get(prov).push(feature)
  }

  const grouped = []
  for (const [provKey, features] of byProvince) {
    const label = provinceLabels[provKey] ?? readable(provKey)
    const cities = features
      .map(f => {
        const name = readable(f.properties.NAME_2)
        const type = f.properties.TYPE_2
        let displayName = name
        if (type === 'Kota') {
          displayName = name.startsWith('Kota ') ? name : `Kota ${name}`
        } else if (type === 'Kabupaten') {
          displayName = name.startsWith('Kabupaten ') ? name : `Kabupaten ${name}`
        }
        return {
          name: displayName,
          type,
          gid: f.properties.GID_2,
          search: `${displayName} ${label}`
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'id'))

    grouped.push({
      province: label,
      provinceKey: provKey,
      cities
    })
  }

  // Sort by island order
  grouped.sort((a, b) => {
    const ai = provinceOrder.indexOf(a.provinceKey)
    const bi = provinceOrder.indexOf(b.provinceKey)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  await writeFile(OUT_FILE, JSON.stringify(grouped, null, 2))
  const totalCities = grouped.reduce((sum, g) => sum + g.cities.length, 0)
  console.log(`Done: ${grouped.length} provinces, ${totalCities} cities`)
}

main().catch(e => { console.error(e); process.exit(1) })