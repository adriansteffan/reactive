import { BaseComponentProps } from '../core/component';
import React, { useState } from 'react';
import { defineComponent } from '../core/component';
import { t, useTheme } from '../runner/theme';
import type { ExperimentStore } from '../core/store';

interface BaseFieldConfig {
  type: 'string' | 'integer' | 'float' | 'boolean';
  storeKey: string;
  label: string;
  prompt?: string;
  validate?: (value: any) => boolean | string;
  defaultValue?: any;
  component?: React.ComponentType<{ value: any }>;
}

interface StringFieldConfig extends BaseFieldConfig {
  type: 'string';
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
}

interface NumberFieldConfig extends BaseFieldConfig {
  type: 'integer' | 'float';
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

interface BooleanFieldConfig extends BaseFieldConfig {
  type: 'boolean';
  defaultValue?: boolean;
}

type FieldConfig = StringFieldConfig | NumberFieldConfig | BooleanFieldConfig;

type StoreKey = keyof ExperimentStore & string;

// The fields that can write the store key K, whose values are of type V
type FieldsFor<K extends string, V> =
  | (string extends V ? StringFieldConfig & { storeKey: K } : never)
  | (number extends V ? NumberFieldConfig & { storeKey: K } : never)
  | (boolean extends V ? BooleanFieldConfig & { storeKey: K } : never);

/**
 * A field of StoreUI. When the project declares its store (`interface ExperimentStore` in
 * `declare module '@adriansteffan/reactive'`), the types check each field against it: `storeKey`
 * must be one of the store's keys, and the field's `type` must fit that key's values, `'string'`
 * for a string, `'integer'` or `'float'` for a number, `'boolean'` for a boolean. A key whose values
 * are of another type, such as a list, takes no field. Without a declared store, any key is allowed.
 */
export type StoreField = [StoreKey] extends [never] ? FieldConfig : { [K in StoreKey]: FieldsFor<K, ExperimentStore[K]> }[StoreKey];

function buildFieldValues(fields: readonly FieldConfig[], store?: Record<string, any>): Record<string, any> {
  const values: Record<string, any> = {};
  fields.forEach(field => {
    values[field.storeKey] = store?.[field.storeKey] !== undefined ? store[field.storeKey] : field.defaultValue;
  });
  return values;
}

interface StoreUIProps extends BaseComponentProps<Record<string, any>> {
  /** Shown above the fields. */
  content?: React.ReactNode;
  /** The fields, each writing its value to the store under its `storeKey`; see `StoreField` for how the types check them. */
  fields: readonly StoreField[];
  buttonText?: string;
}

function validateField(field: FieldConfig, value: any): string | null {
  if (field.type === 'integer' || field.type === 'float') {
    if (value === undefined || value === null || value === '') {
      return 'This field is required';
    } else if (field.min !== undefined && value < field.min) {
      return `Value must be at least ${field.min}`;
    } else if (field.max !== undefined && value > field.max) {
      return `Value must be at most ${field.max}`;
    }
  } else if (field.type === 'string') {
    // A field nobody has typed in is empty
    const length = (value ?? '').length;
    if (field.minLength !== undefined && length < field.minLength) {
      return `Must be at least ${field.minLength} characters`;
    } else if (field.maxLength !== undefined && length > field.maxLength) {
      return `Must be at most ${field.maxLength} characters`;
    }
  }
  
  if (field.validate) {
    const validationResult = field.validate(value);
    if (validationResult !== true && validationResult !== '') {
      return typeof validationResult === 'string' 
        ? validationResult 
        : 'Invalid value';
    }
  }
  
  return null;
}

function StoreUI({
  next,
  updateStore,
  store,
  content = <h1>Settings</h1>,
  fields: declaredFields,
  buttonText = 'Save Configuration',
}: StoreUIProps) {
  // The fields that the store allows are a few of these; the component handles every kind
  const fields: readonly FieldConfig[] = declaredFields;
  const th = t(useTheme());
  
  const [values, setValues] = useState<Record<string, any>>(() => buildFieldValues(fields, store));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // A field shows its error once the participant has changed it, or tried to save
  const errors = Object.fromEntries(
    fields.flatMap((field) => {
      const error = touched[field.storeKey] ? validateField(field, values[field.storeKey]) : null;
      return error ? [[field.storeKey, error]] : [];
    }),
  );

  const handleChange = (storeKey: string, value: any) => {
    setValues((prev) => ({ ...prev, [storeKey]: value }));
    setTouched((prev) => ({ ...prev, [storeKey]: true }));
  };

  const handleSave = () => {
    setTouched(Object.fromEntries(fields.map((field) => [field.storeKey, true])));
    if (fields.every((field) => validateField(field, values[field.storeKey]) === null)) {
      updateStore(values);
      next(values);
    }
  };

  const hasErrors = Object.keys(errors).length > 0;
  
  return (
    <div className="max-w-prose mx-auto mt-20 mb-20 px-4">
      <article className={th.article}>{content}</article>
      
      <div className="mt-12 space-y-12">
        {fields.map((field) => (
          <div key={field.storeKey} className="space-y-2">
            <label className="block text-xl font-medium text-gray-900">
              {field.label}
              {(field.type === 'integer' || field.type === 'float') && field.min !== undefined && field.max !== undefined &&
                ` (${field.min}-${field.max})`}
            </label>
            
            {field.prompt && (
              <p className="mb-4 text-base text-gray-700 mb-2">
                {field.prompt}
              </p>
            )}
            
            {field.type === 'boolean' && (
              <div className="flex items-center">
                <div 
                  className={`relative cursor-pointer w-10 h-10 flex items-center justify-center border-2 border-black rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ${values[field.storeKey] ? 'bg-blue-600 text-white' : 'bg-white'}`}
                  onClick={() => handleChange(field.storeKey, !values[field.storeKey])}
                >
                  <input
                    type="checkbox"
                    checked={!!values[field.storeKey]}
                    onChange={(e) => handleChange(field.storeKey, e.target.checked)}
                    className="absolute opacity-0 h-0 w-0"
                  />
                  {values[field.storeKey] && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="ml-3 text-lg">Enabled</span>
              </div>
            )}
            
            {(field.type === 'integer' || field.type === 'float') && (
              <div className="flex items-center space-x-4">
                {field.min !== undefined && field.max !== undefined && (
                  <button 
                    onClick={() => handleChange(
                      field.storeKey, 
                      Math.max(
                        field.min || 0, 
                        (values[field.storeKey] || 0) - (field.step || 1)
                      )
                    )}
                    className="cursor-pointer bg-white h-10 w-10 flex items-center justify-center border-2 border-black font-bold text-black text-lg rounded-full shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                  >
                    -
                  </button>
                )}
                
                <input
                  type='text'
                  value={values[field.storeKey] || ''}
                  onChange={(e) => {
                    const rawValue = e.target.value;
                    let parsedValue: number | '' | undefined;
                    
                    if (field.type === 'integer') {
                      parsedValue = rawValue === '' ? '' : parseInt(rawValue, 10);
                    } else if (field.type === 'float') {
                      parsedValue = rawValue === '' ? '' : parseFloat(rawValue);
                    }
                    
                    if (rawValue === '' || (typeof parsedValue === 'number' && !Number.isNaN(parsedValue))) {
                      handleChange(field.storeKey, parsedValue);
                    }
                  }}
                  className="w-24 px-4 py-2 text-center border-2 border-black rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                {field.min !== undefined && field.max !== undefined && (
                  <button 
                    onClick={() => handleChange(
                      field.storeKey, 
                      Math.min(
                        field.max || Infinity, 
                        (values[field.storeKey] || 0) + (field.step || 1)
                      )
                    )}
                    className="cursor-pointer bg-white h-10 w-10 flex items-center justify-center border-2 border-black font-bold text-black text-lg rounded-full shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                  >
                    +
                  </button>
                )}
              </div>
            )}
            
            {field.type === 'string' && (
              <input
                type="text"
                value={values[field.storeKey] || ''}
                onChange={(e) => handleChange(field.storeKey, e.target.value)}
                className="w-full px-4 py-2 border-2 border-black rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            
            {errors[field.storeKey] && touched[field.storeKey] && (
              <div className="text-red-500 text-sm mt-1">
                {errors[field.storeKey]}
              </div>
            )}
            
            {field.component && (
              <div className="mt-4">
                {React.createElement(field.component, { value: values[field.storeKey] })}
              </div>
            )}
          </div>
        ))}
      </div>
      
      <div className="mt-12 flex justify-center">
        <button
          onClick={handleSave}
          disabled={hasErrors}
          className={`${th.button} ${hasErrors ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}

export default defineComponent({
  name: 'StoreUI',
  component: StoreUI,
  csv: 'storeui',
  simulate: ({ props, store }) => {
    const values = buildFieldValues(props.fields || [], store);
    return { responseData: values, storeUpdates: values };
  },
});