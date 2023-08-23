#!/bin/bash

# Check if the -y flag is passed as an argument
if [[ "$1" == "-y" ]]; then
  AUTO_YES=true
fi

# Check if running under root
if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit
fi

# Function to handle prompts
prompt() {
  if [[ ! $AUTO_YES ]]; then
    read -p "$1 (y/n) " -n 1 -r
    echo
  fi
  [[ $AUTO_YES || $REPLY =~ ^[Yy]$ ]]
}

# Ask user if they want to update the repo
if prompt "Do you want to update the repo?"; then
  sleep 1
  git pull
  git submodule update --init --recursive
fi

# Ask user if they want to build the project first
if prompt "Do you want to build the project first?"; then
  sleep 1
  su gateway -c 'npm i'
  su gateway -c './build.sh'
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
WorkingDirectory=/home/gateway/spectoda-node/build/
ExecStart=/bin/bash -i -c 'node main.js'
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target
EOF

# Reload systemd daemon to pick up the new service file
systemctl daemon-reload

# Enable and start the service
systemctl restart spectoda-node.service
systemctl enable --now spectoda-node.service
