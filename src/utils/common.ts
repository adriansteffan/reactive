import { Capacitor } from "@capacitor/core";

export function now() {
  return Math.round(performance.now());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shuffle(array: any[]) {
  for (let i = array.length - 1; i >= 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function isDesktop() {
  return (window as any).electronAPI !== undefined;
}

// Generic type for all data structures
export interface TrialData {
  index: number;
  trialNumber: number,
  type: string;
  name: string;
  data: any;
  start: number;
  end: number;
  duration: number;
}

export interface FileUpload {
  filename: string;
  content: string;
  encoding: 'base64' | 'utf8';
}

export interface ExperimentConfig {
  showProgressBar: boolean;
}

export interface Store { [key: string]: any }

export interface BaseComponentProps {
  next: (data: object) => void;
  data: TrialData[];
  store?: Store;
  updateStore: (mergeIn: Store) => void;
}

type ParamType = 'string' | 'number' | 'boolean' | 'array' | 'json';
type ParamValue<T extends ParamType> = T extends 'number'
  ? number | undefined
  : T extends 'boolean'
    ? boolean | undefined
    : T extends 'array' | 'json'
      ? any | undefined
      : string | undefined;

export function getParam<T extends ParamType>(
  name: string,
  defaultValue: ParamValue<T> | undefined,
  type: T = 'string' as T,
): ParamValue<T> | undefined {
  // First, check for the parameter in the base64-encoded JSON
  const encodedJson = new URLSearchParams(window.location.search).get('_b');
  if (encodedJson) {
    try {
      const jsonString = atob(encodedJson);
      const decodedParams = JSON.parse(jsonString);
      if (name in decodedParams) {
        return decodedParams[name];
      }
    } catch {
      // Silently fail if decoding or parsing fails, fallthrough to lower case
    }
  }

  //Next, check for the parameter directly in the URL
  // since this does not have the automatic type conversions of JSON.parse, we have to create helper functionss
  const conversions: Record<ParamType, (v: string) => any> = {
    string: (v) => v,
    number: (v) => Number(v) || defaultValue,
    boolean: (v) => v.toLowerCase() === 'true',
    array: (v) => {
      try {
        return JSON.parse(v);
      } catch {
        return defaultValue;
      }
    },
    json: (v) => {
      try {
        return JSON.parse(v);
      } catch {
        return defaultValue;
      }
    },
  };

  const convertValue = (value: any): ParamValue<T> | undefined => {
    if (
      (type === 'string' && typeof value === 'string') ||
      (type === 'number' && typeof value === 'number') ||
      (type === 'boolean' && typeof value === 'boolean') ||
      (type === 'array' && Array.isArray(value)) ||
      (type === 'json' && typeof value === 'object' && value !== null)
    ) {
      return value as ParamValue<T>;
    }

    if (typeof value === 'string') {
      if (value.toLowerCase() === 'undefined') return undefined;
      return conversions[type](value);
    }

    return defaultValue;
  };

  const value = new URLSearchParams(window.location.search).get(name);
  if (value === undefined || value === null) return defaultValue;
  return convertValue(value);
}



export type Platform = 'desktop' | 'mobile' | 'web';

export const getPlatform = (): Platform => {
  if ((window as any).electronAPI) {
    return 'desktop';
  } else if (Capacitor.isNativePlatform()) {
    return 'mobile';
  } else {
    return 'web';
  }
};
