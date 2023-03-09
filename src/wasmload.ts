const Module = require("./wasm/RELEASE_0.9.0_20230309.js");
console.log("Module", Module);

Module.onRuntimeInitialized = () => {
  console.log("Webassembly runtime initilized");
};

// function onWasmLoad() {
//   Module.onRuntimeInitialized = () => {
//     moduleInitilized = true;

//     console.log("Webassembly runtime initilized");

//     waitingQueue.forEach(wait => {
//       wait.resolve();
//     });

//   };
// }

export { Module };
