import { exec } from 'child_process';

export function getEth0MacAddress(): Promise<string> {
    return new Promise((resolve, reject) => {
        exec('ip link show eth0', (error, stdout, stderr) => {
            if (error) {
                reject(`exec error: ${error}`);
                return;
            }

            const match = stdout.match(/link\/ether ([\w\d:]+)/);
            if (match && match[1]) {
                resolve(match[1]);
            } else {
                reject('Could not find MAC address for eth0.');
            }
        });
    });
}

// // Example usage
// getEth0MacAddress()
//     .then(mac => console.log(`MAC Address of eth0: ${mac}`))
//     .catch(error => console.error(error));
