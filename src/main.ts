import { createBluetooth } from "node-ble";
import { spectodaDevice } from "./communication";
import { Module } from "./wasmload";

async function main() {
  // NODE BLE and even Noble library seems to not work on MAC OS (i will try it on RPI or Windows machine)

  const { bluetooth, destroy } = createBluetooth();
  const adapter = await bluetooth.defaultAdapter();
  if (! await adapter.isDiscovering()) {
    await adapter.startDiscovery()

  }

  const device = await adapter.waitDevice('30:83:98:DC:0F:BE')
  await device.connect()
  
  console.log("Connected to device name: ", await device.getName())
  const gattServer = await device.gatt()
  
  console.log("gatt",gattServer)
  const service = await gattServer.getPrimaryService("cc540e31-80be-44af-b64a-5d2def886bf5")
  const clock = await service.getCharacteristic("7a1e0e3a-6b9b-49ef-b9b7-65c81b714a19");
  const timestamp = clock.readValue();
  console.log(timestamp)
  // @ts-ignore
  globalThis.device = device;
    // @ts-ignore
  globalThis.clock = clock;
  // spectodaDevice.assignConnector("dummy");
  // console.log(await spectodaDevice.connected());

  // console.log(await spectodaDevice.connect());

  // console.log(await spectodaDevice.connected());

  setInterval(() => {
    spectodaDevice.emitPercentageEvent("test", Math.random() * 200 - 100);
  }, 100000);

  // // THIS WILL log emitted events from spectoda device. This way we will see if we got it right
  // spectodaDevice.on("emitted_events", (events: any) => {
  //   console.log("emitted_events", events);
  // });

  Module;

  // console.log(adapter);
}

main();
