# Error handling

Throwing is bad. Once you throw you have to remember to catch it. But you might choose to not catch it or simply forget. Even if you catch it the type of the error is `unknown` and rightly so because `try`/`catch` is not error-handling control-flow because you can throw anything not just errors. Additionally even if you do some kind of check if the value is actually an error the TS server won't know which error. This means every `catch` must inherently be overly verbose (10+ LoC) to deal with this unambiguity and indirection.

We take inspiration from languages like Go and Rust where error-handling is direct and explicit.

The most important difference from `try`/`catch` is that in Spectoda we return the errors instead of throwing them.

## Private errors

This is the simplest way to express that a function can fail.

The target audience of private errors are developers like yourself.

They shouldn't make it past I/O (e.g. be returned from backend endpoint and potentially displayed to the user).

They can be anonymous `privateError()` or named `privateError('ERROR_NAME')`.

The convention for error names/IDs is that they're written in `SCREAMING_CASE`.

You can then use `matchError` or `matchErrors` in your control flow to have different behavior for different erros.

If private error is considered critical and should notify the team then it should be called as `privateError.fatal()`.

## Public errors

Compared to private errors there are three notable changes:
1) Target audience are users (public errors are ment to cross I/O and get diplayed)
2) They can carry an additional context in addition to ID
3) They have to have an ID

The ID of public errors is a path defined in `ERROR_MAP`.

If public error is considered critical and should notify the team then it should be called as `publicError.fatal()`.

## Error map

Error map is the source-of-truth for all public errors.

Before a public error can be used it has to be defined in an `ERROR_MAP` first.

The `ERROR_MAP` is located in `./src/constants.ts`.

Just like in named private errors the error code should be written in `SCREAMING_CASE`.

The error code should be prefixed with the name of the function, e.g. `parseJSVersion.INVALID_FORMAT`.

The function should be prefixed with a namespace, e.g. `firmware.parseJsVersion.INVALID_FORMAT`.

It's up to the developer to choose the right namespace, however the namespace shouldn't be more than 2 levels deep, e.g. `spectoda_js.wasm.firmware.parseJsVersion.INVALID_FORMAT`.

Each error is defined as a function in format `(context?: unknown) => Record<Language, unknown>`.

If more than one variable is needed for the context then the context has to be an object.

The output in any given language can be anything (e.g. string, object, array) but it has to be the same type for all languages in that given error (TS server will error if types are different or a language is missing).

## Translate

Since public errors carry only ID and optional context we have to have a mechanism to translate them into a human-readable error message.

This is where you would use `translate(error)`.

By default `translate` uses the first language defined in `ERROR_MAP`.

You can change this language by calling `setLanguage(language)` to change the currently active language.

The error passed into `translate` has to be a valid Spectoda error so you should wrap it in `if(isError(error))`.

## Helpers

### `isError(maybe_error)`

Checks whether the provided value is a valid Spectoda error.

Internally it checks if `__ERROR__` attribute is present.

### `matchError(error, id)`

Checks whether the provided error is of the given ID.

### `matchErrors(error, ids)`

Checks whether the provided error is any of the given IDs.
