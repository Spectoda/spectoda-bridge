import bodyParser from "body-parser";
import express from "express";
import SSE from "express-sse-ts";
import { spectodaDevice } from "./communication";
import cors from "cors";

const jsonParser = bodyParser.json();
const urlencodedParser = bodyParser.urlencoded({ extended: false });

const app: express.Application = express();
const port: number = Number(process.env.PORT) || 8888;

app.use(jsonParser);
app.use(urlencodedParser);
app.use(cors());

export const sse = new SSE();
app.get("/events", sse.init);
spectodaDevice.on("emitted_events", (events: SpectodaEvent[]) => {
  for (const event of events) {
    sse.send(JSON.stringify(event));
  }
});

interface SpectodaEvent {
  id: number | number[];
  label: string;
  value: number | string | null;
  timestamp: number;
  type?: "percentage" | "color" | "timestamp" | "empty";
  forceDelivery?: boolean;
}

app.get("/scan", async (req, res) => {
  // TODO
  // const devices = await spectodaDevice.interface?.scan();
  // res.json(devices);
  res.json("Not implemented");
});

app.post("/connect", async (req, res) => {
  const mac = req.body.mac;

  try {
    const result = await spectodaDevice.connect();
    res.json({ status: "success", result: result });
  } catch (error) {
    res.statusCode = 405;
    return res.json({ status: "error", error: error });
  }
});

app.post("/event", async (req, res) => {
  const event = req.body as SpectodaEvent;

  let result;
  try {
    switch (event.type) {
      case "percentage":
        result = await spectodaDevice.emitPercentageEvent(event.label, event.value as number, event.id, event?.forceDelivery);
        break;
      case "color":
        result = await spectodaDevice.emitColorEvent(event.label, event.value as string, event.id, event?.forceDelivery);
        break;
      case "timestamp":
        result = await spectodaDevice.emitTimestampEvent(event.label, event.value as number, event.id, event?.forceDelivery);
        break;
      default:
        result = await spectodaDevice.emitEvent(event.label, event.id, event?.forceDelivery);
        break;
    }

    return res.json({ status: "success", result: result });
  } catch (error) {
    res.statusCode = 405;
    return res.json({ status: "error", error: error });
  }
});

app.post("/tngl", (req, res) => {
  // TODO: implement, type for write/sync tngl
});

app.get("/tngl-fingerprint", (req, res) => {
  // TODO return finger print of the device
});

app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/`);
});
