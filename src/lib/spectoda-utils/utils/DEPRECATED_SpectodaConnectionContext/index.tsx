/* eslint-disable */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// TODO: Remove this file, all functionality was replaced with spectoda-core

import { atom, useAtom } from "jotai";
import React, { createContext, useState } from "react";
import useConnectionStatus from "../../hooks/DEPRECATED_useConnectionStatus";
import { useToast } from "../../hooks/useToast";
import { useVersion } from "../../hooks/DEPRECATED_useVersion";
import { nanoevents } from "../../services/localEvents";
import { useEventStore } from "../../useSpectodaEvents";
import { atomWithLocalStorage } from "../DEPRECATED_atom";
import { ConnectionStatus, ConnectorType } from "./DEPRECATED_constants";
import { spectoda } from "@spectoda/spectoda-core";

export interface MacObject {
  mac: string;
}

export interface ConnectionContext
  extends SpectodaConnectionMethods,
    SpectodaConnectionState {}

interface SpectodaConnectionState {
  connectionStatus: ConnectionStatus;
  connectedMacs: MacObject[];
  directlyConnectedMac: string;
  lastDirectlyConnectedMac: string;
  disconnectedMacs: MacObject[];
  connector: ConnectorType;

  isConnecting: boolean;
  isUploading: boolean;
  isConnected: boolean;

  version: string;
  fullVersion: string;
  versionAvailable: boolean;
  isLimitedMode: boolean;
  connectedName: string | null;
  connectedController: any;
  connectedNetworkSignature: string;
  isUnknownNetwork: boolean;
}

// todo be moved to Spectoda.ts once it exists
type ConnectOptions = {
  devices?: string[] | null;
  autoConnect?: boolean;
  ownerSignature?: string | null;
  ownerKey?: string | null;
  connectAny?: boolean;
  fwVersion?: string;
};

interface SpectodaConnectionMethods {
  connect: (
    params?: ConnectOptions,
    args?: {
      throwOnError: boolean;
    },
  ) => Promise<unknown>;
  disconnect: () => Promise<void>;
  upload: (tngl: string) => Promise<void>;
  assignConnector: (mac: ConnectorType) => Promise<void>;
  activateFakeDevice: (mac: string[]) => void;
  isActiveMac: (mac: string | string[] | undefined) => boolean;
  getAndSetPeers: () => Promise<void>;
  getConnectedPeersInfo: () => Promise<unknown>;
  setIsUploading: (isUploading: boolean) => void;
}

const defaultValues = {} as ConnectionContext;

// ! DISABLED by @immakermatty because of bug in switching connectors. @mchlkucera to fix.
// const connectorAtom = atomWithLocalStorage<ConnectorType>(
//   "connector",
//   "default",
// );
const connectorAtom = atom<ConnectorType>("default");

export const bluetoothDisabledAtom = atom(false);

const SpectodaConnection = createContext<ConnectionContext>(defaultValues);
function SpectodaConnectionProvider({ children }: React.PropsWithChildren) {
  const toast = useToast();
  const errorToast = e => {
    toast(e);
    console.error(e);
  };

  const [connectedMacs, setConnectedMacs] = useState<MacObject[]>([]);
  const [disconnectedMacs, setDisconnectedMacs] = useState<MacObject[]>([]);
  const [connector, setConnector] = useAtom(connectorAtom);
  const [isUploading, setIsUploading] = useState(false);
  const {
    isConnected,
    isConnecting,
    connectionStatus,
    directlyConnectedMac,
    connectedName,
    lastDirectlyConnectedMac,
    connectedNetworkSignature,
  } = useConnectionStatus(setConnectedMacs, setDisconnectedMacs);
  const { version, fullVersion } = useVersion(connectionStatus);
  const [connectedController, setConnectedController] = useState({});
  const [, setBluetoothDisabled] = useAtom(bluetoothDisabledAtom);

  // useEffect(() => {
  //   const assignConnectorAndAutoConnectDummy = async () => {
  //     await methods.assignConnector(connector);
  //     if (connector === "dummy") {
  //       await methods.connect({
  //         connectAny: true,
  //       });
  //     }
  //   };

  //   const connectSpectodaConnect = async () => {
  //     let storedNetwork = localStorage.getItem("current-network");

  //     try {
  //       if (storedNetwork && detectSpectodaConnect()) {
  //         storedNetwork = JSON.parse(storedNetwork);

  //         methods.connect({
  //           autoConnect: true,
  //           connectAny: false,
  //           ownerKey: storedNetwork?.ownerKey,
  //           ownerSignature: storedNetwork?.ownerSignature,
  //         });
  //         nanoevents.emit("events-local-reset");
  //       }
  //     } catch (e) {
  //       errorToast(e);
  //     }
  //   };

  //   void connectSpectodaConnect();
  //   void assignConnectorAndAutoConnectDummy();
  // }, []);

  const state: SpectodaConnectionState = {
    isConnecting,
    connectedMacs,
    disconnectedMacs,
    connectedNetworkSignature,
    connector,
    connectionStatus,
    lastDirectlyConnectedMac,
    isUnknownNetwork: isConnected && connectedNetworkSignature === "unknown",
    isUploading,
    version: version || "unknown",
    directlyConnectedMac,
    fullVersion,
    versionAvailable: version !== "unknown",
    isLimitedMode: version === "unknown",
    isConnected,
    connectedName,
    connectedController,
  };

  const methods: SpectodaConnectionMethods = {
    getAndSetPeers: async () => {
      try {
        const peers = await spectoda.getConnectedPeersInfo();
        setConnectedMacs(peers);
        setDisconnectedMacs(macs =>
          macs.filter(v => peers.find((p: MacObject) => p.mac !== v.mac)),
        );
      } catch (e) {
        errorToast(e);
      }
    },

    connect: async (
      options,
      args = {
        throwOnError: false,
      },
    ) => {
      const {
        devices = null,
        autoConnect = false,
        ownerSignature = null,
        ownerKey = null,
        connectAny = true,
        fwVersion = "",
      } = options || {};

      try {
        await spectoda.assignConnector(connector);
        const data = await spectoda.connect(
          devices,
          autoConnect,
          ownerSignature,
          ownerKey,
          connectAny,
          fwVersion,
        );

        setBluetoothDisabled(false);
        toast({ title: "Connected", description: JSON.stringify(data) });
        setConnectedController(data);
        nanoevents.emit("trigger-post-connect-action");
        return data;
      } catch (e) {
        errorToast(e);

        if (e?.toString().includes("BluetoothOff")) {
          setBluetoothDisabled(true);
        } else {
          setBluetoothDisabled(false);
        }

        if (args?.throwOnError) {
          throw e;
        }
      }
    },

    disconnect: async () => {
      try {
        await spectoda.disconnect();
      } catch (e) {
        errorToast(e);
      }
    },

    upload: async (tngl: string) => {
      setIsUploading(true);
      await spectoda.writeTngl(tngl);
      setIsUploading(false);
    },

    assignConnector: async connector => {
      try {
        setConnector(connector);

        await spectoda.assignConnector(connector);
      } catch (e) {
        errorToast(e);
      }
    },

    isActiveMac: mac => {
      if (!mac) return true;

      if (connector === "dummy") {
        return true;
      }

      if (typeof mac === "string") {
        mac = [mac];
      }

      return mac?.some(m => {
        return connectedMacs.find(p => p.mac == m);
      });
    },

    activateFakeDevice: macs => {
      const newmacs = macs.map(m => ({ mac: m }));
      if (connector === "dummy") {
        setConnectedMacs(macs => [...macs, ...newmacs]);
        return true;
      } else {
        return false;
      }
    },

    getConnectedPeersInfo: async () => {
      try {
        return await spectoda.getConnectedPeersInfo();
      } catch (e) {
        errorToast(e);
      }
    },

    setIsUploading,
  };

  return (
    <SpectodaConnection.Provider
      value={{
        ...state,
        ...methods,
      }}>
      {children}
    </SpectodaConnection.Provider>
  );
}

export { SpectodaConnection, SpectodaConnectionProvider };
