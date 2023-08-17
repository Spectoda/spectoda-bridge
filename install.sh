#!/bin/bash

# check if running under root
if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit
fi

# ask user if he wants to update repo
read -p "Do you want to update the repo? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    sleep 1
    git pull
fi

# ask user if he wants to build the project first
read -p "Do you want to build the project first? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    sleep 1
    su gateway
    npm i
    ./build.sh
    exit
fi

echo "Installing systemd service and enabling it..."
sleep 1

# Create the systemd service file
cat <<EOF > /etc/systemd/system/spectoda-node.service
[Unit]
Description=Bridge for connecting to Spectoda Ecosystem
After=network.target

[Service]
User=gateway
Group=gateway
WorkingDirectory=/home/gateway/spectoda-node/spectoda-pws400k
ExecStart=node main.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target
EOF

# Reload systemd daemon to pick up the new service file
systemctl daemon-reload

# Enable and start the service
systemctl enable --now spectoda-node.service

