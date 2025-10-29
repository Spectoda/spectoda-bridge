/* eslint-disable */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// TODO: Remove this file

import { atom } from "jotai";

const isFunction = (value: unknown): value is Function => {
  return typeof value === "function";
};

export const atomWithLocalStorage = <T>(key: string, initialValue: T) => {
  const getInitialValue = (): T => {
    if (typeof window !== "undefined") {
      const item = localStorage.getItem(key);
      if (item !== null) {
        return JSON.parse(item);
      }
      return initialValue;
    }
    return initialValue;
  };
  const baseAtom = atom(getInitialValue());
  const derivedAtom = atom(
    get => get(baseAtom),
    (get, set, update: T | ((prev: T) => T)) => {
      const nextValue = isFunction(update) ? update(get(baseAtom)) : update;
      set(baseAtom, nextValue);
      localStorage.setItem(key, JSON.stringify(nextValue));
    },
  );
  return derivedAtom;
};

export function uniqueByKey<T extends Record<string, any>>(
  networks: T[],
  key: string,
) {
  const seenKeys = new Set();
  return networks.filter(network => {
    if (seenKeys.has(network[key])) return false;
    seenKeys.add(network[key]);
    return true;
  });
}

export const atomWithLocalStorageRemoveDuplicatesArray = <
  T extends Record<string, any>,
>(
  localStorageKey: string,
  objectKey: string,
  initialValue: T[],
) => {
  const getInitialValue = (): T[] => {
    if (typeof window !== "undefined") {
      const item = localStorage.getItem(localStorageKey);

      if (item !== null) {
        return uniqueByKey(JSON.parse(item), objectKey);
      }
      return initialValue;
    }
    return initialValue;
  };

  const baseAtom = atom(getInitialValue());
  const derivedAtom = atom(
    get => get(baseAtom),
    (get, set, update: T[] | ((prev: T[]) => T[])) => {
      const nextValue =
        typeof update === "function" ? update(get(baseAtom)) : update;
      const filteredValue = uniqueByKey(nextValue, objectKey);
      set(baseAtom, filteredValue);
      localStorage.setItem(localStorageKey, JSON.stringify(filteredValue));
    },
  );
  return derivedAtom;
};
