# Spectoda Node

Spectoda Node is a "bridge" that enables communication with Spectoda devices using Bluetooth and provides a REST API for accessing their functionalities.

## Features

- Bluetooth connectivity with Spectoda devices.
- REST API for accessing device functionalities.
- More in progress...

## Install Release version on PI

- run this script in console, or run it as install.sh file

```bash
#!/bin/bash

# replace 1000 with userid it will be installed under
userid=1000

# Define the content to be added
content='<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
  "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <policy user="'"$userid"'">
   <allow own="org.bluez"/>
    <allow send_destination="org.bluez"/>
    <allow send_interface="org.bluez.GattCharacteristic1"/>
    <allow send_interface="org.bluez.GattDescriptor1"/>
    <allow send_interface="org.freedesktop.DBus.ObjectManager"/>
    <allow send_interface="org.freedesktop.DBus.Properties"/>
  </policy>
</busconfig>'

# Write the content to the file
echo "$content" |  tee /etc/dbus-1/system.d/node-ble.conf > /dev/null

# Define the URL of the binary to download
url="https://github.com/Spectoda/spectoda-node/releases/download/latest/spectoda-node-linux-arm64"

# Download the binary using curl
curl -L -o spectoda-node "$url"

# Make the binary executable
chmod +x spectoda-node

# get the current directory + the name of the binary
path=$(pwd)/spectoda-node

content='[Unit]
Description=Bridge for connecting to Spectoda Ecosystem
After=network.target

[Service]
User='"$userid"'
Group='"$userid"'
ExecStart='"$path"'
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target'

# create the service file
echo "$content" |  tee /etc/systemd/system/spectoda-node.service > /dev/null

# reload the daemon
systemctl daemon-reload

# enable the service
systemctl enable --now spectoda-node
```

## Development

```bash

# Initialization
# Don't forget to load submodules
git submodule update --init
npm i

# to make it compile and run
npm start
```

## API documentation

#### Route: GET /events

Description: This route sets up a server-sent event (SSE) connection to receive events emitted by the Spectoda device. The Spectoda device emits events such as changes in color or percentage values, sensor reactions and you can listen for those events.


#### `WORK IN PROGRESS` Route: GET /scan

Description: This route scans for available Spectoda devices and returns a list of their MAC addresses.

#### Route: POST /connect

Description: This route connects to a Spectoda device using a key and signature. If a MAC address is provided, it will connect to that specific device. Otherwise, it will connect to the first device found.

Request Body:

```json
{
  "signature": "00000000000000000000000000000000", // The owner's signature
  "key": "00000000000000000000000000000000", // The owner's key
  "mac": "08:b6:1f:ee:b8:8c" // The MAC address of the device to connect to
}
```

Response:

```json
{
  "status": "success", // Indicates whether the request was successful ("success") or not ("error")
  "result": {} // The result of the connect operation
}
```

#### Route: POST /disconnect

Description: This route disconnects from the Spectoda device.

Response:

```json
{
  "status": "success", // Indicates whether the request was successful ("success") or not ("error")
  "result": {} // The result of the disconnect operation
}
```

#### Route: POST /event

Description: This route emits an event to the Spectoda device. The event can be a percentage, color, timestamp, or empty event.

Request Body example payloads:

```json
{
  "label": "shoot",
  "id": 255, // 255 for broadcast on all devices on the network
  "type": "empty"
}

{
  "label": "barva",
  "id": 255, // 255 for broadcast on all devices on the network
  "type": "color",
  "value": "#ff0000" // hex string color
}

{
  "label": "speed",
  "id": [1,2,3], // array of device ids which react to event
  "type": "percentage",
  "value": 50,  // number -100 - 100%
}

{
  "label": "delay",
  "id": 1, // device id which should react to event
  "type": "timestamp",
  "value": 5000,  // value in ms (example 5 seconds)
}
```

Response:

```json
{
  "status": "success", // Indicates whether the request was successful ("success") or not ("error")
  "result": {} // The result of the emit operation
}
```
