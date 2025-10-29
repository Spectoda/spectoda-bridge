import { Prisma } from '@prisma/client'

/**
 * Picks keys from `T` where the value type is nullable.
 *
 * @example
 * type Example = { a: number; b: string | null; c: undefined };
 * // Result: { b: string | null }
 * type NullableKeys = PickNullableKeys<Example>;
 */
type PickNullableKeys<T> = {
  [P in keyof T as null extends T[P] ? P : never]: T[P]
}

/**
 * Picks keys from `T` where the value type is not nullable.
 *
 * @example
 * type Example = { a: number; b: string | null; c: undefined };
 * // Result: { a: number; c: undefined }
 * type NotNullableKeys = PickNotNullableKeys<Example>;
 */
type PickNotNullableKeys<T> = {
  [P in keyof T as null extends T[P] ? never : P]: T[P]
}

/**
 * Makes nullable keys optional and non-nullable keys remain the same.
 *
 * @example
 * type Example = { a: number; b: string | null; c: undefined };
 * // Result: { a: number; b?: string; c: undefined }
 * type NullableOptionalExample = NullableOptional<Example>;
 */

export type NullableOptional<T> = {
  [K in keyof PickNullableKeys<T>]?: T[K]
} & {
  [K in keyof PickNotNullableKeys<T>]: T[K]
}

/**
 * Makes all keys in `T` non-nullable.
 *
 * @example
 * type Example = { a: number; b: string | null; c: undefined | null };
 * // Result: { a: number; b: string; c: undefined | null }
 * type NonNullableA = AllKeysNonNullable<Example>;
 */
export type AllKeysNonNullable<T> = {
  [K in keyof T]-?: NonNullable<T[K]>
}

/**
 * Allows `T` to be null or undefined.
 *
 * @example
 * type Example = { a: number };
 * // Result: { a: number } | null | undefined
 * type NullableExample = Nullable<Example>;
 */

export type Nullable<T> = T | null | undefined

/**
 * Makes specific keys in `T` optional.
 *
 * @example
 * type Example = { a: number; b: string; c: boolean };
 * // Result: { a: number; c: boolean; b?: string }
 * type PartialB = PartialKeys<Example, 'b'>;
 */
export type PartialKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * Makes specific keys in `T` required (but doesn't change nullability).
 *
 * @example
 * type Example = { a: number; b?: string; c: boolean };
 * // Result: { a: number; c: boolean; b: string }
 * type RequiredB = RequiredKeys<Example, 'b'>;
 */
export type RequiredKeys<T, K extends keyof T> = Omit<T, K> &
  Required<Pick<T, K>>

/**
 * Makes specific keys in `T` non-nullable (removes null and undefined).
 *
 * @example
 * type Example = { a: number; b: string | null; c: boolean | null };
 * // Result: { a: number; b: string; c: boolean | null }
 * type NonNullableB = NonNullableKeys<Example, 'b'>;
 */
export type NonNullableKeys<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: NonNullable<T[P]>
}

/**
 * Converts `null` values to `null | undefined` in `T`.
 *
 * @example
 * type Example = { a: number; b: string | null; c: boolean | null };
 * // Result: { a: number; b: string | null | undefined; c: boolean | null | undefined }
 * type NullToNullableExample = NullToNullable<Example>;
 */
export type NullToNullable<T> = {
  [K in keyof T]: null extends T[K]
    ? Exclude<T[K], null> | null | undefined
    : T[K]
}

export const ObjectValues = <T extends Record<string, unknown>>(
  obj: T,
): Array<T[keyof T]> => Object.values(obj) as Array<T[keyof T]>

export const ObjectKeys = <T extends Record<string, unknown>>(
  obj: T,
): Array<keyof T> => Object.keys(obj) as Array<keyof T>

type ExtractJsonFields<$Type extends Record<string, unknown>> = {
  [K in keyof $Type]: typeof Prisma.JsonNull extends $Type[K] ? K : never
}[keyof $Type]

export type PrismaSelectiveNullToJsonNull<
  $Source,
  $Target extends Record<string, unknown>,
> = {
  [K in keyof $Source]: K extends ExtractJsonFields<$Target>
    ? $Source[K] extends null
      ? typeof Prisma.JsonNull
      : $Source[K] extends null | infer U
      ? typeof Prisma.JsonNull | U
      : $Source[K]
    : $Source[K]
}

export type Brand<T, B extends string> = T & { __id: B }
