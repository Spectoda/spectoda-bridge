// import { createBluetooth } from "node-ble";
// import { sortAndDeduplicateDiagnostics } from "typescript";
import { spectodaDevice } from "./communication";
import "./server";
// import { Module } from "./wasmload";

async function main() {
  // NODE BLE and even Noble library seems to not work on MAC OS (i will try it on RPI or Windows machine)

  // const SPECTODA_SERVICE_UUID = "cc540e31-80be-44af-b64a-5d2def886bf5";

  // const TERMINAL_CHAR_UUID = "33a0937e-0c61-41ea-b770-007ade2c79fa";
  // const DEVICE_CHAR_UUID = "9ebe2e4b-10c7-4a81-ac83-49540d1135a5";
  // const CLOCK_CHAR_UUID = "7a1e0e3a-6b9b-49ef-b9b7-65c81b714a19";

  // const { bluetooth, destroy } = createBluetooth();
  // const adapter = await bluetooth.defaultAdapter();

  // if (! await adapter.isDiscovering()) {
  //   await adapter.startDiscovery();
  //   console.log("Scanning started");
  // }

  // const device = await adapter.waitDevice('0C:B8:15:C3:32:E6');
  // console.log("Device selected");


  // // for some reason the scanning need to stop after some time
  // setTimeout(async () => {
  //   await adapter.stopDiscovery();
  //   console.log("Scanning stopped");
  // }, 1000)

  // const paired = await device.isPaired();
  // if (!paired) {
  //   await device.pair(); // pair and connect
  // } else {
  //   await device.connect();
  // }

  // console.log("Connected to device name: ", await device.getName())
  // const gattServer = await device.gatt();


  // console.log("gattServer", gattServer);
  // const service = await gattServer.getPrimaryService(SPECTODA_SERVICE_UUID)


  // const terminal_characteristics = await service.getCharacteristic(TERMINAL_CHAR_UUID);
  // const device_characteristics = await service.getCharacteristic(DEVICE_CHAR_UUID);
  // const clock_characteristics = await service.getCharacteristic(CLOCK_CHAR_UUID);

  // console.log("terminal_characteristics", terminal_characteristics);
  // console.log("device_characteristics", device_characteristics);
  // console.log("clock_characteristics", clock_characteristics);


  // const clock_timestamp_bytes = await clock_characteristics.readValue();
  // console.log("clock_timestamp_bytes", clock_timestamp_bytes);

  // // @ts-ignore
  // globalThis.bluetooth = bluetooth;
  // // @ts-ignore
  // globalThis.adapter = adapter;
  // // @ts-ignore
  // globalThis.device = device;

  // console.log("Ready");

  //////////////////////////////////////////////////////////////////////////////////////////


  // // @ts-ignore
  // globalThis.spectodaDevice = spectodaDevice;

  // console.log("Ready");

  // // //  @ts-ignore
  // // console.log("Selecting...");
  // // await spectodaDevice.interface?.autoSelect([{ mac: "0C:B8:15:C3:32:E6" }], 1000, 60000);
  // // console.log("Connecting...");
  // // await spectodaDevice.interface?.connect();

  // try {
  //   // @ts-ignore
  //   await spectodaDevice.connect([{ mac: "34:94:54:5a:31:c2" }], true, null, null, false, "", true);
  // } catch (e) {
  //   console.error(e);
  // }

  // //  @ts-ignore
  // console.log("> Selecting...");
  // await spectodaDevice.interface?.autoSelect([{ mac: "0C:B8:15:D6:F7:EE" }], 1000, 60000);
  // console.log("> Connecting...");
  // await spectodaDevice.interface?.connect(60000, false);

    //////////////////////////////////////////////////////////////////////////////////////////

    // const controllers = await spectodaDevice.scan([{name: "DevKit"}]);
    // spectodaDevice.connect(controllers);

}

main();
