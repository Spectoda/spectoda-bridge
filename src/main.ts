import { spectodaDevice } from "./communication";
import { logging } from "./lib/spectoda-js/logging";
import { sleep } from "./lib/spectoda-js/functions";
import "./server";
import fs from "fs";

// if not exists, create assets folder
if (!fs.existsSync("assets")) {
  fs.mkdirSync("assets");
}

async function main() {
  await sleep(1000);

  if (fs.existsSync("assets/tngl.txt")) {
    // ! set TNGL to webassembly before connection
    // this is a workaround for a bug in the firmware
    await spectodaDevice.writeTngl(fs.readFileSync("assets/tngl.txt", "utf8").toString()).catch((e) => { console.log(e); });
  }

  if (fs.existsSync("assets/mac.txt")) {
    const mac = fs.readFileSync("assets/mac.txt").toString();
    logging.info("Connecting to remembered device with MAC: " + mac);

    try {
      // @ts-ignore
      await spectodaDevice.connect([{ mac: mac }], true, null, null, false, "", true);
    } catch {
      logging.error("Failed to connect to remembered device with MAC: " + mac);
    }
  }
}

main();
