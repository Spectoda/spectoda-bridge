# Introduction

Controllers are physical devices that you can connect with a Spectoda.js instance. They always belong in a network, which is identified with:

- A `signature` (deprecated terminology "ownerSignature")
- A `key` (deprecated terminology "ownerKey") - this is a secret value

Each controller has a unique MAC address, which is used to identify it in the network. Everyone in the network is called a node - whether it is a physical controller or a virtual controller.

# Controller Synchronization

When multiple controllers have the same signature + key, they belong to the same network. If controllers have the same FW version + are in the same network, they will synchronize:

- TNGL code
- Event history
- Timeline

---

# Getting started

```ts
const spectoda = new Spectoda()
spectoda.connect()
```

---

# No Network Mode

When a controller is not in a network, it enters a mode where anyone can connect to it and move it to their own network. This is similar to a "pairing mode" in Bluetooth, though in Spectoda this is NOT called pairing. Controllers in no network have signature `00000000000000000000000000000000` (defined as [`NO_NETWORK_SIGNATURE`](./src/constants/index.ts) constant) and key `00000000000000000000000000000000` (defined as [`NO_NETWORK_KEY`](./src/constants/index.ts) constant).

# Connection Types

Spectoda supports multiple connection types (defined as [`CONNECTORS`](./src/constants/index.ts)):

- `bluetooth` - Bluetooth connection
- `websockets` - WebSocket connection
- `serial` - Serial port connection
- `simulated` - Simulated connection for testing
- `dummy` - Dummy connection for testing
- `none` - No connection
- `default` - Default connection type

# Value Types

Spectoda supports various value types for communication (defined in [`VALUE_TYPE`](./src/constants/index.ts)):

- `NUMBER` - Numeric values
- `LABEL` - Label values (max 5 characters)
- `TIME` - Time values
- `PERCENTAGE` - Percentage values
- `DATE` - Date values
- `COLOR` - Color values
- `PIXELS` - Pixel values
- `BOOLEAN` - Boolean values
- `NULL` - Null values
- `UNDEFINED` - Undefined values

# Labels

A "label" is a specific type that:

- Can have max 5 characters [a-zA-Z0-9_]
- Is always prefixed with "$" (e.g. $label)
- Is internally converted to bytes using `labelToBytes()` function

# Refactoring Suggestions

> Proposed by @mchlkucera

- All asynchronous getting should be `readResource`
- All synchronous getting should be `getResource`
- All asynchronous setting should be `writeResource`
- All synchronous setting should be `setResource`
- Spectoda.js should focus only on firmware communication
  - Flutter-specific functions should be separated (e.g. hideHomeButton)
  - Client-specific functions should be separated (e.g. reload)
  - Additional refactoring suggestions are available in the `0.13-dev` branch

# About the internal workings

### Interface

The Interface is a Controller data processor that:

- Manages connections with other controllers
- Handles packet encryption/decryption
- Maintains clock synchronization
- Processes messages using timestamps for encryption

#### Core Methods

```typescript
interface.execute(command, grouping, timeout, ttl)
// Handles queued execute commands
// Merges commands with same grouping (spam protection)
// Forwards merged commands to connected interfaces via sendExecute()

interface.request(command, timeout)
// Handles queued request commands
// Processes commands one by one at the interface
```

#### Communication Methods

```typescript
// Network-wide commands with synchronization guarantee mechanism (SGM)
sendExecute(payload, size, timeout, ttl)
// Broadcasts to all controllers (delivery not guaranteed)

// Controller-specific commands using acknowledgment-based delivery
sendRequest(payload, size, timeout)
// Targets specific interface, can chain via MAC addresses
// Can recursively request across all detected interfaces
```

#### Connection Examples

```typescript
// Create Spectoda instance with virtual MAC address
let spectoda = new Spectoda()

// Connection methods
let connection1 = spectoda.connect() // default
let connection2 = spectoda.connect.webbluetooth() // Bluetooth
let connection3 = spectoda.connect.webserial() // Serial

connection1.disconnect()
```

Note: Connections are managed through Connectors (like SCBLE and WEBUSB) which provide access to other Interfaces.

## Errors

Handle real-time error updates from controllers with listeners for errors and warnings:

```typescript
spectoda.on(
  SPECTODA_APP_EVENTS.NETWORK_ERROR,
  ({ controller, errors }: ControllerError) => {
    console.log(
      `Errors from Controller ${controller.label} (${controller.mac}):`,
    )

    for (const { description, code } of errors) {
      console.log(`❌ [Error ${code}] - ${description}`)
    }
  },
)

spectoda.on(
  SPECTODA_APP_EVENTS.NETWORK_WARNING,
  ({ controller, warnings }: ControllerWarning) => {
    console.log(
      `Warnings from Controller ${controller.label} (${controller.mac}):`,
    )

    for (const { description, code } of warnings) {
      console.warn(`⚠️ [Warning ${code}] - ${description}`)
    }
  },
)
```

Get errors and warnings from controllers:

```typescript
const errors: SpectodaError[] = await spectoda.readErrors()
const warnings: SpectodaWarning[] = await spectoda.readWarnings()
```
