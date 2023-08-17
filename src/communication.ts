// import esPkg from 'essentia.js';
import { Spectoda } from "./lib/spectoda-js/Spectoda";
import { logging } from "./lib/spectoda-js/logging";
import fs from "fs";
import { sleep } from "./lib/spectoda-js/functions";

 const spectodaDevice = new Spectoda("nodebluetooth", true);
//const spectodaDevice = new Spectoda("dummy", true);

spectodaDevice.setDebugLevel(3);

spectodaDevice.assignOwnerSignature("a06cd5c4d5741b61fee69422f2590926");
spectodaDevice.assignOwnerKey("bfd39c89ccc2869f240508e9a0609420");

// spectodaDevice.assignConnector("dummy");
// if (typeof window !== "undefined") {
//   spectodaDevice.assignOwnerSignature(localStorage.getItem("ownerSignature") || "a06cd5c4d5741b61fee69422f2590926");
//   spectodaDevice.assignOwnerKey(localStorage.getItem("ownerKey") || "bfd39c89ccc2869f240508e9a0609420");

//   // @ts-ignore
//   window.spectodaDevice = spectodaDevice;
//   process.env.NODE_ENV === "development" && setLoggingLevel(4);

//   const url = new URL(location.href);
//   const params = new URLSearchParams(url.search);

//   if (params.get("demo")) {
//     setTimeout(() => {
//       spectodaDevice.assignConnector("dummy");
//     }, 300);
//   }
// }

// @ts-ignore
globalThis.spectodaDevice = spectodaDevice;

spectodaDevice.on("connected", async () => {
  
  logging.info("> Checking for updates...");

  await sleep(1000);

  // upload latest FW
  if (fs.existsSync("assets/fw.txt")) {
    // try {
      do {
        const fwFilePath = fs.readFileSync("assets/fw.txt", "utf8");
        const controllerFwInfo = await spectodaDevice.getFwVersion().catch(() => { return "UNKNOWN_0.0.0_00000000" });

        const fwFileMatch = fwFilePath.match(/(\d+\.\d+\.\d+)_(\d+)/);

        if (!fwFileMatch) {
          logging.error("Invalid firmware file format in fw.txt.");
          break;
        }

        const controllerFwMatch = controllerFwInfo.match(/(\d+\.\d+\.\d+)_(\d+)/);

        if (!controllerFwMatch) {
          logging.error("Invalid firmware version format from spectodaDevice.");
          break;
        }

        const fwFileVersionDate = parseInt(fwFileMatch[2], 10);
        const controllerFwVersionDate = parseInt(controllerFwMatch[2], 10);

        if (controllerFwVersionDate >= fwFileVersionDate) {
          logging.info("FW is up to date.");
          break;
        }

        const filePath = `assets/${fwFilePath.trim()}`;
        if (!fs.existsSync(filePath)) {
          logging.error(`Firmware file not found at: ${filePath}`);
          break;
        }

        const fileData = fs.readFileSync(filePath);
        const uint8Array = new Uint8Array(fileData);
        await spectodaDevice.updateNetworkFirmware(uint8Array);

        logging.info("Firmware successfully updated.");
        return;

      } while (0);
    // } catch (error) {
    //   logging.error(`Error updating firmware: ${error}`);

    // }
  }

  if (fs.existsSync("assets/tngl.txt")) {
    // upload latest TNGL
    try {
      // await spectodaDevice.syncTngl(fs.readFileSync("assets/tngl.txt", "utf8").toString());
      await spectodaDevice.writeTngl(fs.readFileSync("assets/tngl.txt", "utf8").toString()); // ! for now to put tngl into webassembly
      await spectodaDevice.readEventHistory();
    } catch (error) {
      logging.error(`Error updating TNGL: ${error}`);
    }
  }

  // // emit event that indicates the orange pi is connected
  // await spectodaDevice.emitEvent("READY");
})

spectodaDevice.on("ota_progress", (percentages: number) => {
  logging.info("OTA progress", percentages);
})

spectodaDevice.on("ota_status", (status: string) => {
  logging.info("OTA status", status);
})

export { spectodaDevice };
