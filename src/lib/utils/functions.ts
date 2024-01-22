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


export const fetchPiInfo = async () => {
  const gatewayMetadata = {
    hostname: os.hostname(),
    mac: await getEth0MacAddress(),
    // todo handle wifi ip
    localIp: getLocalIp("eth0"),
    unameString: await getUnameString(),
  };

  return gatewayMetadata;
};