import { exec } from "child_process";
import os from "os";

export function getEth0MacAddress(): Promise<string> {
  return new Promise((resolve, reject) => {
    exec("ip link show eth0", (error, stdout, stderr) => {
      if (error) {
        reject(`exec error: ${error}`);
        return;
      }

      const match = stdout.match(/link\/ether ([\w\d:]+)/);
      if (match && match[1]) {
        resolve(match[1]);
      } else {
        reject("Could not find MAC address for eth0.");
      }
    });
  });
}

export const getUnameString = () => {
  return new Promise((resolve, reject) => {
    exec("uname -a", (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
};
// // Example usage
// getEth0MacAddress()
//     .then(mac => console.log(`MAC Address of eth0: ${mac}`))
//     .catch(error => console.error(error));
// Function to get local IP of a specific interface, e.g., eth0

export const getLocalIp = (interfaceName: string) => {
  const interfaces = os.networkInterfaces();
  const interfaceDetails = interfaces[interfaceName];
  if (interfaceDetails) {
    for (let details of interfaceDetails) {
      if (details.family === "IPv4" && !details.internal) {
        return details.address;
      }
    }
  }
  return null;
};
