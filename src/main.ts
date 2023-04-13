import { spectodaDevice } from "./communication";
import { logging } from "./lib/spectoda-js/Logging";
import "./server";
import fs from "fs";

async function main() {
  if (fs.existsSync("mac.txt")) {
    const mac = fs.readFileSync("mac.txt").toString();
    logging.info("Connecting to remembered device with MAC: " + mac);

    // @ts-ignore
    await spectodaDevice.connect([{ mac: mac }]);
  }
}

main();
