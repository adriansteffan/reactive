import { useEffect, useRef, useState } from 'react';

type CustomParam = { name: string; type: string; value: any };
type TimelineRepItem = { type: string; name?: string };

export const SettingsScreen = ({
  paramRegistry,
  timelineRepresentation,
}: {
  paramRegistry: any[];
  timelineRepresentation: TimelineRepItem[];
}) => {
  const [paramValues, setParamValues] = useState<Record<string, any>>({});
  const [customParams, setCustomParams] = useState<CustomParam[]>([]);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copyButtonText, setCopyButtonText] = useState('Copy URL');
  const [useBase64, setUseBase64] = useState(false);
  const [isExcludeMode, setIsExcludeMode] = useState(false);
  const [selectedTrials, setSelectedTrials] = useState<string[]>([]);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const sortedParams = [...paramRegistry]
    .filter((param) => param.name !== 'includeSubset' && param.name !== 'excludeSubset')
    .sort((a, b) => a.name.localeCompare(b.name));

  // Initialize param values from URL if present
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const initialValues: Record<string, any> = {};
    const extractedCustomParams: CustomParam[] = [];

    let initialSelectedTrials: string[] = [];
    let initialIsExcludeMode = false;

    const includeSubset = searchParams.get('includeSubset');
    const excludeSubset = searchParams.get('excludeSubset');

    const urlEncodedJson = searchParams.get('_b');
    if (urlEncodedJson) {
      try {
        const jsonString = atob(urlEncodedJson);
        const decodedParams = JSON.parse(jsonString);

        if (decodedParams.excludeSubset) {
          initialIsExcludeMode = true;
          initialSelectedTrials = decodedParams.excludeSubset.split(',');
        } else if (decodedParams.includeSubset) {
          initialIsExcludeMode = false;
          initialSelectedTrials = decodedParams.includeSubset.split(',');
        }
      } catch {
        // Handle fallback to regular params below

        if (excludeSubset) {
          initialIsExcludeMode = true;
          initialSelectedTrials = excludeSubset.split(',');
        } else if (includeSubset) {
          initialIsExcludeMode = false;
          initialSelectedTrials = includeSubset.split(',');
        }
      }
    } else {
      if (excludeSubset) {
        initialIsExcludeMode = true;
        initialSelectedTrials = excludeSubset.split(',');
      } else if (includeSubset) {
        initialIsExcludeMode = false;
        initialSelectedTrials = includeSubset.split(',');
      }
    }

    setIsExcludeMode(initialIsExcludeMode);
    if (excludeSubset || includeSubset) {
      setSelectedTrials(initialSelectedTrials);
    } else if (timelineRepresentation.length > 0) {
      if (initialIsExcludeMode) {
        setSelectedTrials([]);
      } else {
        setSelectedTrials(
          Array.from({ length: timelineRepresentation.length }, (_, index) =>
            (index + 1).toString(),
          ),
        );
      }
    }

    const encodedJson = searchParams.get('_b');
    if (encodedJson) {
      try {
        const jsonString = atob(encodedJson);
        const decodedParams = JSON.parse(jsonString);

        const registeredParamNames = paramRegistry.map((param) => param.name);

        // Separate registered and custom params
        Object.entries(decodedParams).forEach(([key, value]) => {
          if (registeredParamNames.includes(key)) {
            initialValues[key] = String(value);
          } else if (key !== '_b') {
            // This is a custom param
            extractedCustomParams.push({
              name: key,
              value: typeof value === 'object' ? JSON.stringify(value) : String(value),
              type:
                typeof value === 'boolean'
                  ? 'boolean'
                  : typeof value === 'number'
                    ? 'number'
                    : Array.isArray(value)
                      ? 'array'
                      : typeof value === 'object'
                        ? 'json'
                        : 'string',
            });
          }
        });

        // Set defaults for registered params that weren't in the URL
        paramRegistry.forEach((param) => {
          if (!(param.name in initialValues)) {
            if (param.type === 'boolean' && param.defaultValue !== undefined) {
              initialValues[param.name] = String(param.defaultValue);
            } else {
              initialValues[param.name] = '';
            }
          }
        });

        // Since we found base64 params, set the toggle to true
        setUseBase64(true);
      } catch {
        processRegularParams(searchParams);
      }
    } else {
      processRegularParams(searchParams);
    }

    function processRegularParams(searchParams: URLSearchParams) {
      // Process registered params

      paramRegistry.forEach((param) => {
        const value = searchParams.get(param.name);
        if (value !== null) {
          initialValues[param.name] = value;
        } else if (param.type === 'boolean' && param.defaultValue !== undefined) {
          // For boolean params with defaults, explicitly set them
          initialValues[param.name] = String(param.defaultValue);
        }
      });

      // Extract custom params (any param not in the registry)
      const registeredParamNames = paramRegistry.map((param) => param.name);
      searchParams.forEach((value: string, key: string) => {
        if (!registeredParamNames.includes(key) && key !== '_b') {
          let paramType = 'string';

          // Try to determine the type
          if (value === 'true' || value === 'false') {
            paramType = 'boolean';
          } else if (!isNaN(Number(value))) {
            paramType = 'number';
          } else {
            try {
              const parsed = JSON.parse(value);
              paramType = Array.isArray(parsed) ? 'array' : 'json';
            } catch {
              // It's a string if we can't parse it as JSON
            }
          }

          extractedCustomParams.push({
            name: key,
            value: value,
            type: paramType,
          });
        }
      });
    }

    setParamValues(initialValues);
    setCustomParams(extractedCustomParams);
  }, [paramRegistry]);

  // Generate URL whenever param values, custom params, trials selection, or encoding type changes
  useEffect(() => {
    const baseUrl = window.location.pathname.replace(/\/settings$/, '');
    let queryString = '';

    const allParams: Record<string, any> = { ...paramValues };

    if (selectedTrials.length > 0) {
      if (isExcludeMode) {
        allParams['excludeSubset'] = selectedTrials.sort().join(',');
        delete allParams['includeSubset'];
      } else if (selectedTrials.length != timelineRepresentation.length) {
        allParams['includeSubset'] = selectedTrials.sort().join(',');
        delete allParams['excludeSubset'];
      }
    } else {
      delete allParams['includeSubset'];
      delete allParams['excludeSubset'];
    }

    customParams.forEach((param) => {
      if (
        param.name &&
        param.value !== '' &&
        param.name !== 'includeSubset' &&
        param.name !== 'excludeSubset'
      ) {
        allParams[param.name] = param.value;
      }
    });

    if (useBase64) {
      const paramsObj: Record<string, any> = {};
      Object.entries(allParams).forEach(([key, value]) => {
        if (value !== '') {
          const param = paramRegistry.find((p) => p.name === key);
          const customParam = customParams.find((p) => p.name === key);
          const paramType = param?.type || customParam?.type || 'string';

          if (
            paramType === 'boolean' &&
            param?.defaultValue !== undefined &&
            String(param.defaultValue) === value
          ) {
            return;
          }

          switch (paramType) {
            case 'number':
              paramsObj[key] = Number(value);
              break;
            case 'boolean':
              paramsObj[key] = value === 'true';
              break;
            case 'array':
            case 'json':
              try {
                paramsObj[key] = JSON.parse(value as string);
              } catch {
                paramsObj[key] = value;
              }
              break;
            default:
              paramsObj[key] = value;
          }
        }
      });

      // Create base64 encoded parameter
      const jsonString = JSON.stringify(paramsObj);
      const encodedParams = btoa(jsonString);
      queryString = `?_b=${encodedParams}`;
    } else {
      const searchParams = new URLSearchParams();

      Object.entries(allParams).forEach(([key, value]) => {
        if (value !== '') {
          const param = paramRegistry.find((p) => p.name === key);
          // Skip boolean params that match their default value
          if (
            param?.type === 'boolean' &&
            param.defaultValue !== undefined &&
            String(param.defaultValue) === value
          ) {
            return;
          }
          searchParams.set(key, String(value));
        }
      });

      queryString = searchParams.toString() ? `?${searchParams.toString()}` : '';
    }

    const fullUrl = `${window.location.origin}${baseUrl}${queryString}`;
    setGeneratedUrl(fullUrl);
  }, [paramValues, customParams, useBase64, paramRegistry, selectedTrials, isExcludeMode]);

  const handleParamChange = (name: string, value: any) => {
    setParamValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCustomParamChange = (index: number, field: string, value: any) => {
    setCustomParams((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
      return updated;
    });
  };

  const toggleTrialSelection = (index: number) => {
    const trialIdentifier = `${index + 1}`;

    setSelectedTrials((prev) => {
      const newSelection = prev.includes(trialIdentifier)
        ? prev.filter((id) => id !== trialIdentifier)
        : [...prev, trialIdentifier];

      return newSelection;
    });
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

  const renderParamInput = (param: {
    name: string;
    type: string | undefined;
    defaultValue: any;
  }) => {
    const { name, type, defaultValue } = param;

    // Skip rendering for includeSubset and excludeSubset as they're handled separately
    if (name === 'includeSubset' || name === 'excludeSubset') {
      return null;
    }

    const value = paramValues[name] || '';

    switch (type) {
      case 'boolean':
        return (
          <>
            <button
              onClick={() => handleParamChange(name, value === 'true' ? 'false' : 'true')}
              className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${value === 'true' ? 'bg-blue-600' : 'bg-gray-200'}`}
              role='switch'
              aria-checked={value === 'true'}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${value === 'true' ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
            <span className='ml-4 text-gray-500'>{value === 'true' ? 'True' : 'False'}</span>
          </>
        );

      case 'number':
        return (
          <input
            type='number'
            className='mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
            value={value}
            onChange={(e) => handleParamChange(name, e.target.value)}
            placeholder={
              defaultValue !== undefined ? `Default: ${defaultValue}` : 'Enter number...'
            }
          />
        );

      case 'array':
      case 'json':
        return (
          <textarea
            className='mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
            value={value}
            onChange={(e) => handleParamChange(name, e.target.value)}
            placeholder={
              type === 'array' ? 'Enter comma-separated values or JSON array' : 'Enter JSON object'
            }
            rows={3}
          />
        );

      case 'string':
      default:
        return (
          <input
            type='text'
            className='mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
            value={value}
            onChange={(e) => handleParamChange(name, e.target.value)}
            placeholder={
              defaultValue !== undefined && defaultValue !== ''
                ? `Default: ${defaultValue}`
                : 'Enter value...'
            }
          />
        );
    }
  };

  const renderCustomParamInput = (
    param: { name: string; type: string | undefined; value: any },
    index: number,
  ) => {
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
          {param.type === 'boolean' ? (
            <>
              <button
                onClick={() =>
                  handleCustomParamChange(index, 'value', param.value === 'true' ? 'false' : 'true')
                }
                className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${param.value === 'true' ? 'bg-blue-600' : 'bg-gray-200'}`}
                role='switch'
                aria-checked={param.value === 'true'}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${param.value === 'true' ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </>
          ) : param.type === 'array' || param.type === 'json' ? (
            <textarea
              className='block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
              value={param.value}
              onChange={(e) => handleCustomParamChange(index, 'value', e.target.value)}
              placeholder={
                param.type === 'array'
                  ? 'Enter JSON array [1,2,3]'
                  : 'Enter JSON object {"key":"value"}'
              }
              rows={1}
            />
          ) : param.type === 'number' ? (
            <input
              type='number'
              className='block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
              value={param.value}
              onChange={(e) => handleCustomParamChange(index, 'value', e.target.value)}
              placeholder='Enter number...'
            />
          ) : (
            <input
              type='text'
              className='block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
              value={param.value}
              onChange={(e) => handleCustomParamChange(index, 'value', e.target.value)}
              placeholder='Enter value...'
            />
          )}
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

  return (
    <div className='max-w-4xl mx-auto p-6'>
      <h1 className='text-3xl font-bold mb-4'>Experiment Parameters</h1>
      <p className='text-gray-700 mb-6'>
        Configure the experiment by setting parameter values below. Fields left empty will be
        assigned their default value. Once configured, you can copy the URL to run the experiment
        with these settings.
      </p>

      <div className='bg-white shadow overflow-hidden sm:rounded-md mb-8'>
        <div className='px-4 py-5 border-b border-gray-200 sm:px-6'>
          <h2 className='text-lg font-medium text-gray-900'>Registered Parameters</h2>
          <p className='mt-1 text-sm text-gray-500'>
            Parameters defined in the experiment configuration.
          </p>
        </div>
        <ul className='divide-y divide-gray-200'>
          {sortedParams.map((param) => (
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
                  </div>
                </div>
                <div className='col-span-1 flex items-center'>{renderParamInput(param)}</div>
              </div>
            </li>
          ))}
        </ul>
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

      {timelineRepresentation.length > 0 && (
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
                {timelineRepresentation.map(
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
                          toggleTrialSelection(index);
                        }
                      }}
                    >
                      <div className='flex items-center'>
                        <div className='flex items-center flex-grow'>
                          <input
                            id={`trial-${index}`}
                            type='checkbox'
                            className='h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer'
                            checked={selectedTrials.includes(`${index + 1}`)}
                            onChange={() => toggleTrialSelection(index)}
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
