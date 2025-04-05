import { Capacitor } from '@capacitor/core';


export function now(){
  return Math.round(performance.now());
}

export function isFullscreen(): boolean {
  return !!(
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).mozFullScreenElement ||
    (document as any).msFullscreenElement
  );
}

export function isDesktop() {
  return (window as any).electronAPI !== undefined;
}

// Generic type for all data structures
export interface TrialData {
  index: number;
  trialNumber: number;
  type: string;
  name: string;
  responseData: any;
  start: number;
  end: number;
  duration: number;
}

export interface FileUpload {
  filename: string;
  content: string;
  encoding?: 'base64' | 'utf8';
}

export interface ExperimentConfig {
  showProgressBar: boolean;
}

export interface Store {
  [key: string]: any;
}

export interface BaseComponentProps {
  next: (data?: object, actualStartTime?: number, actualStopTime?: number) => void;
  data: TrialData[];
  store?: Store;
  updateStore: (mergeIn: Store) => void;
}

type ParamType = 'string' | 'number' | 'boolean' | 'array' | 'json';

type ParamValue<T extends ParamType> = T extends 'number'
  ? number
  : T extends 'boolean'
    ? boolean
    : T extends 'array' | 'json'
      ? any
      : string;

const sharedRegistry: any[] = [];

export function getParam<T extends ParamType>(
  name: string,
  defaultValue: ParamValue<T>,
  type: T = 'string' as T,
  description?: string,
): ParamValue<T> {
  let registryEntry = sharedRegistry.find((p) => p.name === name);

  if (!registryEntry) {
    registryEntry = {
      name,
      defaultValue,
      type,
      description,
      value: undefined,
    };
    sharedRegistry.push(registryEntry);
  }

  const conversions: Record<ParamType, (v: string) => any> = {
    string: (v) => v,
    number: (v) => {
      const num = Number(v);
      return isNaN(num) ? defaultValue : num;
    },
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

  const convertValue = (value: any): ParamValue<T> => {
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
      if (value.toLowerCase() === 'undefined') return defaultValue;
      return conversions[type](value);
    }

    return defaultValue;
  };

  // First, check for the parameter in the base64-encoded JSON
  const encodedJson = new URLSearchParams(window.location.search).get('_b');
  if (encodedJson) {
    try {
      const jsonString = atob(encodedJson);
      const decodedParams = JSON.parse(jsonString);
      if (name in decodedParams) {
        const convertedValue = convertValue(decodedParams[name]);
        registryEntry.value = convertedValue;
        return convertedValue;
      }
    } catch {
      // Silently fail if decoding or parsing fails, fallthrough to lower case
    }
  }

  // Next, check for the parameter directly in the URL
  const value = new URLSearchParams(window.location.search).get(name);
  if (value === undefined || value === null) {
    // If no value found, register default value
    return defaultValue;
  }

  const convertedValue = convertValue(value);
  registryEntry.value = convertedValue;
  return convertedValue;
}

const timelineRepresentation: { type: string; name?: string }[] = [];

// Param class that uses the same shared registry
export class Param {
  static getRegistry() {
    return [...sharedRegistry];
  }
  static getTimelineRepresentation() {
    return [...timelineRepresentation];
  }
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

const providedComponentParams: Record<string, any> = {};

export function registerExperimentParams(experiment: any[]) {
  experiment.forEach((item) => {
    const params = providedComponentParams[item.type];
    if (params) {
      for (const param of params) {
        if(!item.hideSettings || (item.hideSettings !== true && !item.hideSettings.includes(param.name))){
          sharedRegistry.push(param);
        }
      }
    }
  });
}

export function registerComponentParams(
  type: string,
  params: { name: string; defaultValue: any; type: string; description?: string }[],
) {
  providedComponentParams[type] = params;
}

export function subsetExperimentByParam(experiment: any[]) {
  registerExperimentParams(experiment);

  timelineRepresentation.length = 0;

  experiment.forEach((item) => {
    timelineRepresentation.push({
      type: item.type ?? 'NoTypeSpecified',
      name: item.name,
    });
  });

  const include = getParam('includeSubset', undefined);
  const exclude = getParam('excludeSubset', undefined);

  let experimentFiltered = [...experiment];

  if (include) {
    const includeItems = include.split(',');
    experimentFiltered = experimentFiltered.filter((item, index) => {
      const positionMatch = includeItems.some((val: string) => {
        const num = parseInt(val, 10);
        return !isNaN(num) && num - 1 === index;
      });
      const nameMatch = item.name && includeItems.includes(item.name);
      return positionMatch || nameMatch;
    });
  }

  if (exclude) {
    const excludeItems = exclude.split(',');
    experimentFiltered = experimentFiltered.filter((item, index) => {
      const positionMatch = excludeItems.some((val: string) => {
        const num = parseInt(val, 10);
        return !isNaN(num) && num - 1 === index;
      });
      const nameMatch = item.name && excludeItems.includes(item.name);
      return !(positionMatch || nameMatch);
    });
  }

  return experimentFiltered;
}

export function canvasCountdown(seconds: number) {
  if (seconds <= 0) {
    return [];
  }
  return Array.from({ length: seconds }, (_, i) => {
    const number = seconds - i;

    return {
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        ctx.save();

        ctx.fillStyle = 'black';
        ctx.font = `bold ${Math.min(w, h) * 0.02 * 2}px sans-serif`; // Make countdown text larger
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(number.toString(), w / 2, h / 2);

        ctx.restore();
      },
      displayDuration: 1000,
      ignoreData: true,
    };
  });
}