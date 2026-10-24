export interface CityEntry {
  name: string
  type: string
  gid: string
  search: string
}

export interface ProvinceGroup {
  province: string
  provinceKey: string
  cities: CityEntry[]
}