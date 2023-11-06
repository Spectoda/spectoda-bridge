// import esPkg from 'essentia.js';
import { Spectoda } from "./lib/spectoda-js/Spectoda";
import { logging } from "./lib/spectoda-js/logging";
import fs from "fs";
import { hexStringToArray, hexStringToUint8Array, sleep } from "./lib/spectoda-js/functions";

const spectodaDevice = new Spectoda("nodeserial", true);

spectodaDevice.setDebugLevel(4);

// spectodaDevice.assignOwnerSignature("a06cd5c4d5741b61fee69422f2590926");
// spectodaDevice.assignOwnerKey("bfd39c89ccc2869f240508e9a0609420");

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

  if (fs.existsSync("assets/config.json")) {

    const config = JSON.parse(fs.readFileSync("assets/config.json", "utf8"));

    /*
    {
      "spectoda": {
          "connect": {
              "connector": "nodeserial",
              "criteria": {
                  "uart": "/dev/ttyS0",
                  "baudrate": 115200
              }
          },
          "network": {
              "signature": "00000000000000000000000000000000",
              "key": "00000000000000000000000000000000"
          },
          "synchronize": {
              "tngl": {
                  "bytecode": "02c2c322bc8813000c8ff",
                  "code": "addDrawing(0s, Infinity, animRainbow(5s, 100%));",
                  "path": "tngl.txt"
              },
              "config": {
                  "json": "{\"DELETE_KEYS\":[\"tohle\", \"tamto\"]}",
                  "path": "config.json"
              },
              "fw": {
                  "path": "0.10.0_20231010.enc"
              }
          }
      }
    }  
    */

    if (config && config.spectoda) {

      if (config.spectoda.synchronize) {

        if (config.spectoda.synchronize.fw) {

          if (config.spectoda.synchronize.fw.path) {

            do {
              const fwFilePath = `assets/${config.spectoda.synchronize.fw.path.trim()}`;
              const controllerFwInfo = await spectodaDevice.getFwVersion().catch(() => {
                return "UNKNOWN_0.0.0_00000000";
              });

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
                logging.info("> FW is up to date.");
                break;
              }

              const filePath = `assets/${fwFilePath.trim()}`;
              if (!fs.existsSync(filePath)) {
                logging.error(`Firmware file not found at: ${filePath}`);
                break;
              }

              const fileData = fs.readFileSync(filePath);
              const uint8Array = new Uint8Array(fileData);

              logging.info("> Updating Network Firmware...")
              try {
              await spectodaDevice.updateNetworkFirmware(uint8Array);
              } catch (error) {
                logging.error(`Error updating firmware: ${error}`);
                break;
              }

              logging.info("> Firmware successfully updated.");
              return; // after update we need to reconnect

            } while (0);           
          }
        }

        if (config.spectoda.synchronize.tngl) {

          let tngl_code = null;
          let tngl_bytecode = null;

          if (config.spectoda.synchronize.tngl.bytecode) {
            tngl_bytecode = hexStringToArray(config.spectoda.synchronize.tngl.bytecode);
          }

          else if (config.spectoda.synchronize.tngl.code) {
            tngl_code = config.spectoda.synchronize.tngl.code;
          }

          else if (config.spectoda.synchronize.tngl.path) {
            const tngl_path = "assets/" + config.spectoda.synchronize.tngl.path;
            if (fs.existsSync(tngl_path)) {
              tngl_code = fs.readFileSync(tngl_path, "utf8").toString();
            } else {
              logging.error("Specified TNGL doesnt exist on path:", tngl_path)
            }
          }

          logging.info("> Sychronizing TNGL code...")
          try {
            await spectodaDevice.syncTngl(tngl_code, tngl_bytecode);
          } catch (error) {
            logging.error(`Error updating TNGL: ${error}`);
          }
        }

        if (config.spectoda.synchronize.config) {

          let config_json = undefined;

          if (config.spectoda.synchronize.config.json) {
            config_json = config.spectoda.synchronize.config.json;
          }

          else if (config.spectoda.synchronize.config.path) {
            if (fs.existsSync(config.spectoda.synchronize.config.path)) {
              config_json = fs.readFileSync(config.spectoda.synchronize.config.path, "utf8").toString();
            }
          }

          // TODO - read controller config and merge with config_json
          logging.warn("Updating controller config is not implemented yet");

          // return; // after update we need to reconnect
        }
      }
    }

  } 
  //
  else /* !fs.existsSync("assets/config.json") */ {

    // upload latest FW
    if (fs.existsSync("assets/fw.txt")) {
      // try {
      do {
        const fwFilePath = fs.readFileSync("assets/fw.txt", "utf8").toString();
        const controllerFwInfo = await spectodaDevice.getFwVersion().catch(() => {
          return "UNKNOWN_0.0.0_00000000";
        });

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
        await spectodaDevice.syncTngl(fs.readFileSync("assets/tngl.txt", "utf8").toString());
      } catch (error) {
        logging.error(`Error updating TNGL: ${error}`);
      }
    }
  }
});

spectodaDevice.on("ota_progress", (percentages: number) => {
  logging.info("OTA progress:", percentages);
});

spectodaDevice.on("ota_status", (status: string) => {
  logging.info("OTA status:", status);
});

export { spectodaDevice };
