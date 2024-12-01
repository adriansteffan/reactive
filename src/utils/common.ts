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

// Generic type for all data structures
export interface StudyEvent {
  index: number;
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

export interface BaseComponentProps {
  next: (data: object) => void;
  data?: object;
  metaData?: object;
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
  const value = new URLSearchParams(window.location.search).get(name);
  if (!value) return defaultValue;
  if (value.toLowerCase() === 'undefined') return undefined;

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

  return conversions[type](value);
}