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
           },
           "remoteControl": {
               "enabled": true
           }
       }
     }
     */

    if (config && config.spectoda) {

      if (config.spectoda.network) {

        if (config.spectoda.network.signature) {
          logging.info("> Assigning Signature...");
          spectodaDevice.setOwnerSignature(config.spectoda.network.signature);
        }

        if (config.spectoda.network.key) {
          logging.info("> Assigning Key...");
          spectodaDevice.setOwnerKey(config.spectoda.network.key);
        }
      }

      if (config.spectoda.connect) {

        if (config.spectoda.connect.connector) {
          spectodaDevice.assignConnector(config.spectoda.connect.connector);
        }

        let criteria = null;

        if (config.spectoda.connect.criteria) {
          criteria = config.spectoda.connect.criteria;
        }

        try {
          await spectodaDevice.connect(criteria, true, null, null, false, "", true, false);
        } catch {
          logging.error("Failed to connect");
        }

      }

      if (config.spectoda.remoteControl) {
        
        if (config.spectoda.remoteControl.enabled) {
          try {
            await spectodaDevice.enableRemoteControl({ signature: spectodaDevice.getOwnerSignature(), key: spectodaDevice.getOwnerKey() });
          } catch (err) {
            logging.error("Failed to enable remote control", err);
          }
        }
        
      }


    }

  }
  //
  else /* !fs.existsSync("assets/config.json") */ {

    // if (fs.existsSync("assets/tngl.txt")) {
    //   // ! set TNGL to webassembly before connection
    //   // this is a workaround for a bug in the firmware
    //   await spectodaDevice.writeTngl(fs.readFileSync("assets/tngl.txt", "utf8").toString()).catch(e => {
    //     console.log(e);
    //   });
    // }

    if (fs.existsSync("assets/mac.txt")) {
      const mac = fs.readFileSync("assets/mac.txt").toString();
      logging.info("Connecting to remembered device with MAC: " + mac);

      const signature = fs.readFileSync("assets/ownersignature.txt").toString();
      const key = fs.readFileSync("assets/ownerkey.txt").toString();

      try {
        // @ts-ignore
        await spectodaDevice.connect([{ mac: mac }], true, signature, key, false, "", true);
      } catch {
        logging.error("Failed to connect to remembered device with MAC: " + mac);
      }

      try {
        if (fs.existsSync("assets/remotecontrol.txt")) {
          await spectodaDevice.enableRemoteControl({ signature, key });
        }
      } catch (err) {
        logging.error("Failed to enable remote control", err);
      }
    }
  }
}

main();
