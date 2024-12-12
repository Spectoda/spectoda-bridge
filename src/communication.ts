// import esPkg from 'essentia.js';
import { Spectoda } from "./lib/spectoda-js/Spectoda";
import { logging } from "./lib/spectoda-js/logging";
import fs from "fs";
import { hexStringToArray, hexStringToUint8Array, sleep } from "./lib/spectoda-js/functions";

const spectoda = new Spectoda("dummy", true);

// spectoda.setDebugLevel(4);

// spectoda.assignOwnerSignature("a06cd5c4d5741b61fee69422f2590926");
// spectoda.assignOwnerKey("bfd39c89ccc2869f240508e9a0609420");

// spectoda.assignConnector("dummy");
// if (typeof window !== "undefined") {
//   spectoda.assignOwnerSignature(localStorage.getItem("ownerSignature") || "a06cd5c4d5741b61fee69422f2590926");
//   spectoda.assignOwnerKey(localStorage.getItem("ownerKey") || "bfd39c89ccc2869f240508e9a0609420");

//   // @ts-ignore
//   window.spectoda = spectoda;
//   process.env.NODE_ENV === "development" && setLoggingLevel(4);

//   const url = new URL(location.href);
//   const params = new URLSearchParams(url.search);

//   if (params.get("demo")) {
//     setTimeout(() => {
//       spectoda.assignConnector("dummy");
//     }, 300);
//   }
// }

// @ts-ignore
globalThis.spectoda = spectoda;

let force_tngl_update_finished = false;
let force_fw_update_finished = false;

const config = JSON.parse(fs.readFileSync("assets/config.json", "utf8"));

spectoda.on("connected", async () => {
  logging.info(">> Reading Config...");

  await sleep(1000);

  if (fs.existsSync("assets/config.json")) {

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

          // reset force_fw_update_finished if someone changes the force fw config attribute during the run of the service
          if (!config.spectoda.synchronize.fw.force) {
            force_fw_update_finished = false;
          }

          if (config.spectoda.synchronize.fw.path) {

            const do_fw_update = async function () {
              const fwFileName = `${config.spectoda.synchronize.fw.path.trim()}`;
              const controllerFwInfo = await spectoda.getFwVersion().catch(() => {
                return "UNKNOWN_0.0.0_00000000";
              });

              const fwFileMatch = fwFileName.match(/(\d+\.\d+\.\d+)_(\d+)/);

              if (!fwFileMatch) {
                logging.error("Invalid firmware file format in fw.txt.");
                return false;
              }

              const controllerFwMatch = controllerFwInfo.match(/(\d+\.\d+\.\d+)_(\d+)/);

              if (!controllerFwMatch) {
                logging.error("Invalid firmware version format from spectoda.");
                return false;
              }

              const fwFileVersionDate = parseInt(fwFileMatch[2], 10);
              const controllerFwVersionDate = parseInt(controllerFwMatch[2], 10);

              if (controllerFwVersionDate >= fwFileVersionDate) {
                logging.info(">> FW is up to date.");

                if (config.spectoda.synchronize.fw.force && !force_fw_update_finished) {
                  logging.info(">> Forcing FW Update.");
                } else {
                  return false;
                }
              }

              const filePath = `assets/${fwFileName.trim()}`;
              if (!fs.existsSync(filePath)) {
                logging.error(`Firmware file not found at: ${filePath}`);
                return false;
              }

              const fileData = fs.readFileSync(filePath);
              const uint8Array = new Uint8Array(fileData);

              logging.info(">> Updating Network Firmware...")
              logging.info(await spectoda.getConnectedPeersInfo())
              try {
                await spectoda.updateNetworkFirmware(uint8Array);
                logging.info(">> Firmware successfully updated.");
                if (config.spectoda.synchronize.fw.force) {
                  force_fw_update_finished = true;
                }
                return true; // after update we need to reconnect
              } catch (error) {
                logging.error(`Error updating firmware: ${error}`);
                return false;
              }
            }

            if (await do_fw_update()) {
              // controller reboots after sucessfull update
              return;
            }
          }
        }

        if (config.spectoda.synchronize.tngl) {

          // reset force_fw_update_finished if someone changes the force fw config attribute during the run of the service
          if (!config.spectoda.synchronize.tngl.force && !force_tngl_update_finished) {
            force_tngl_update_finished = false;
          }

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

          if (config.spectoda.synchronize.tngl.force) {
            if(!force_tngl_update_finished) {
              logging.info(">> Writing TNGL code...")
              try {
                await spectoda.writeTngl(tngl_code, tngl_bytecode);
                force_tngl_update_finished = true;
              } catch (error) {
                logging.error(`Error writing TNGL: ${error}`);
              }
            } else {
              logging.info(">> TNGL code was already written")
            }
          } 
          
          else /* if (!config.spectoda.synchronize.tngl.force) */ {
            logging.info(">> Sychronizing TNGL code...")
            try {
              await spectoda.syncTngl(tngl_code, tngl_bytecode);
            } catch (error) {
              logging.error(`Error synchronizing TNGL: ${error}`);
            }
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
        const fwFileName = fs.readFileSync("assets/fw.txt", "utf8").toString();
        const controllerFwInfo = await spectoda.getFwVersion().catch(() => {
          return "UNKNOWN_0.0.0_00000000";
        });

        const fwFileMatch = fwFileName.match(/(\d+\.\d+\.\d+)_(\d+)/);

        if (!fwFileMatch) {
          logging.error("Invalid firmware file format in fw.txt.");
          break;
        }

        const controllerFwMatch = controllerFwInfo.match(/(\d+\.\d+\.\d+)_(\d+)/);

        if (!controllerFwMatch) {
          logging.error("Invalid firmware version format from spectoda.");
          break;
        }

        const fwFileVersionDate = parseInt(fwFileMatch[2], 10);
        const controllerFwVersionDate = parseInt(controllerFwMatch[2], 10);

        if (controllerFwVersionDate >= fwFileVersionDate) {
          logging.info("FW is up to date.");
          break;
        }

        const filePath = `assets/${fwFileName.trim()}`;
        if (!fs.existsSync(filePath)) {
          logging.error(`Firmware file not found at: ${filePath}`);
          break;
        }

        const fileData = fs.readFileSync(filePath);
        const uint8Array = new Uint8Array(fileData);
        await spectoda.updateNetworkFirmware(uint8Array);

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
        await spectoda.syncTngl(fs.readFileSync("assets/tngl.txt", "utf8").toString());
      } catch (error) {
        logging.error(`Error updating TNGL: ${error}`);
      }
    }
  }
});

spectoda.on("ota_progress", (percentages: number) => {
  console.log("OTA progress:", percentages);
});

spectoda.on("ota_status", (status: string) => {
  console.log("OTA status:", status);
});

export { spectoda };
