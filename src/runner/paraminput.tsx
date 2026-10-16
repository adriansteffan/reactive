import type { ParamType } from '../core/params';

const fieldClass =
  'block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm';

/** The settings page's field for a param's value, kept as text; an empty value leaves the param at its default. */
export function ParamInput({
  type,
  value,
  onChange,
  values,
  defaultValue,
}: {
  type: ParamType;
  value: string;
  onChange: (value: string) => void;
  /** The values the param can take, offered in a dropdown. */
  values?: readonly (string | number)[];
  defaultValue?: unknown;
}) {
  if (values) {
    return (
      <select className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value=''>Default</option>
        {values.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }

  if (type === 'boolean') {
    // A switch nobody has touched shows the default
    const on = (value || String(defaultValue)) === 'true';
    return (
      <>
        <button
          type='button'
          onClick={() => onChange(on ? 'false' : 'true')}
          className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${on ? 'bg-blue-600' : 'bg-gray-200'}`}
          role='switch'
          aria-checked={on}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${on ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
        <span className='ml-4 text-gray-500'>{on ? 'True' : 'False'}</span>
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

  const hasDefault = defaultValue !== undefined && defaultValue !== '';
  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      className={fieldClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={hasDefault ? `Default: ${defaultValue}` : 'Enter a value...'}
    />
  );
}
