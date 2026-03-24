/* eslint-disable @typescript-eslint/no-explicit-any */

import { FileUpload, Store, TrialData } from './common';

type DataObject = {
  [key: string]: string | number | boolean | null | undefined;
};

export function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    const escapedValue = stringValue.replace(/"/g, '""');
    return `"${escapedValue}"`;
  }

  return stringValue;
}

export function convertArrayOfObjectsToCSV(data: DataObject[]): string {
  if (!data || data.length === 0) {
    return '';
  }

  const headerSet = new Set<string>();
  data.forEach((obj) => {
    Object.keys(obj).forEach((key) => {
      headerSet.add(key);
    });
  });
  const headers = Array.from(headerSet);

  const headerRow = headers.map((header) => escapeCsvValue(header)).join(',');

  const dataRows = data.map((obj) => {
    return headers
      .map((header) => {
        const value = obj[header];
        return escapeCsvValue(value);
      })
      .join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

export const defaultFlatteningFunctions: Record<
  string,
  (item: TrialData) => any[] | Record<string, any[]>
> = {
  CanvasBlock: (item: TrialData) => {
    const responseData = item.responseData;
    if (Array.isArray(responseData)) {
      return responseData.map((i) => ({
        block: item.name,
        ...i,
      }));
    }
    return [];
  },
};

export const transform = ({ responseData, ...obj }: any) => ({
  ...obj,
  ...Object.entries(responseData || {}).reduce(
    (acc, [k, v]) => ({ ...acc, [`data_${k}`]: v }),
    {},
  ),
});

export type CSVBuilder = {
  filename?: string;
  trials?: string[];
  fun?: (row: Record<string, any>) => Record<string, any>;
};

export function combineTrialsToCsv(
  data: any[],
  filename: string,
  names: string[],
  flatteningFunctions: Record<string, (item: any) => any[] | Record<string, any[]>>,
  fun?: (obj: any) => any,
): FileUpload | FileUpload[] {
  // Collect all flattener results first, filtering out completely empty results
  const allResults: (any[] | Record<string, any[]>)[] = names
    .flatMap((name) => {
      const matchingItems = data.filter((d) => d.name === name);

      return matchingItems.map((item) => {
        const flattener = item.type && flatteningFunctions[item.type];
        const result = flattener ? flattener(item) : [transform(item)];

        if (Array.isArray(result) && result.length === 0) {
          return null;
        }

        if (result && typeof result === 'object' && !Array.isArray(result)) {
          const hasAnyData = Object.values(result).some(
            (val) => Array.isArray(val) && val.length > 0,
          );
          if (!hasAnyData) {
            return null;
          }
        }

        return result;
      });
    })
    .filter((result) => result !== null);

  const hasMultiTable = allResults.some(
    (result) =>
      result &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      Object.keys(result).some((key) => Array.isArray(result[key])),
  );

  if (!hasMultiTable) {
    const processedData = allResults
      .flatMap((result) => (Array.isArray(result) ? result : []))
      .map((x) => (fun ? fun(x) : x));

    if (processedData.length === 0) {
      return [];
    }

    return {
      filename,
      encoding: 'utf8' as const,
      content: convertArrayOfObjectsToCSV(processedData),
    };
  }

  const allTableKeys = new Set<string>();
  allResults.forEach((result) => {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      Object.keys(result).forEach((key) => {
        if (Array.isArray(result[key])) {
          allTableKeys.add(key);
        }
      });
    }
  });

  const files: FileUpload[] = [];

  for (const tableKey of allTableKeys) {
    const tableData = allResults
      .flatMap((result) => {
        if (Array.isArray(result)) {
          return result;
        } else if (result && typeof result === 'object' && result[tableKey]) {
          return result[tableKey];
        }
        return [];
      })
      .map((x) => (fun ? fun(x) : x));

    if (tableData.length === 0) {
      continue;
    }

    const baseFilename = filename.replace(/\.csv$/, '');

    files.push({
      filename: `${baseFilename}_${tableKey}.csv`,
      encoding: 'utf8' as const,
      content: convertArrayOfObjectsToCSV(tableData),
    });
  }

  if (files.length === 0) {
    return [];
  }

  return files.length === 1 ? files[0] : files;
}

export function buildUploadFiles(config: {
  sessionID: string;
  data: any[];
  store?: Store;
  generateFiles?: (sessionID: string, data: any[], store?: Store) => FileUpload[];
  sessionCSVBuilder?: CSVBuilder;
  trialCSVBuilder?: {
    flatteners: Record<string, (item: any) => any[] | Record<string, any[]>>;
    builders: CSVBuilder[];
  };
  uploadRaw?: boolean;
}): FileUpload[] {
  const {
    sessionID,
    data,
    store,
    generateFiles,
    sessionCSVBuilder,
    trialCSVBuilder,
    uploadRaw = true,
  } = config;

  const files: FileUpload[] = generateFiles ? generateFiles(sessionID, data, store) : [];

  if (uploadRaw) {
    files.push({
      filename: `${sessionID}.raw.json`,
      content: JSON.stringify(data),
      encoding: 'utf8',
    });
  }

  if (sessionCSVBuilder) {
    type ParamDetails = {
      value?: any;
      defaultValue: any;
    };
    let paramsDict: Record<string, any> = {};
    const paramsSource: Record<string, ParamDetails | any> | undefined =
      data?.[0]?.responseData?.params;
    if (paramsSource && typeof paramsSource === 'object' && paramsSource !== null) {
      paramsDict = Object.entries(paramsSource).reduce(
        (
          accumulator: Record<string, any>,
          [paramName, paramDetails]: [string, ParamDetails | any],
        ) => {
          if (
            paramDetails &&
            typeof paramDetails === 'object' &&
            'defaultValue' in paramDetails
          ) {
            const chosenValue = paramDetails.value ?? paramDetails.defaultValue;
            accumulator[paramName] = chosenValue;
          }
          return accumulator;
        },
        {} as Record<string, any>,
      );
    }

    let content: Record<string, any> = {
      sessionID,
      userAgent: data?.[0]?.responseData?.userAgent,
      ...paramsDict,
    };

    if (
      sessionCSVBuilder.trials &&
      Array.isArray(sessionCSVBuilder.trials) &&
      sessionCSVBuilder.trials.length > 0
    ) {
      for (const trialName of sessionCSVBuilder.trials) {
        const matchingDataElement = data.find((element) => element.name === trialName);

        if (matchingDataElement?.responseData) {
          if (
            typeof matchingDataElement.responseData === 'object' &&
            matchingDataElement.responseData !== null
          ) {
            content = { ...content, ...matchingDataElement.responseData };
          }
        }
      }
    }

    files.push({
      content: convertArrayOfObjectsToCSV([
        sessionCSVBuilder.fun ? sessionCSVBuilder.fun(content) : content,
      ]),
      filename: `${sessionID}${sessionCSVBuilder.filename}.csv`,
      encoding: 'utf8' as const,
    });
  }

  if (trialCSVBuilder) {
    for (const builder of trialCSVBuilder.builders) {
      const result = combineTrialsToCsv(
        data,
        `${sessionID}${builder.filename}.csv`,
        builder.trials ?? [],
        { ...defaultFlatteningFunctions, ...trialCSVBuilder.flatteners },
        builder.fun,
      );

      if (Array.isArray(result)) {
        if (result.length > 0) {
          files.push(...result);
        }
      } else {
        files.push(result);
      }
    }
  }

  return files;
}
