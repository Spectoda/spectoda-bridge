import { createNanoEvents } from "./lib/spectoda-js/functions";

const BASE_URL = "http://localhost:8888";

// TODO check performance, if slow switch to using subscription per "event" basis or throtthling
const evs = new EventSource(`${BASE_URL}/events`);

export const spectodaEventSource = createNanoEvents();

evs.onmessage = v => spectodaEventSource.emit("event", JSON.parse(v.data));

interface SpectodaEvent {
  id?: number | number[];
  label: string;
  value: number | string | null;
  timestamp?: number;
  type?: "percentage" | "color" | "timestamp" | "empty";
  forceDelivery?: boolean;
}

export function emitEvent(event: SpectodaEvent) {
  return fetch(`${BASE_URL}/event`, { method: "POST", body: JSON.stringify(event), headers: { "Content-Type": "application/json" } }).then(v => v.json());
}

interface ConnectionParams {
  key: string;
  signature: string;
}

export function connect(params: ConnectionParams) {
  return fetch(`${BASE_URL}/connect`, { method: "POST", body: JSON.stringify(params), headers: { "Content-Type": "application/json" } }).then(v => v.json());
}
