export type UnknownObject = Record<string, unknown>
export type UnknownArray = unknown[]

export type Nullable<$Type> = $Type | null

export type Primative = Nullable<string | number | boolean | undefined>

export type JsonArray = Json[]
export type JsonObject = { [key: string]: Json }
export type JsonComposite = JsonArray | JsonObject
export type Json = Primative | JsonComposite

export type Required<$Type> = {
  [$Key in keyof $Type]-?: $Type[$Key]
}
