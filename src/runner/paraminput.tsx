import { ChevronDownIcon } from '../components/icons';
import type { ParamType } from '../core/params';

/** The look of the settings page's text fields and dropdowns. */
export const fieldClass =
  'block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 shadow-xs transition-[border-color,box-shadow] hover:border-neutral-400 focus:border-neutral-500 focus:ring-3 focus:ring-neutral-200 focus:outline-none sm:text-sm';

/** The settings page's on/off switch. */
export function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${on ? 'bg-neutral-900' : 'bg-neutral-200'}`}
      role='switch'
      aria-checked={on}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs transform transition ease-in-out duration-200 ${on ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

/** The settings page's field for a param's value, kept as text; an empty value leaves the param at its default. */
export function ParamInput({
  type,
  value,
  onChange,
  values,
  defaultValue,
  random,
}: {
  type: ParamType;
  value: string;
  onChange: (value: string) => void;
  /** The values the param can take, offered in a dropdown. */
  values?: readonly (string | number)[];
  defaultValue?: unknown;
  /** Each participant gets one of the values at random, unless one is chosen here. */
  random?: boolean;
}) {
  const unset = random
    ? 'Random'
    : defaultValue === undefined || defaultValue === ''
      ? 'Default'
      : `Default: ${defaultValue}`;

  if (values) {
    return (
      <div className='relative w-full'>
        <select
          className={`${fieldClass} cursor-pointer appearance-none truncate pr-9 ${value === '' ? 'text-neutral-400' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value=''>{unset}</option>
          {values.map((option) => (
            <option key={String(option)} value={String(option)} className='text-black'>
              {String(option)}
            </option>
          ))}
        </select>
        <ChevronDownIcon className='pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-neutral-500' />
      </div>
    );
  }

  if (type === 'boolean') {
    // A switch nobody has touched shows the default
    const on = (value || String(defaultValue)) === 'true';
    return (
      <>
        <Switch on={on} onClick={() => onChange(on ? 'false' : 'true')} />
        <span className='ml-4 text-neutral-500'>{on ? 'True' : 'False'}</span>
      </>
    );
  }

  if (type === 'array' || type === 'json') {
    return (
      <textarea
        className={fieldClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={type === 'array' ? 'A JSON array, e.g. [1, 2, 3]' : 'A JSON object, e.g. {"key": "value"}'}
        rows={3}
      />
    );
  }

  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      className={fieldClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={unset}
    />
  );
}
