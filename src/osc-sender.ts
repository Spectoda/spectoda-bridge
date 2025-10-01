// eslint-disable-next-line @typescript-eslint/no-var-requires
const osc = require("osc");
import { logging } from "./lib/spectoda-js/v012/logging";

// Room ID mappings as defined by the user
const ROOM_ID_MAPPINGS = {
  201: 'A', // ID_MISTNOST_A
  202: 'B', // ID_MISTNOST_B
  203: 'C', // ID_MISTNOST_C
  204: 'D', // ID_MISTNOST_D
  205: 'E', // ID_MISTNOST_E
  206: 'F', // ID_MISTNOST_F
  207: 'G', // ID_MISTNOST_G
  208: 'H', // ID_MISTNOST_H
  209: 'I', // ID_MISTNOST_I
  210: 'J', // ID_MISTNOST_J
  211: 'K', // ID_MISTNOST_K
  212: 'L', // ID_MISTNOST_L
  213: 'M', // ID_MISTNOST_M
} as const;

// Network configuration
const BASE_IP_PREFIX = "192.168.0.";
const START_IP_LAST_OCTET = 44;
const REMOTE_PORT = 8000;
const LOCAL_PORT = 8001;

// Target ID for forwarding events
const TARGET_ID = 255;

class OSCSender {
  private udpPort: any;
  private isReady = false;
  private reopenTimer: any = null;

  constructor() {
    this.initializeUDPPort();
  }

  private initializeUDPPort() {
    this.udpPort = new osc.UDPPort({
      localAddress: "0.0.0.0",
      localPort: LOCAL_PORT
    });

    this.udpPort.on("ready", () => {
      this.isReady = true;
      logging.info("OSC UDP Port ready for sending events");
    });

    this.udpPort.on("error", (err: any) => {
      // Transient send errors (e.g., EHOSTUNREACH) should not disable the port
      logging.error("OSC UDP error:", err);
      // Only schedule reopen on socket-not-running type errors
      if (err && (err.code === "ERR_SOCKET_DGRAM_NOT_RUNNING" || err.code === "EPIPE")) {
        this.scheduleReopen();
      }
    });

    this.udpPort.on("close", () => {
      this.isReady = false;
      logging.warn("OSC UDP Port closed; scheduling reopen");
      this.scheduleReopen();
    });

    this.udpPort.open();
  }

  private scheduleReopen() {
    if (this.reopenTimer) return;
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      try {
        if (this.udpPort) this.udpPort.close();
      } catch {}
      this.initializeUDPPort();
    }, 1000);
  }

  private getRoomLetter(roomId: number): string | null {
    return ROOM_ID_MAPPINGS[roomId as keyof typeof ROOM_ID_MAPPINGS] || null;
  }

  private getRoomIP(roomLetter: string): string {
    const letterCode = roomLetter.charCodeAt(0);
    const index = letterCode - 'A'.charCodeAt(0);
    return BASE_IP_PREFIX + (START_IP_LAST_OCTET + index);
  }

  public sendEventToRoom(event: any, roomLetter: string) {
    if (!this.isReady) {
      logging.warn("OSC UDP Port not ready, skipping event send");
      // Best-effort: attempt to reopen if not already scheduled
      this.scheduleReopen();
      return;
    }

    const roomIP = this.getRoomIP(roomLetter);
    const address = `/room/${roomLetter.toLowerCase()}`;

    // Prepare OSC arguments in the exact order expected by the receiver:
    // adr, label, value, id, vtype
    const args: any[] = [];

    // 1. label (string)
    args.push({
      type: "s",
      value: event.label || ""
    });

    // 2. value (preserve original type)
    if (event.value !== undefined && event.value !== null) {
      if (typeof event.value === 'string') {
        args.push({
          type: "s",
          value: event.value
        });
      } else if (typeof event.value === 'number') {
        // Use integer for whole numbers, float for decimals
        args.push({
          type: Number.isInteger(event.value) ? "i" : "f",
          value: event.value
        });
      } else if (typeof event.value === 'boolean') {
        args.push({
          type: "i",
          value: event.value ? 1 : 0
        });
      } else {
        // For complex values, convert to string
        args.push({
          type: "s",
          value: String(event.value)
        });
      }
    } else {
      // Send null/undefined as empty string
      args.push({
        type: "s",
        value: ""
      });
    }

    // 3. id (integer) - always use TARGET_ID (255)
    args.push({
      type: "i",
      value: TARGET_ID
    });

    // 4. vtype (integer) - event type
    args.push({
      type: "i",
      value: event.type
    });

    // Send the complete event data
    this.udpPort.send(
      {
        address,
        args
      },
      roomIP,
      REMOTE_PORT
    );

    logging.info(`Sent OSC event to room ${roomLetter} at ${roomIP} (${address}):`, {
      label: event.label,
      value: event.value,
      id: event.id,
      type: event.type
    });
  }

  public sendEventToAllRooms(event: any) {
    // Send to all rooms A-M
    const allRoomLetters = Object.values(ROOM_ID_MAPPINGS);
    
    for (const roomLetter of allRoomLetters) {
      logging.info(`Broadcasting event with ID ${event.id} to room ${roomLetter}`);
      this.sendEventToRoom(event, roomLetter);
    }
  }

  public processEvent(event: any) {
    // Check if event has an ID and it's a number
    if (!event.id || typeof event.id !== 'number') {
      return; // Skip events without valid ID
    }

    // Special case: ID 255 broadcasts to all rooms
    if (event.id === TARGET_ID) {
      logging.info(`Processing broadcast event with ID ${event.id} - sending to all rooms`);
      this.sendEventToAllRooms(event);
      return;
    }

    // Check if it's one of our room IDs (201-213)
    const roomLetter = this.getRoomLetter(event.id);
    if (!roomLetter) {
      return; // Skip events that don't match our room IDs
    }

    logging.info(`Processing event with ID ${event.id} for room ${roomLetter}`);
    this.sendEventToRoom(event, roomLetter);
  }

  public close() {
    if (this.udpPort) {
      this.udpPort.close();
      this.isReady = false;
    }
  }
}

// Create singleton instance
export const oscSender = new OSCSender();

// Graceful shutdown
process.on('SIGINT', () => {
  logging.info('Closing OSC sender...');
  oscSender.close();
});

process.on('SIGTERM', () => {
  logging.info('Closing OSC sender...');
  oscSender.close();
});
