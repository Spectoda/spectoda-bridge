import { UnknownObject } from './types/general'

export type FullErrorDefinition<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $Language extends string = any,
  $Context extends UnknownObject = never,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $Output = any,
> = (context: $Context) => Record<$Language, $Output>

export type PublicErrorMap<$Language extends string> = Record<
  string,
  | FullErrorDefinition<$Language>
  | Record<
      string,
      | FullErrorDefinition<$Language>
      | Record<
          string,
          | FullErrorDefinition<$Language>
          | Record<
              string,
              | FullErrorDefinition<$Language>
              | Record<
                  string,
                  | FullErrorDefinition<$Language>
                  | Record<
                      string,
                      | FullErrorDefinition<$Language>
                      | Record<
                          string,
                          | FullErrorDefinition<$Language>
                          | Record<string, FullErrorDefinition<$Language>>
                        >
                    >
                >
            >
        >
    >
>

export const defineMap = <
  const $Languages extends string[],
  const $ErrorMap extends PublicErrorMap<$Languages[number]>,
>(
  languages: $Languages,
  error_map: $ErrorMap,
) => {
  return {
    languages,
    error_map,
  }
}
