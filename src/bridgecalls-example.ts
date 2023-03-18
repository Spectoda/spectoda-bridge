const BASE_URL = "http://localhost:8888";

// TODO check performance, if slow switch to using subscription per "event" basis or throtthling
export const evs = new EventSource(`${BASE_URL}/events`);
evs.onmessage = v => console.log("Event", JSON.parse(v.data));

interface SpectodaEvent {
  id: number | number[];
  label: string;
  value: number | string | null;
  timestamp: number;
  type?: "percentage" | "color" | "timestamp" | "empty";
  forceDelivery?: boolean;
}

export function emitEvent(event: SpectodaEvent) {
  return fetch(`${BASE_URL}/events`, { method: "POST", body: JSON.stringify(event), headers: { "Content-Type": "application/json" } }).then(v => v.json());
}
