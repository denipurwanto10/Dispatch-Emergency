export interface CityEntry {
  name: string
  type: 'Kota' | 'Kabupaten'
  gid: string
  search: string
}

export interface ProvinceGroup {
  province: string
  provinceKey: string
  cities: CityEntry[]
}

declare const indonesiaCities: ProvinceGroup[]
export default indonesiaCities
export { indonesiaCities }