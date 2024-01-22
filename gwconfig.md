```bash
|| 10.0.18.106 |kontroler pro LED fasádu |02:07:24:63:22:d3|C9200-CEETE-A 6/9|
|| 10.0.18.107 |kontroler pro LED fasádu |02:07:8e:80:26:a7|C9200-CEETE-A 6/11|
|| 10.0.18.108 |kontroler pro LED fasádu |02:07:b2:75:1b:3b|C9200-CEETE-A 6/4|
|| 10.0.18.109 |kontroler pro LED fasádu |02:07:56:ec:5e:81|C9200-CEETE-A 6/2|
|| 10.0.18.110 |kontroler pro LED fasádu |02:07:b6:88:fa:69|C9200-CEETE-A 6/6|
|| 10.0.18.111 |kontroler pro LED fasádu |02:07:53:3b:22:34|C9200-CEETE-A 2/34|

GW bude vždy 10.0.18.1
DNS          158.196.0.53
NTP          10.0.18.1
maska        255.255.255.0

nmcli con add type ethernet con-name "EthernetL" ifname eth0
nmcli con mod "EthernetL" ipv4.addresses 10.0.18.111/24
nmcli con mod "EthernetL" ipv4.gateway 10.0.18.1
nmcli con mod "EthernetL" ipv4.dns 158.196.0.53
nmcli con mod "EthernetL" ipv4.method manual

# nmcli con up "EthernetL"


vim /home/gateway/utils/network-switch.sh
nmcli con up "Ethernet connection 1"
sleep 1000
reboot

chmod +x /home/gateway/utils/network-switch.sh

sudo crontab -e
10 * * * * /home/gateway/utils/network-switch.sh
```


nmcli con add type ethernet con-name "EthernetL" ifname eth0
nmcli con mod "EthernetL" ipv4.addresses 10.0.0.241/24
nmcli con mod "EthernetL" ipv4.gateway 10.0.0.138
nmcli con mod "EthernetL" ipv4.dns 8.8.8.8
nmcli con mod "EthernetL" ipv4.method manual
nmcli con up "EthernetL"


nmcli con mod "EthernetL" ipv6.method disable
nmcli con up "EthernetL"


vim spectoda-bridge/src/lib/spectoda-js/SpectodaWebSocketsConnector.js
export const WEBSOCKET_URL = "http://10.0.18.106:4001";