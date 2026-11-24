import { type ReactNode, useMemo, useRef, useState } from 'react';
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
import { fieldClass, ParamInput, Switch } from './paraminput';

const buttonClass =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900';
const secondaryButton = `${buttonClass} border-neutral-300 bg-white px-4 py-2 text-neutral-900 hover:bg-neutral-100`;
const primaryButton = `${buttonClass} border-neutral-900 bg-neutral-900 px-5 py-3 text-white hover:bg-neutral-700`;
const errorClass = 'mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800';

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
  };
}

type ParamField = ReturnType<typeof describeParam>;

function describeDefault(spec: ParamSpec) {
  if (spec.defaultDescription !== undefined) return spec.defaultDescription;
  if (spec.random) return 'drawn at random for each participant';
  if (typeof spec.default === 'function') return 'computed for each participant';
  return <code>{JSON.stringify(spec.default)}</code>;
}

const fieldsOf = (params: Record<string, ParamSpec> = {}) =>
  Object.entries(params).map(([name, spec]) => describeParam(name, spec));

const namesOf = (fields: ParamField[]) =>
  new Intl.ListFormat('en').formatToParts(fields.map((field) => field.name)).map((part) =>
    part.type === 'element' ? <code key={part.value}>{part.value}</code> : part.value,
  );

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className='mb-6 overflow-hidden rounded-xl border border-neutral-200 bg-white'>
      <div className='flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-5'>
        <div>
          <h2 className='font-besley text-lg font-medium text-neutral-900'>{title}</h2>
          {description && <p className='mt-1 text-sm text-neutral-500'>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

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

    return {
      defaults,
      entered,
      custom,
      excluded: String(excludeSubset ?? '').split(',').filter(Boolean),
      base64: new URLSearchParams(window.location.search).has('_b'),
    };
  });

  const [paramValues, setParamValues] = useState<Record<string, string>>(initial.entered);
  const [customParams, setCustomParams] = useState<CustomParam[]>(initial.custom);
  const [copied, setCopied] = useState(false);
  const [useBase64, setUseBase64] = useState(initial.base64);
  // The names and positions of the trials and blocks left out, as the link lists them
  const [excluded, setExcluded] = useState<string[]>(initial.excluded);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // The params build the timeline, and the trials selected in it decide which settings apply
  const current = useMemo(() => {
    const entered = Object.fromEntries(
      Object.entries(paramValues).filter(([, value]) => value !== ''),
    );
    const { entries, error } = preview(experiment, entered, initial.defaults);
    const subset: Record<string, string> = excluded.length > 0 ? { excludeSubset: excluded.join(',') } : {};
    const { settings, problems } = preview(experiment, { ...entered, ...subset }, initial.defaults);
    return { entries, error, problems, subset, settings };
  }, [experiment, paramValues, initial.defaults, excluded]);

  const isExcluded = (entry: EntryInfo) => excluded.includes(entry.id) || excluded.includes(entry.position);
  const leftOut = (entries: EntryInfo[]): EntryInfo[] =>
    entries.flatMap((entry) => (isExcluded(entry) ? leavesOf([entry]) : leftOut(entry.children ?? [])));
  const unchecked = leftOut(current.entries);

  const setChecked = (leaves: EntryInfo[], checked: boolean) => {
    const ids = leaves.map((leaf) => leaf.id);
    const others = unchecked.map((leaf) => leaf.id).filter((id) => !ids.includes(id));
    // What is left out of other timelines stays
    const inTimeline = rowsOf(current.entries).flatMap((row) =>
      'entry' in row ? [row.entry.id, row.entry.position] : [],
    );
    const elsewhere = excluded.filter((id) => !inTimeline.includes(id));
    setExcluded([...new Set([...elsewhere, ...others, ...(checked ? [] : ids)])]);
  };

  const experimentFields = fieldsOf(experiment.params);
  const shownFields = experimentFields.filter((field) => !field.spec.hidden);

  // Until these are set, every participant can get other trials, so none are shown
  const unsetFields =
    typeof experiment.timeline === 'function'
      ? experimentFields.filter((field) => field.defaultValue === undefined && !paramValues[field.name])
      : [];
  const trialsKnown = unsetFields.length === 0;
  const unsetHidden = unsetFields.filter((field) => field.spec.hidden);

  const { General, ...ofComponents } = current.settings;
  const generalFields = fieldsOf(General);
  const componentGroups = trialsKnown
    ? Object.entries(ofComponents).map(([title, params]) => ({ title, fields: fieldsOf(params) }))
    : [];

  const generatedUrl = (() => {
    const values: Record<string, unknown> = {};
    const fields = [...experimentFields, ...generalFields, ...componentGroups.flatMap((group) => group.fields)];
    for (const [name, text] of Object.entries(paramValues)) {
      const field = fields.find((field) => field.name === name);
      // Settings of components whose trials are not selected stay out of the link, once the trials are known
      if (text === '' || (!field && trialsKnown)) continue;
      // Values equal to the default stay out of the link
      if (field?.defaultValue !== undefined && text === asText(field.defaultValue)) continue;
      let value: unknown = text;
      if (field && useBase64) {
        try {
          value = parseParam(name, field.spec, text);
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
          className={fieldClass}
          value={param.name}
          onChange={(e) => handleCustomParamChange(index, 'name', e.target.value)}
          placeholder='Parameter name'
        />
      </div>

      <div className='col-span-8'>
        <input
          type='text'
          className={fieldClass}
          value={param.value}
          onChange={(e) => handleCustomParamChange(index, 'value', e.target.value)}
          placeholder='Value'
        />
      </div>

      <div className='col-span-1 flex justify-end'>
        <button
          onClick={() => setCustomParams((prev) => prev.filter((_, i) => i !== index))}
          className='inline-flex cursor-pointer items-center justify-center rounded-lg p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-neutral-900'
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
    <li key={param.name} className='px-6 py-4'>
      <div className='grid grid-cols-3 gap-6'>
        <div className='col-span-2'>
          <div className='flex flex-col h-full'>
            <div className='flex items-center'>
              <label className='text-base font-medium text-neutral-900'>{param.name}</label>
              <span className='ml-2 inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-600'>
                {param.type}
              </span>
            </div>
            {param.spec.description && (
              <p className='mt-1 text-sm text-neutral-500 flex-grow'>{param.spec.description}</p>
            )}
            <p className='mt-auto pt-2 text-xs text-neutral-500'>Default: {describeDefault(param.spec)}</p>
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
      <h1 className='font-besley text-2xl font-semibold mb-4'>Configure a Run</h1>
      <p className='text-neutral-600 mb-6'>
        Configure the experiment by setting parameter values below. Fields left empty will be
        assigned their default value. Once configured, you can copy the URL to run the experiment
        with these settings.
      </p>

      <Section title='Experiment Parameters' description="The experiment's own parameters.">
        {shownFields.length === 0 ? (
          <p className='px-6 py-5 text-sm text-neutral-500'>This experiment has no parameters to set.</p>
        ) : (
          <ul className='divide-y divide-neutral-200'>{shownFields.map(renderParamRow)}</ul>
        )}
      </Section>

      {current.error !== undefined && (
        <div className={errorClass}>These parameters do not build a timeline: {current.error}</div>
      )}

      {current.problems.length > 0 && (
        <div className={errorClass}>Participants could not start with this link: {current.problems.join(' ')}</div>
      )}

      {generalFields.length > 0 && (
        <Section title='General Settings' description='The settings that every experiment has.'>
          <ul className='divide-y divide-neutral-200'>{generalFields.map(renderParamRow)}</ul>
        </Section>
      )}

      <Section
        title='Custom Parameters'
        description='Add any additional parameters to be stored in the data for this run.'
        action={
          <button
            onClick={() => setCustomParams((prev) => [...prev, { name: '', value: '' }])}
            className={secondaryButton}
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
        }
      >
        <div className='px-6 py-5'>
          {customParams.length === 0 ? (
            <p className='text-sm text-neutral-500'>
              No custom parameters added. Click "Add Parameter" to create one.
            </p>
          ) : (
            <div>
              <div className='grid grid-cols-12 gap-2 mb-2'>
                <div className='col-span-3'>
                  <label className='block text-xs font-medium text-neutral-500'>PARAMETER NAME</label>
                </div>
                <div className='col-span-8'>
                  <label className='block text-xs font-medium text-neutral-500'>VALUE</label>
                </div>
                <div className='col-span-1'></div>
              </div>
              {customParams.map(renderCustomParamInput)}
            </div>
          )}
        </div>
      </Section>

      {!trialsKnown && (
        <Section title='Trial Selection'>
          <div className='px-6 py-5 text-sm'>
            <p className='text-neutral-900'>
              {unsetHidden.length > 0 ? (
                <>The trials and their settings depend on {namesOf(unsetHidden)}, which this page hides.</>
              ) : (
                <>Set {namesOf(unsetFields)} above to see the trials and their settings.</>
              )}
            </p>
            <p className='mt-1 text-neutral-500'>Both depend on values that are computed for each participant.</p>
          </div>
        </Section>
      )}

      {trialsKnown && current.entries.length > 0 && (
        <Section
          title='Trial Selection'
          description='The checked trials run. A trial that other parameter values add runs too.'
        >
          <ul className='divide-y divide-neutral-200'>
            {rowsOf(current.entries).map((row) => {
              const indent = { paddingLeft: `${24 + row.depth * 24}px` };
              if ('elseAt' in row) {
                return (
                  <li key={`else-${row.elseAt}`} style={indent} className='py-1 text-xs font-medium text-neutral-400'>
                    else
                  </li>
                );
              }
              const { entry } = row;
              const leaves = leavesOf([entry]);
              const checked = leaves.filter((leaf) => !unchecked.includes(leaf)).length;
              const label = (
                <>
                  <div className='ml-3 w-12 text-xs text-neutral-500 font-medium'>#{entry.position}</div>
                  <div className='flex-grow'>
                    {entry.name ? (
                      <span className='font-medium text-neutral-900'>{entry.name}</span>
                    ) : (
                      <span className='font-medium text-neutral-500'>{entry.type}</span>
                    )}
                  </div>
                  <span className='ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700'>
                    {entry.type}
                  </span>
                </>
              );
              // Markers, and blocks that hold nothing else, always stay
              if (leaves.length === 0) {
                return (
                  <li key={entry.position} style={indent} className='flex items-center pr-6 py-3 text-neutral-500'>
                    <div className='h-4 w-4' />
                    {label}
                  </li>
                );
              }
              // A block's box stands for everything in it
              return (
                <li key={entry.position} className='hover:bg-neutral-50'>
                  <label style={indent} className='flex items-center pr-6 py-3 cursor-pointer'>
                    <input
                      type='checkbox'
                      className='h-4 w-4 accent-neutral-900 cursor-pointer'
                      checked={checked === leaves.length}
                      ref={(input) => {
                        if (input) input.indeterminate = checked > 0 && checked < leaves.length;
                      }}
                      onChange={() => setChecked(leaves, checked < leaves.length)}
                    />
                    {label}
                  </label>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {componentGroups.length > 0 && (
        <Section title='Component Settings' description='The settings of the components in the selected trials.'>
          {componentGroups.map((group) => (
            <div key={group.title} className='border-b border-neutral-200 last:border-b-0'>
              <h3 className='px-6 pt-4 text-sm font-semibold text-neutral-700'>{group.title}</h3>
              <ul className='divide-y divide-neutral-200'>{group.fields.map(renderParamRow)}</ul>
            </div>
          ))}
        </Section>
      )}

      <Section
        title='Generated URL'
        action={
          <div className='flex items-center'>
            <Switch on={useBase64} onClick={() => setUseBase64((prev) => !prev)} />
            <span className='ml-2 text-sm text-neutral-600'>
              {useBase64 ? 'Base64 Encoded' : 'Plain Parameters'}
            </span>
          </div>
        }
      >
        <div className='px-6 py-5'>
          <div className='flex flex-col md:flex-row gap-3'>
            <input ref={urlInputRef} type='text' className={fieldClass} value={generatedUrl} readOnly />
            <button onClick={handleCopyUrl} className={secondaryButton}>
              {copied ? 'Copied!' : 'Copy URL'}
            </button>
          </div>
          {useBase64 && (
            <p className='mt-4 text-sm text-neutral-600'>
              <span className='font-medium'>Note:</span> Base64 encoding combines all parameters into
              a single "_b" parameter, creating shorter URLs that hide parameter details.
            </p>
          )}
        </div>
      </Section>

      <div className='flex justify-center'>
        <a href={generatedUrl} className={primaryButton}>
          Launch Experiment with these Settings
        </a>
      </div>
    </div>
  );
};
