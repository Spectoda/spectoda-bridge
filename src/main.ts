import { createBluetooth } from "node-ble";
import { spectodaDevice } from "./communication";
import { Module } from "./wasmload";

async function main() {
  // NODE BLE and even Noble library seems to not work on MAC OS (i will try it on RPI or Windows machine)

  // const { bluetooth, destroy } = createBluetooth();
  spectodaDevice.assignConnector("dummy");
  console.log(await spectodaDevice.connected());

  console.log(await spectodaDevice.connect());

  console.log(await spectodaDevice.connected());

  setInterval(() => {
    spectodaDevice.emitPercentageEvent("test", Math.random() * 200 - 100);
  }, 5000);

  // THIS WILL log emitted events from spectoda device. This way we will see if we got it right
  spectodaDevice.on("emitted_events", (events: any) => {
    console.log("emitted_events", events);
  });

  Module;

  // const adapter = await bluetooth.defaultAdapter();
  // console.log(adapter);
}

main();
