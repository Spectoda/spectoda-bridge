FROM node:18-buster

# install bluez related packages
RUN apt-get update && apt-get install -y \
    bluez \
    dbus \
    sudo
 
# setup and build application
WORKDIR /usr/src/app
COPY . .
# RUN npm install --only=production && npm run build

# setup bluetooth permissions
COPY ./bluezuser.conf /etc/dbus-1/system.d/
RUN useradd -m bluezuser \
 && adduser bluezuser sudo \
 && passwd -d bluezuser
USER bluezuser

# setup startup script
COPY docker-entrypoint.sh .
CMD ./docker-entrypoint.sh