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
