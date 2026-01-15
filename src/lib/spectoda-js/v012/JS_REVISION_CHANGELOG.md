# spectoda-js JS Revision Changelog

This document tracks significant API changes in spectoda-js that affect remote control compatibility.
The JS revision number is used by `spectoda-core` to determine which API signatures to use when
communicating with remote control receivers.

## How JS Revisions Work

When spectoda-core connects to a remote spectoda instance (via remote control), it calls
`spectoda.version()` to get the receiver's JS revision. Based on this revision, spectoda-core
determines which API signatures are supported and calls the appropriate methods.

The JS revision is defined in `src/version.ts` and should be incremented whenever significant
API changes are made that would break compatibility with older receivers.

## Version Information

The `spectoda.version()` method returns:

```typescript
type SpectodaVersion = {
  wasmFullVersion: string // WASM version (e.g., "DEBUG_UNIVERSAL_0.12.11_20251123")
  jsRevision: number      // JS revision number
}
```

---

## JS Revision 1 (December 2024)

**Breaking Changes:**

### `connect()` signature changed

**Old signature (JS Revision 0):**
```typescript
connect(
  criteria: Criteria,
  autoConnect: boolean,
  ownerSignature: NetworkSignature,
  ownerKey: NetworkKey,
  connectAny: boolean,
  fwVersion: string,
  autonomousReconnection: boolean,
  overrideConnection: boolean
): Promise<Criterium | null>
```

**New signature (JS Revision 1):**
```typescript
connect(
  connector: ConnectorType,
  criteria: Criteria,
  options?: ConnectOptions
): Promise<Criterium | null>

type ConnectOptions = {
  autoSelect?: boolean           // formerly autoConnect
  overrideConnection?: boolean
  autonomousReconnection?: boolean
  timeout?: number | null
}
```

**Migration notes:**
- `autoConnect` renamed to `autoSelect`
- `ownerSignature` and `ownerKey` moved to `criteria.network` and `criteria.key`
- `connectAny` removed (inferred from whether `criteria.network` is set)
- `fwVersion` moved to `criteria.fw`
- Connector is now a required first parameter

### `scan()` signature changed

**Old signature (JS Revision 0):**
```typescript
scan(criteria: Criteria, scanPeriod: number): Promise<Criterium[]>
```

**New signature (JS Revision 1):**
```typescript
scan(
  connector: ConnectorType,
  criteria: Criteria,
  options?: ScanOptions
): Promise<Criterium[]>

type ScanOptions = {
  scanPeriod?: number | null
}
```

**Migration notes:**
- Connector is now a required first parameter
- `scanPeriod` moved to options object

### `version()` method added

New method to query the spectoda-js version information:
```typescript
version(): SpectodaVersion
```

---

## JS Revision 0 (Legacy)

The original API before the December 2024 refactor. Remote control receivers running this version
do not have the `version()` method and use the legacy `connect()` and `scan()` signatures.

When `spectoda.version()` is not available, spectoda-core assumes JS Revision 0 and uses
legacy signatures for backward compatibility.

---

## Adding New Revisions

When making significant API changes:

1. Increment `JS_REVISION` in `src/version.ts`
2. If the change affects remote control compatibility, add a new constant like
   `JS_REVISION_NEW_FEATURE_NAME` in `src/version.ts`
3. Update `spectoda-core` to check the revision and use appropriate signatures
4. Document the changes in this file

**Template for new revision:**

```markdown
## JS Revision X (Month Year)

**Breaking Changes:**

### `methodName()` signature changed

**Old signature (JS Revision X-1):**
\`\`\`typescript
// old signature
\`\`\`

**New signature (JS Revision X):**
\`\`\`typescript
// new signature
\`\`\`

**Migration notes:**
- Note 1
- Note 2
```

