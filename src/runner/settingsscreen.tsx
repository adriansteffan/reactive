import { useMemo, useRef, useState } from 'react';
import { type Experiment, previewTimeline } from '../core/experiment';
import type { EntryInfo } from '../core/timeline';
import {
  libraryParams,
  type ParamSpec,
  paramType,
  parseParam,
  resolveParams,
  urlParams,
} from '../core/params';
import { ParamInput, Switch } from './paraminput';

// A param the experiment does not declare, which a run only records
type CustomParam = { name: string; value: string };

// How a value appears in a text field
const asText = (value: unknown) =>
  typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);

// When the entered values do not build a timeline, the library's params are still listed
function preview(
  experiment: Experiment<any>,
  url: Record<string, unknown>,
  defaults: Record<string, unknown>,
) {
  try {
    return { ...previewTimeline(experiment, url, defaults), error: undefined };
  } catch (error) {
    return { entries: [] as EntryInfo[], settings: { General: libraryParams }, problems: [], error: (error as Error).message };
  }
}

// What the checkboxes stand for: trials, and blocks without items. Markers always stay, so that no ifGoto loses its target.
const leavesOf = (entries: EntryInfo[]): EntryInfo[] =>
  entries.flatMap((entry) => (entry.children ? leavesOf(entry.children) : entry.type === 'marker' ? [] : [entry]));

// The rows of the trial list: every entry under the block it sits in, with a line where an else arm starts
type Row = { entry: EntryInfo; depth: number } | { elseAt: string; depth: number };
const rowsOf = (entries: EntryInfo[], depth = 0): Row[] =>
  entries.flatMap((entry, i) => [
    ...(entry.arm === 'else' && entries[i - 1]?.arm !== 'else' ? [{ elseAt: entry.position, depth }] : []),
    { entry, depth },
    ...rowsOf(entry.children ?? [], depth + 1),
  ]);

function describeParam(name: string, spec: ParamSpec) {
  return {
    name,
    spec,
    type: paramType(spec),
    defaultValue: typeof spec.default === 'function' ? undefined : spec.default,
    computedDefault: typeof spec.default === 'function',
  };
}

type ParamField = ReturnType<typeof describeParam>;

export const SettingsScreen = ({ experiment }: { experiment: Experiment<any> }) => {
  // The form starts from the link the page was opened with
  const [initial] = useState(() => {
    const { excludeSubset, ...values } = urlParams();
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
      else custom.push({ name, value: asText(value) });
    }

    // The trials the link leaves out are unchecked, with all those in a block it leaves out
    const excluded = new Set(String(excludeSubset ?? '').split(','));
    const leftOut = (entries: EntryInfo[]): EntryInfo[] =>
      entries.flatMap((entry) =>
        excluded.has(entry.id) || excluded.has(entry.position) ? leavesOf([entry]) : leftOut(entry.children ?? []),
      );
    const toggled: Record<string, boolean> = Object.fromEntries(leftOut(opened.entries).map((leaf) => [leaf.id, false]));

    return {
      defaults,
      entered,
      custom,
      toggled,
      base64: new URLSearchParams(window.location.search).has('_b'),
    };
  });

  const [paramValues, setParamValues] = useState<Record<string, string>>(initial.entered);
  const [customParams, setCustomParams] = useState<CustomParam[]>(initial.custom);
  const [copied, setCopied] = useState(false);
  const [useBase64, setUseBase64] = useState(initial.base64);
  // Trials checked or unchecked by hand. The others are checked, so a trial the params add later
  // runs unless someone takes it out.
  const [toggled, setToggled] = useState<Record<string, boolean>>(initial.toggled);
  const runs = (leaf: EntryInfo) => toggled[leaf.id] ?? true;
  const urlInputRef = useRef<HTMLInputElement>(null);

  // The params build the timeline, and the trials selected in it decide which settings apply
  const current = useMemo(() => {
    const entered = Object.fromEntries(
      Object.entries(paramValues).filter(([, value]) => value !== ''),
    );
    const { entries, error } = preview(experiment, entered, initial.defaults);
    const unchecked = [...new Set(leavesOf(entries).filter((leaf) => !(toggled[leaf.id] ?? true)).map((leaf) => leaf.id))];
    const subset: Record<string, string> = unchecked.length > 0 ? { excludeSubset: unchecked.join(',') } : {};
    const { settings, problems } = preview(experiment, { ...entered, ...subset }, initial.defaults);
    return { entries, error, problems, subset, settings };
  }, [experiment, paramValues, initial.defaults, toggled]);

  const experimentFields = Object.entries((experiment.params ?? {}) as Record<string, ParamSpec>).map(
    ([name, spec]) => describeParam(name, spec),
  );

  // Params left to a default computed for each participant, which the preview draws once
  const drawnFields = experimentFields.filter((field) => field.computedDefault && !paramValues[field.name]);

  const settingGroups = Object.entries(current.settings)
    .map(([title, params]) => ({
      title,
      fields: Object.entries(params).map(([name, spec]) => describeParam(name, spec)),
    }))
    .filter((group) => group.fields.length > 0);

  const generatedUrl = (() => {
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
      if (param.name && param.value !== '' && param.name !== 'excludeSubset') {
        values[param.name] = param.value;
      }
    }

    const query = !Object.keys(values).length
      ? ''
      : useBase64
        ? `?_b=${btoa(JSON.stringify(values))}`
        : `?${new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]))}`;
    const baseUrl = window.location.pathname.replace(/\/settings$/, '');
    return `${window.location.origin}${baseUrl}${query}`;
  })();

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

  const handleCopyUrl = () => {
    if (urlInputRef.current) {
      urlInputRef.current.select();
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const renderCustomParamInput = (param: CustomParam, index: number) => (
    <div key={index} className='grid grid-cols-12 gap-2 items-center mb-2'>
      <div className='col-span-3'>
        <input
          type='text'
          className='block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
          value={param.name}
          onChange={(e) => handleCustomParamChange(index, 'name', e.target.value)}
          placeholder='Parameter name'
        />
      </div>

      <div className='col-span-8'>
        <ParamInput
          type='string'
          value={param.value}
          onChange={(value) => handleCustomParamChange(index, 'value', value)}
        />
      </div>

      <div className='col-span-1'>
        <button
          onClick={() => setCustomParams((prev) => prev.filter((_, i) => i !== index))}
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
            {param.spec.description && (
              <p className='mt-1 text-sm text-gray-500 flex-grow'>{param.spec.description}</p>
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
            onChange={(value) => setParamValues((prev) => ({ ...prev, [param.name]: value }))}
            values={param.spec.values}
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

      {drawnFields.length > 0 && (
        <div className='bg-amber-50 border border-amber-200 text-amber-900 sm:rounded-md p-4 mb-8 text-sm'>
          The settings and trials below are for{' '}
          {drawnFields.map((field, index) => (
            <span key={field.name}>
              {index > 0 && ', '}
              <code>{field.name}</code> = <code>{JSON.stringify(initial.defaults[field.name])}</code>
            </span>
          ))}
          , drawn at random for this page. Each participant gets values of their own, which can build other
          trials; choose a value above to see the trials it builds.
        </div>
      )}

      {current.error !== undefined && (
        <div className='bg-red-50 border border-red-200 text-red-800 sm:rounded-md p-4 mb-8 text-sm'>
          These parameters do not build a timeline: {current.error}
        </div>
      )}

      {current.problems.length > 0 && (
        <div className='bg-red-50 border border-red-200 text-red-800 sm:rounded-md p-4 mb-8 text-sm'>
          Participants could not start with this link: {current.problems.join(' ')}
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
              onClick={() => setCustomParams((prev) => [...prev, { name: '', value: '' }])}
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
          {customParams.length === 0 ? (
            <p className='text-sm text-gray-500 italic'>
              No custom parameters added. Click "Add Parameter" to create one.
            </p>
          ) : (
            <div>
              <div className='grid grid-cols-12 gap-2 mb-2'>
                <div className='col-span-3'>
                  <label className='block text-xs font-medium text-gray-500'>PARAMETER NAME</label>
                </div>
                <div className='col-span-8'>
                  <label className='block text-xs font-medium text-gray-500'>VALUE</label>
                </div>
                <div className='col-span-1'></div>
              </div>
              {customParams.map(renderCustomParamInput)}
            </div>
          )}
        </div>
      </div>

      {current.entries.length > 0 && (
        <div className='bg-white shadow overflow-hidden sm:rounded-md mb-8'>
          <div className='px-4 py-5 border-b border-gray-200 sm:px-6'>
            <h2 className='text-lg font-medium text-gray-900'>Trial Selection</h2>
            <p className='mt-1 text-sm text-gray-500'>
              The checked trials run. A trial that other parameter values add runs too.
            </p>
          </div>

          <div className='px-4 py-5 sm:px-6'>

            <div className='border border-gray-200 rounded-md overflow-hidden'>
              <ul className='divide-y divide-gray-200'>
                {rowsOf(current.entries).map((row) => {
                  const indent = { paddingLeft: `${16 + row.depth * 24}px` };
                  if ('elseAt' in row) {
                    return (
                      <li key={`else-${row.elseAt}`} style={indent} className='py-1 text-xs font-medium text-gray-400'>
                        else
                      </li>
                    );
                  }
                  const { entry } = row;
                  const leaves = leavesOf([entry]);
                  const running = leaves.filter(runs).length;
                  const label = (
                    <>
                      <div className='ml-3 w-12 text-xs text-gray-500 font-medium'>#{entry.position}</div>
                      <div className='flex-grow'>
                        {entry.name ? (
                          <span className='font-medium text-gray-900'>{entry.name}</span>
                        ) : (
                          <span className='font-medium text-gray-500'>{entry.type}</span>
                        )}
                      </div>
                      <span className='ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800'>
                        {entry.type}
                      </span>
                    </>
                  );
                  // Markers, and blocks that hold nothing else, always stay
                  if (leaves.length === 0) {
                    return (
                      <li key={entry.position} style={indent} className='flex items-center pr-4 py-3 text-gray-500'>
                        <div className='h-4 w-4' />
                        {label}
                      </li>
                    );
                  }
                  // A block's box stands for everything in it
                  return (
                    <li key={entry.position} className='hover:bg-gray-50'>
                      <label style={indent} className='flex items-center pr-4 py-3 cursor-pointer'>
                        <input
                          type='checkbox'
                          className='h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer'
                          checked={running === leaves.length}
                          ref={(input) => {
                            if (input) input.indeterminate = running > 0 && running < leaves.length;
                          }}
                          onChange={() =>
                            setToggled((prev) => ({
                              ...prev,
                              ...Object.fromEntries(leaves.map((leaf) => [leaf.id, running < leaves.length])),
                            }))
                          }
                        />
                        {label}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className='bg-white shadow sm:rounded-md p-6 mb-8'>
        <div className='flex justify-between items-center mb-4'>
          <h2 className='text-lg font-medium'>Generated URL</h2>
          <div className='flex items-center'>
            <Switch on={useBase64} onClick={() => setUseBase64((prev) => !prev)} />
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
            {copied ? 'Copied!' : 'Copy URL'}
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
