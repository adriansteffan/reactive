import { useMemo, useRef, useState } from 'react';
import { type Experiment, inSubset, previewTimeline } from '../core/experiment';
import {
  libraryParams,
  type ParamSpec,
  type ParamType,
  paramType,
  parseParam,
  resolveParams,
  urlParams,
} from '../core/params';
import { ParamInput } from './paraminput';

type CustomParam = { name: string; type: ParamType; value: string };
type Entry = { type: string; name?: string };

const subsetKeys = ['includeSubset', 'excludeSubset'];

// How a value appears in a text field
const asText = (value: unknown) =>
  typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);

// The type that the value of a param the experiment does not declare appears to have
function guessType(value: unknown): ParamType {
  if (typeof value === 'boolean' || value === 'true' || value === 'false') return 'boolean';
  if (
    typeof value === 'number' ||
    (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value)))
  ) {
    return 'number';
  }
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return 'string';
    }
  }
  if (Array.isArray(parsed)) return 'array';
  return typeof parsed === 'object' && parsed !== null ? 'json' : 'string';
}

// The value of a custom param's text, for the base64 link
function parseCustom(type: ParamType, text: string): unknown {
  if (type === 'number') return Number(text);
  if (type === 'boolean') return text === 'true';
  if (type === 'array' || type === 'json') {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

// When the entered values do not build a timeline, the library's params are still listed
function preview(
  experiment: Experiment<any>,
  url: Record<string, unknown>,
  defaults: Record<string, unknown>,
) {
  try {
    return { ...previewTimeline(experiment, url, defaults), error: undefined };
  } catch (error) {
    return { entries: [] as Entry[], settings: { General: libraryParams }, error: (error as Error).message };
  }
}

// A trial is identified by its name, or by its position if it has none
const entryId = (entry: Entry, index: number) => entry.name ?? `${index + 1}`;

function describeParam(name: string, spec: ParamSpec) {
  return {
    name,
    spec,
    type: paramType(spec),
    defaultValue: typeof spec.default === 'function' ? undefined : spec.default,
    computedDefault: typeof spec.default === 'function',
    description: spec.description,
    values: spec.values,
  };
}

type ParamField = ReturnType<typeof describeParam>;

export const SettingsScreen = ({ experiment }: { experiment: Experiment<any> }) => {
  // The form starts from the link the page was opened with
  const [initial] = useState(() => {
    const { includeSubset, excludeSubset, ...values } = urlParams();
    // Defaults computed for each participant are drawn once for the preview, and stay out of the link
    const defaults = resolveParams(experiment.params);
    // Without the link's selection every setting of the timeline is listed, so none of them is taken for a custom param
    const opened = preview(experiment, values, defaults);
    const declared = new Set([
      ...Object.keys(experiment.params ?? {}),
      ...Object.values(opened.settings).flatMap((params) => Object.keys(params)),
    ]);

    const entered: Record<string, string> = {};
    const custom: CustomParam[] = [];
    for (const [name, value] of Object.entries(values)) {
      if (declared.has(name)) entered[name] = asText(value);
      else custom.push({ name, value: asText(value), type: guessType(value) });
    }

    // The trials the link lists are checked, the others unchecked
    const subset = excludeSubset ?? includeSubset;
    const toggled: Record<string, boolean> =
      subset === undefined
        ? {}
        : Object.fromEntries(
            opened.entries.map((entry, index) => [
              entryId(entry, index),
              inSubset(String(subset), index, entry.name),
            ]),
          );

    return {
      defaults,
      entered,
      custom,
      excludeMode: excludeSubset !== undefined,
      toggled,
      base64: new URLSearchParams(window.location.search).has('_b'),
    };
  });

  const [paramValues, setParamValues] = useState<Record<string, string>>(initial.entered);
  const [customParams, setCustomParams] = useState<CustomParam[]>(initial.custom);
  const [copyButtonText, setCopyButtonText] = useState('Copy URL');
  const [useBase64, setUseBase64] = useState(initial.base64);
  const [isExcludeMode, setIsExcludeMode] = useState(initial.excludeMode);
  // Trials checked or unchecked by hand. The others are checked when including and unchecked when
  // excluding, so a trial the params add later runs unless someone takes it out.
  const [toggled, setToggled] = useState<Record<string, boolean>>(initial.toggled);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // The params build the timeline, and the trials selected in it decide which settings apply
  const current = useMemo(() => {
    const entered = Object.fromEntries(
      Object.entries(paramValues).filter(([, value]) => value !== ''),
    );
    const { entries, error } = preview(experiment, entered, initial.defaults);
    const checked = entries.map((entry, index) => toggled[entryId(entry, index)] ?? !isExcludeMode);
    const ids = entries.flatMap((entry, index) => (checked[index] ? [entryId(entry, index)] : []));
    let subset: Record<string, string> = {};
    if (isExcludeMode && ids.length > 0) subset = { excludeSubset: ids.join(',') };
    if (!isExcludeMode && ids.length < entries.length) subset = { includeSubset: ids.join(',') };
    const { settings } = preview(experiment, { ...entered, ...subset }, initial.defaults);
    return { entries, checked, error, subset, settings };
  }, [experiment, paramValues, initial.defaults, toggled, isExcludeMode]);

  const experimentFields = useMemo(
    () =>
      Object.entries((experiment.params ?? {}) as Record<string, ParamSpec>).map(([name, spec]) =>
        describeParam(name, spec),
      ),
    [experiment],
  );

  const settingGroups = useMemo(
    () =>
      Object.entries(current.settings)
        .map(([title, params]) => ({
          title,
          fields: Object.entries(params).map(([name, spec]) => describeParam(name, spec)),
        }))
        .filter((group) => group.fields.length > 0),
    [current.settings],
  );

  const generatedUrl = useMemo(() => {
    const values: Record<string, unknown> = {};
    // Settings of components whose trials are not selected stay out of the link
    for (const { name, spec, defaultValue } of [
      ...experimentFields,
      ...settingGroups.flatMap((group) => group.fields),
    ]) {
      const text = paramValues[name];
      // Values equal to the default stay out of the link
      if (
        text === undefined ||
        text === '' ||
        (defaultValue !== undefined && text === asText(defaultValue))
      ) {
        continue;
      }
      let value: unknown = text;
      if (useBase64) {
        try {
          value = parseParam(name, spec, text);
        } catch {
          // The preview reports the invalid value
        }
      }
      values[name] = value;
    }

    Object.assign(values, current.subset);

    for (const param of customParams) {
      if (param.name && param.value !== '' && !subsetKeys.includes(param.name)) {
        values[param.name] = useBase64 ? parseCustom(param.type, param.value) : param.value;
      }
    }

    const query = !Object.keys(values).length
      ? ''
      : useBase64
        ? `?_b=${btoa(JSON.stringify(values))}`
        : `?${new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]))}`;
    const baseUrl = window.location.pathname.replace(/\/settings$/, '');
    return `${window.location.origin}${baseUrl}${query}`;
  }, [experimentFields, settingGroups, paramValues, customParams, useBase64, current.subset]);

  const handleParamChange = (name: string, value: any) => {
    setParamValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCustomParamChange = (index: number, field: keyof CustomParam, value: string) => {
    setCustomParams((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
      return updated;
    });
  };

  const toggleTrial = (index: number) => {
    const id = entryId(current.entries[index], index);
    setToggled((prev) => ({ ...prev, [id]: !current.checked[index] }));
  };

  const toggleSelectionMode = () => {
    setIsExcludeMode((prev) => !prev);
  };

  const addCustomParam = () => {
    setCustomParams((prev) => [...prev, { name: '', value: '', type: 'string' }]);
  };

  // Filter out custom params that match includeSubset or excludeSubset
  const filteredCustomParams = customParams.filter(
    (param) => param.name !== 'includeSubset' && param.name !== 'excludeSubset',
  );

  const removeCustomParam = (index: number) => {
    setCustomParams((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCopyUrl = () => {
    if (urlInputRef.current) {
      urlInputRef.current.select();
      document.execCommand('copy');
      setCopyButtonText('Copied!');
      setTimeout(() => setCopyButtonText('Copy URL'), 2000);
    }
  };

  const toggleUrlFormat = () => {
    setUseBase64(!useBase64);
  };

  const renderCustomParamInput = (param: CustomParam, index: number) => {
    // Skip rendering for includeSubset and excludeSubset as they're handled separately
    if (param.name === 'includeSubset' || param.name === 'excludeSubset') {
      return null;
    }

    return (
      <div className='grid grid-cols-12 gap-2 items-center mb-2'>
        <div className='col-span-3'>
          <input
            type='text'
            className='block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
            value={param.name}
            onChange={(e) => handleCustomParamChange(index, 'name', e.target.value)}
            placeholder='Parameter name'
          />
        </div>

        <div className='col-span-2'>
          <select
            className='block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md'
            value={param.type}
            onChange={(e) => handleCustomParamChange(index, 'type', e.target.value)}
          >
            <option value='string'>String</option>
            <option value='number'>Number</option>
            <option value='boolean'>Boolean</option>
            <option value='array'>Array</option>
            <option value='json'>JSON</option>
          </select>
        </div>

        <div className='col-span-6'>
          <ParamInput
            type={param.type}
            value={param.value}
            onChange={(value) => handleCustomParamChange(index, 'value', value)}
          />
        </div>

        <div className='col-span-1'>
          <button
            onClick={() => removeCustomParam(index)}
            className='inline-flex cursor-pointer items-center justify-center p-2 border border-transparent rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500'
            aria-label='Remove parameter'
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              className='h-5 w-5'
              viewBox='0 0 20 20'
              fill='currentColor'
            >
              <path
                fillRule='evenodd'
                d='M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z'
                clipRule='evenodd'
              />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  const renderParamRow = (param: ParamField) => (
    <li key={param.name} className='px-4 py-4 sm:px-6'>
      <div className='grid grid-cols-3 gap-6'>
        <div className='col-span-2'>
          <div className='flex flex-col h-full'>
            <div className='flex items-center'>
              <label className='text-base font-medium text-gray-900'>{param.name}</label>
              <span className='ml-2 inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600'>
                {param.type}
              </span>
            </div>
            {param.description && (
              <p className='mt-1 text-sm text-gray-500 flex-grow'>{param.description}</p>
            )}
            {param.defaultValue !== undefined && (
              <p className='mt-auto pt-2 text-xs text-gray-500'>
                Default: <code> {JSON.stringify(param.defaultValue)}</code>
              </p>
            )}
            {param.computedDefault && (
              <p className='mt-auto pt-2 text-xs text-gray-500'>
                Default: computed for each participant
              </p>
            )}
          </div>
        </div>
        <div className='col-span-1 flex items-center'>
          <ParamInput
            type={param.type}
            value={paramValues[param.name] ?? ''}
            onChange={(value) => handleParamChange(param.name, value)}
            values={param.values}
            defaultValue={param.defaultValue}
          />
        </div>
      </div>
    </li>
  );

  return (
    <div className='max-w-4xl mx-auto p-6'>
      <h1 className='text-3xl font-bold mb-4'>Configure a Run</h1>
      <p className='text-gray-700 mb-6'>
        Configure the experiment by setting parameter values below. Fields left empty will be
        assigned their default value. Once configured, you can copy the URL to run the experiment
        with these settings.
      </p>

      <div className='bg-white shadow overflow-hidden sm:rounded-md mb-8'>
        <div className='px-4 py-5 border-b border-gray-200 sm:px-6'>
          <h2 className='text-lg font-medium text-gray-900'>Experiment Parameters</h2>
          <p className='mt-1 text-sm text-gray-500'>
            The experiment's own parameters.
          </p>
        </div>
        {experimentFields.length === 0 ? (
          <p className='px-4 py-5 sm:px-6 text-sm text-gray-500 italic'>
            This experiment declares no parameters.
          </p>
        ) : (
          <ul className='divide-y divide-gray-200'>{experimentFields.map(renderParamRow)}</ul>
        )}
      </div>

      {current.error !== undefined && (
        <div className='bg-red-50 border border-red-200 text-red-800 sm:rounded-md p-4 mb-8 text-sm'>
          These parameters do not build a timeline: {current.error}
        </div>
      )}

      <div className='bg-white shadow overflow-hidden sm:rounded-md mb-8'>
        <div className='px-4 py-5 border-b border-gray-200 sm:px-6'>
          <h2 className='text-lg font-medium text-gray-900'>Settings</h2>
          <p className='mt-1 text-sm text-gray-500'>
            General settings, and those of the components in the selected trials.
          </p>
        </div>
        {settingGroups.map((group) => (
          <div key={group.title} className='border-b border-gray-200 last:border-b-0'>
            <h3 className='px-4 pt-4 sm:px-6 text-sm font-semibold text-gray-700'>{group.title}</h3>
            <ul className='divide-y divide-gray-200'>{group.fields.map(renderParamRow)}</ul>
          </div>
        ))}
      </div>

      <div className='bg-white shadow overflow-hidden sm:rounded-md mb-8'>
        <div className='px-4 py-5 border-b border-gray-200 sm:px-6'>
          <div className='flex justify-between items-center'>
            <div>
              <h2 className='text-lg font-medium text-gray-900'>Custom Parameters</h2>
              <p className='mt-1 text-sm text-gray-500'>
                Add any additional parameters to be stored in the data for this run.
              </p>
            </div>
            <button
              onClick={addCustomParam}
              className='inline-flex cursor-pointer items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'
            >
              <svg
                xmlns='http://www.w3.org/2000/svg'
                className='-ml-1 mr-2 h-5 w-5'
                viewBox='0 0 20 20'
                fill='currentColor'
              >
                <path
                  fillRule='evenodd'
                  d='M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z'
                  clipRule='evenodd'
                />
              </svg>
              Add Parameter
            </button>
          </div>
        </div>

        <div className='px-4 py-5 sm:px-6'>
          {filteredCustomParams.length === 0 ? (
            <p className='text-sm text-gray-500 italic'>
              No custom parameters added. Click "Add Parameter" to create one.
            </p>
          ) : (
            <div>
              <div className='grid grid-cols-12 gap-2 mb-2'>
                <div className='col-span-3'>
                  <label className='block text-xs font-medium text-gray-500'>PARAMETER NAME</label>
                </div>
                <div className='col-span-2'>
                  <label className='block text-xs font-medium text-gray-500'>TYPE</label>
                </div>
                <div className='col-span-6'>
                  <label className='block text-xs font-medium text-gray-500'>VALUE</label>
                </div>
                <div className='col-span-1'></div>
              </div>
              {filteredCustomParams.map((param, index) => (
                <div key={index}>{renderCustomParamInput(param, index)}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {current.entries.length > 0 && (
        <div className='bg-white shadow overflow-hidden sm:rounded-md mb-8'>
          <div className='px-4 py-5 border-b border-gray-200 sm:px-6'>
            <div className='flex justify-between items-center'>
              <div>
                <h2 className='text-lg font-medium text-gray-900'>Trial Selection</h2>
                <p className='mt-1 text-sm text-gray-500'>
                  Select which trials to include or exclude from the experiment.
                </p>
              </div>
              <div className='flex items-center'>
                <button
                  onClick={toggleSelectionMode}
                  className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${isExcludeMode ? 'bg-red-600' : 'bg-green-600'}`}
                  role='switch'
                  aria-checked={isExcludeMode}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${isExcludeMode ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
                <span className='ml-2 text-sm text-gray-600'>
                  {isExcludeMode ? 'Exclude mode' : 'Include mode'}
                </span>
              </div>
            </div>
          </div>

          <div className='px-4 py-5 sm:px-6'>
            <p className='mb-4 text-sm font-medium text-gray-500'>
              {isExcludeMode
                ? 'Check trials you want to EXCLUDE from the experiment'
                : 'Check trials you want to INCLUDE in the experiment'}
            </p>

            <div className='border border-gray-200 rounded-md overflow-hidden'>
              <ul className='divide-y divide-gray-200'>
                {current.entries.map(
                  (trial: { name?: string; type: string }, index: number) => (
                    <li
                      key={index}
                      className='cursor-pointer px-4 py-3 hover:bg-gray-50'
                      onClick={(e) => {
                        // Check if the click was on or within the checkbox or label
                        if (
                          (e.target as any).type !== 'checkbox' &&
                          !(e.target as any).closest('label')
                        ) {
                          toggleTrial(index);
                        }
                      }}
                    >
                      <div className='flex items-center'>
                        <div className='flex items-center flex-grow'>
                          <input
                            id={`trial-${index}`}
                            type='checkbox'
                            className='h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer'
                            checked={current.checked[index]}
                            onChange={() => toggleTrial(index)}
                          />
                          <label
                            htmlFor={`trial-${index}`}
                            className='ml-3 flex-grow flex items-center cursor-pointer'
                          >
                            <div className='w-8 text-center text-xs text-gray-500 font-medium'>
                              #{index + 1}
                            </div>
                            <div className='flex-grow'>
                              {trial.name ? (
                                <span className='font-medium text-gray-900'>{trial.name}</span>
                              ) : (
                                <span className='font-medium text-gray-500'>{trial.type}</span>
                              )}
                            </div>
                            <div className='ml-2'>
                              <span className='inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800'>
                                {trial.type}
                              </span>
                            </div>
                          </label>
                        </div>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className='bg-white shadow sm:rounded-md p-6 mb-8'>
        <div className='flex justify-between items-center mb-4'>
          <h2 className='text-lg font-medium'>Generated URL</h2>
          <div className='flex items-center'>
            <button
              onClick={toggleUrlFormat}
              className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${useBase64 ? 'bg-blue-600' : 'bg-gray-200'}`}
              role='switch'
              aria-checked={useBase64}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${useBase64 ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
            <span className='ml-2 text-sm text-gray-600'>
              {useBase64 ? 'Base64 Encoded' : 'Plain Parameters'}
            </span>
          </div>
        </div>
        <div className='flex flex-col md:flex-row gap-3'>
          <input
            ref={urlInputRef}
            type='text'
            className='flex-grow px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
            value={generatedUrl}
            readOnly
          />
          <button
            onClick={handleCopyUrl}
            className='inline-flex cursor-pointer justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
          >
            {copyButtonText}
          </button>
        </div>
        {useBase64 && (
          <p className='mt-4 text-sm text-gray-600'>
            <span className='font-medium'>Note:</span> Base64 encoding combines all parameters into
            a single "_b" parameter, creating shorter URLs that hide parameter details.
          </p>
        )}
      </div>

      <div className='flex justify-center'>
        <a
          href={generatedUrl}
          className='inline-flex justify-center py-4 px-5 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500'
        >
          Launch Experiment with these Settings
        </a>
      </div>
    </div>
  );
};
