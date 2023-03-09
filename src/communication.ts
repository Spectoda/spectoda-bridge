// import esPkg from 'essentia.js';
import { Spectoda } from "./lib/spectoda-js/Spectoda";
import { setLoggingLevel } from "./lib/spectoda-js/Logging";

const spectodaDevice = new Spectoda("dummy", 0, true);
setLoggingLevel(5);

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

export { spectodaDevice };
