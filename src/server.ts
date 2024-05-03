import bodyParser from "body-parser";
import express from "express";
import { spectoda } from "./communication";
import cors from "cors";
import SSE from "express-sse-ts";
import fs from "fs";

const jsonParser = bodyParser.json();
const urlencodedParser = bodyParser.urlencoded({ extended: false });

const app: express.Application = express();
const port: number = Number(process.env.PORT) || 8888;

let connecting = false;
let fwUploading = false;

app.use(jsonParser);
app.use(urlencodedParser);
app.use(cors());
app.use(express.text());

export const sselocalevents = new SSE();
export const sseglobalevents = new SSE();
export const sseota = new SSE();

fs.writeFileSync("assets/lastboot.txt", new Date().toISOString());

export const ssepeers = new SSE();

app.get("/peers", ssepeers.init);
spectoda.on("peer_connected", (peer: any) => {
  ssepeers.send(JSON.stringify({ mac: peer, type: "peer_connected" }));
});
spectoda.on("peer_disconnected", (peer: any) => {
  ssepeers.send(JSON.stringify({ mac: peer, type: "peer_disconnected" }));
});

app.get("/peers-info", (req, res) => {
  spectoda
    .getConnectedPeersInfo()
    .then((peers: any) => {
      res.json({ status: "success", data: peers });
    })
    .catch((error: any) => {
      res.statusCode = 400;
      res.json({ status: "error", error });
    });
});

app.get("/events", sseglobalevents.init);
spectoda.on("emitted_events", (events: SpectodaEvent[]) => {
  for (const event of events) {
    sseglobalevents.send(JSON.stringify(event));
  }
});

app.get("/local-events", sselocalevents.init);
spectoda.on("emitted_local_events", (events: SpectodaEvent[]) => {
  for (const event of events) {
    sselocalevents.send(JSON.stringify(event));
  }
});

app.get("/events-info", async (req, res) => {
  // TODO, do not just emit events, but instead return them
  const result = await spectoda
    .readEventHistory()
    .then((events: any) => {})
    .catch((error: any) => {
      res.statusCode = 400;
      res.json({ status: "error", error });
    });

  res.json({ status: "success", data: result });
});

export const sseconnection = new SSE();
app.get("/connection", sseconnection.init);

let shouldSendDisconnected = true;

spectoda.on("connected", (event: any) => {
  sseconnection.send("connected");
  shouldSendDisconnected = true;
});

spectoda.on("disconnected", (event: any) => {
  if (shouldSendDisconnected) {
    sseconnection.send("disconnected");
    shouldSendDisconnected = false;
  }
});

app.get("/ota-progress", sseota.init);
spectoda.on("ota_progress", (progress: any) => {
  sseota.send(JSON.stringify(progress));
});

interface SpectodaEvent {
  label: string;
  value?: number | string | null;
  type?: "percentage" | "color" | "timestamp" | "undefined";
  destination?: number | number[];
}

app.get("/scan", async (req, res) => {
  // TODO
  // const devices = await spectoda.interface?.scan();
  // res.json(devices);
  return res.json({ status: "error", error: "NotImplemented" });
});

app.post("/connect", async (req, res) => {
  const { key, signature, mac, name, remember, network, remotecontrol } = req.body as { signature?: string; key?: string; mac?: string; name?: string; remember?: boolean; network?: string; remotecontrol?: boolean };

  if (connecting) {
    res.statusCode = 405;
    return res.json({ status: "error", error: "ConnectingInProgress" });
  }

  remember && signature && fs.writeFileSync("assets/ownersignature.txt", signature);
  remember && key && fs.writeFileSync("assets/ownerkey.txt", key);
  remember && network && fs.writeFileSync("assets/network.txt", network);
  remember && remotecontrol && fs.writeFileSync("assets/remotecontrol.txt", remotecontrol.toString());
  if (!remotecontrol) {
    fs.rmSync("assets/remotecontrol.txt", { force: true });
  }

  if (remotecontrol) {
    spectoda.enableRemoteControl({
      signature,
      key,
      sessionOnly: false,
    });
  } else {
    spectoda.disableRemoteControl();
  }

  connecting = true;

  try {
    if (mac) {
      //@ts-ignore
      const result = await spectoda.connect([{ mac: mac }], true, signature, key, false, "", true, true);
      remember && fs.writeFileSync("assets/mac.txt", mac);
      return res.json({ status: "success", result: result });
    }

    if (name) {
      const controllers = await spectoda.scan([{ name: name }]);
      controllers.length != 0 && controllers[0].mac && remember && fs.writeFileSync("assets/mac.txt", controllers[0].mac);
      const result = await spectoda.connect(controllers, true, signature, key, false, "", true, true);
      return res.json({ status: "success", result: result });
    }

    const controllers = await spectoda.scan([{}]);
    controllers.length != 0 && controllers[0].mac && remember && fs.writeFileSync("assets/mac.txt", controllers[0].mac);

    const result = await spectoda.connect(controllers, true, signature, key, false, "", true, true);

    return res.json({ status: "success", result: result });
  } catch (error) {
    if (error === "ScanFailed") {
      // restart node in 10 ms
      setTimeout(() => {
        process.exit(1);
      }, 10);
    }

    res.statusCode = 405;
    return res.json({ status: "error", error: error });
  } finally {
    connecting = false;
  }
});

app.post("/disconnect", async (req, res) => {
  try {
    const result = await spectoda.disconnect();
    return res.json({ status: "success", result: result });
  } catch (error) {
    res.statusCode = 405;
    return res.json({ status: "error", error: error });
  }
});

app.post("/event", async (req, res) => {
  const event = req.body as SpectodaEvent;

  try {
    if (event.label === undefined || event.label === null) {
      res.statusCode = 400;
      return res.json({ status: "error", result: "NoEventLabelSpecified" });
    }

    if (event.value === undefined || event.value === null) {
      const result = await spectoda.emitEvent(event.label, event.destination);
      return res.json({ status: "success", result: result });
    }

    switch (event.type) {
      case "percentage": {
        const result = await spectoda.emitPercentageEvent(event.label, event.value as number, event.destination);
        return res.json({ status: "success", result: result });
      }
      case "color": {
        const result = await spectoda.emitColorEvent(event.label, event.value as string, event.destination);
        return res.json({ status: "success", result: result });
      }
      case "timestamp": {
        const result = await spectoda.emitTimestampEvent(event.label, event.value as number, event.destination);
        return res.json({ status: "success", result: result });
      }
      default: {
        const result = await spectoda.emitEvent(event.label, event.destination);
        return res.json({ status: "success", result: result });
      }
    }
  } catch (error) {
    res.statusCode = 405;
    return res.json({ status: "error", error: error });
  }
});

app.post("/write-tngl", async (req, res) => {
  // TODO: implement, type for write/sync tngl
  const tngl = req.body;

  // create tngl.txt in assets
  fs.writeFileSync("assets/tngl.txt", tngl);

  // await spectoda.eraseEventHistory();
  // const result = await spectoda.writeTngl(fs.readFileSync("assets/tngl.txt", "utf8").toString()); // ! for now to put tngl into webassembly
  // await spectoda.syncEventHistory();

  return res.json({ status: "success", result: "Dont forget to restart spectoda-node for the TNGL to be written" });
});

app.get("/tngl-fingerprint", (req, res) => {
  // TODO return finger print of the device
  res.statusCode = 501;
  return res.json({ status: "error", error: "NotImplemented" });
});

app.get("/emit-history", (req, res) => {
  // ! syncEventHistory does not do this anymore
  // spectoda
  //   .syncEventHistory()
  //   .then(() => {
  //     return res.json({ status: "success", result: "success" });
  //   })
  //   .catch(error => {
  //     res.statusCode = 400;
  //     return res.json({ status: "error", error: error });
  //   });

  return res.json({ status: "error", error: "NotImplemented" });
});

app.post("/notifier", async (req, res) => {
  const { message } = req.body as { message: string };

  try {
    let parsed: { [key: string]: string } = {};
    message.split(" ").forEach(c => {
      const [key, value] = c.split("=");
      if (key && value) {
        parsed[key.toLowerCase()] = value;
      }
    });

    // console.log(parsed);

    const label = parsed["label"] ?? undefined;
    const value = parsed["value"] ?? undefined;
    const type = parsed["type"] ?? undefined;

    if (label === undefined || label === null) {
      res.statusCode = 400;
      return res.json({ status: "error", result: "NoEventLabelSpecified" });
    }

    if (value === undefined || value === null) {
      const result = await spectoda.emitEvent(label);
      return res.json({ status: "success", result: result });
    }

    if (label) {
      switch (type) {
        case "percentage": {
          const result = await spectoda.emitPercentageEvent(label, Number(value));
          return res.json({ status: "success", result: result });
        }
        case "color": {
          const result = await spectoda.emitColorEvent(label, value as string);
          return res.json({ status: "success", result: result });
        }
        case "timestamp": {
          const result = await spectoda.emitTimestampEvent(label, Number(value));
          return res.json({ status: "success", result: result });
        }
        default: {
          const result = await spectoda.emitEvent(label);
          return res.json({ status: "success", result: result });
        }
      }
      const result = await spectoda.emitEvent(label.substring(0, 5), 255);
      return res.json({ status: "success", result: result });
    }
  } catch (error) {
    res.statusCode = 405;
    return res.json({ status: "error", error: error });
  }
});

app.post("/upload-fw", async (req, res) => {
  if (fwUploading) {
    res.statusCode = 405;
    return res.json({ status: "error", error: "AlreadingUploadingFW" });
  }

  fwUploading = true;

  try {
    const filePath = "/home/pi/spectoda/fw.enc";
    const fileData = fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(fileData);
    const result = await spectoda.updateDeviceFirmware(uint8Array);
    return res.json({ status: "success", result: result });
  } catch (error) {
    res.statusCode = 405;
    return res.json({ status: "error", error: error });
  } finally {
    fwUploading = false;
  }
});

app.get("/", (req, res) => {
  res.redirect("/control");
});

app.get("/assets/control", (req, res) => {
  res.redirect("/control");
});

app.get("/owner", (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync("assets/config.json", "utf8"));

    res.json({ ownerSignature: config?.spectoda?.network?.signature, ownerKey: config?.spectoda?.network?.key, network: config?.spectoda?.network?.name });
  } catch (error) {
    res.json({ error });
  }
});

app.get("/variable", async (req, res) => {
  const name = req.query.name;
  const segId = req.query.seg_id;

  if (!name || !segId) {
    res.status(400).json({ error: "Both 'name' and 'seg_id' parameters are required" });
    return;
  }

  // TODO pridat error handling apod
  try {
    const value = await spectoda.readVariable(name, segId);
    res.json(value);
  } catch (error) {
    res.status(404).json({ error: "Variable or segment not found" });
  }
});

app.post("/variables", async (req, res) => {
  const variables = req.body.variables;

  let results = [];

  try {
    for (const { name, segId } of variables) {
      if (!name || !segId) {
        res.status(400).json({ error: "Both 'name' and 'segId' parameters are required" });
        return;
      }

      try {
        const value = await spectoda.readVariable(name, segId);
        results.push({ name, segId, value });
      } catch (error) {
        results.push({ name, segId, value: null, error });
        console.warn(name, segId, error);
        continue;
      }
    }

    res.json({ data: results });
  } catch (error) {
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/restart", async (req, res) => {
  console.error("Restarting spectoda-node. Reason:", req?.query?.reason);

  res.json({ status: "success", message: "Restarting spectoda-node" });

  setTimeout(() => {
    process.exit(1);
  }, 1);
});

app.use("/control", express.static("assets/control"));

//An error handling middleware
// @ts-ignore
app.use(function (err, req, res, next) {
  res.status(500);
  res.send("Oops, something went wrong.");
});

app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/`);
});
