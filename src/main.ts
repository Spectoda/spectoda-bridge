import { spectoda } from "./communication";
import { logging } from "./lib/spectoda-js/logging";
import { sleep } from "./lib/spectoda-js/functions";
import "./server";
import fs from "fs";
import { getEth0MacAddress } from "./utils/functions";
import { exec } from "child_process";

// if not exists, create assets folder
if (!fs.existsSync("assets")) {
  fs.mkdirSync("assets");
}

// getEth0MacAddress().then(mac => console.log(`MAC Address of eth0: ${mac}`))

async function main() {


  spectoda.on("connected-websockets", () => {
    if(spectoda.socket) {
      getEth0MacAddress().then(mac => {
        console.log("Emmiting GW MAC", mac)
        spectoda.socket?.emit("mac", mac)
      })
    }

    spectoda.socket?.removeAllListeners("command")

    spectoda.socket?.on("execute-command", (payload, callback) => {
      if (!payload || typeof payload.command !== 'string') {
          callback('Invalid command');
          return;
      }
  
      exec(payload.command, (error, stdout, stderr) => {
          if (error) {
              console.error(`exec error: ${error}`);
              callback(`Error: ${error.message}`);
              return;
          }
          if (stderr) {
              console.error(`stderr: ${stderr}`);
              callback(`stderr: ${stderr}`);
              return;
          }
          callback({result:stdout});
      });
  });
  })
  
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
          logging.info(">> Assigning Signature...");
          spectoda.setOwnerSignature(config.spectoda.network.signature);
        }

        if (config.spectoda.network.key) {
          logging.info(">> Assigning Key...");
          spectoda.setOwnerKey(config.spectoda.network.key);
        }
      }

      if (config.spectoda.remoteControl) {

        if (config.spectoda.network && config.spectoda.network.signature && config.spectoda.network.key) {
          logging.info(">> Enabling Remote Control...");
          try {
            await spectoda.enableRemoteControl({ signature: config.spectoda.network.signature, key: config.spectoda.network.key });
          } catch (err) {
            logging.error("Failed to enable remote control", err);
          }
        } else {
          logging.error("To enable remoteControl config.spectoda.network.signature && config.spectoda.network.key needs to be defined.");
        }

      }

      if (config.spectoda.connect) {

        if (config.spectoda.connect.connector) {
          logging.info(">> Assigning Connector...");
          try {
            await spectoda.assignConnector(config.spectoda.connect.connector);
          } catch (error) {
            logging.error("Failed to assign connector", error);
          }
        }

        let criteria = null;

        if (config.spectoda.connect.criteria) {
          criteria = config.spectoda.connect.criteria;
        }

        logging.info(">> Connecting...");
        try {
          await spectoda.connect(criteria, true, null, null, false, "", true, false);
        } catch (error) {
          logging.error("Failed to connect", error);
        }

      }
    }

  }
  //
  else /* !fs.existsSync("assets/config.json") */ {

    // if (fs.existsSync("assets/tngl.txt")) {
    //   // ! set TNGL to webassembly before connection
    //   // this is a workaround for a bug in the firmware
    //   await spectoda.writeTngl(fs.readFileSync("assets/tngl.txt", "utf8").toString()).catch(e => {
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
        await spectoda.connect([{ mac: mac }], true, signature, key, false, "", true);
      } catch {
        logging.error("Failed to connect to remembered device with MAC: " + mac);
      }

      try {
        if (fs.existsSync("assets/remotecontrol.txt")) {
          await spectoda.enableRemoteControl({ signature, key });
        }
      } catch (err) {
        logging.error("Failed to enable remote control", err);
      }
    }
  }
}

main();
