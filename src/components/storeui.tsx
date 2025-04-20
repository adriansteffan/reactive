import { BaseComponentProps } from '../mod';
import React, { useState, useEffect } from 'react';

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

interface StoreUIProps extends BaseComponentProps {
  title?: string;
  description?: string;
  fields: FieldConfig[];
  saveButtonText?: string;
}

function StoreUI({
  next,
  updateStore,
  store,
  title = 'Settings',
  description,
  fields,
  saveButtonText = 'Save Configuration',
}: StoreUIProps) {
  
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  
  
  useEffect(() => {
    const initialValues: Record<string, any> = {};
    
    fields.forEach(field => {
      
      initialValues[field.storeKey] = 
        store?.[field.storeKey] !== undefined 
          ? store[field.storeKey] 
          : field.defaultValue;
    });
    
    setValues(initialValues);
   
    const initialTouched: Record<string, boolean> = {};
    fields.forEach(field => {
      initialTouched[field.storeKey] = false;
    });
    setTouched(initialTouched);
  }, [store, fields]);
  
  const validateField = (field: FieldConfig, value: any): string | null => {
    if (field.type === 'integer' || field.type === 'float') {
      if (value === undefined || value === null || value === '') {
        return 'This field is required';
      } else if (field.min !== undefined && value < field.min) {
        return `Value must be at least ${field.min}`;
      } else if (field.max !== undefined && value > field.max) {
        return `Value must be at most ${field.max}`;
      }
    } else if (field.type === 'string') {
      if (field.minLength !== undefined && value.length < field.minLength) {
        return `Must be at least ${field.minLength} characters`;
      } else if (field.maxLength !== undefined && value.length > field.maxLength) {
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
  };
  
  useEffect(() => {
    const newErrors: Record<string, string> = {};
    
    fields.forEach(field => {
      const value = values[field.storeKey];
      
      if (!touched[field.storeKey]) return;
      
      const error = validateField(field, value);
      if (error) {
        newErrors[field.storeKey] = error;
      }
    });
    
    setErrors(newErrors);
  }, [values, fields, touched]);
  
  const handleChange = (storeKey: string, value: any) => {
    setValues(prev => ({
      ...prev,
      [storeKey]: value
    }));
    
    setTouched(prev => ({
      ...prev,
      [storeKey]: true
    }));
  };
  
  const handleSave = () => {
    const allTouched: Record<string, boolean> = {};
    fields.forEach(field => {
      allTouched[field.storeKey] = true;
    });
    setTouched(allTouched);
    
    const newErrors: Record<string, string> = {};
    fields.forEach(field => {
      const value = values[field.storeKey];
      

      if (field.type === 'integer' || field.type === 'float') {
        if (value === undefined || value === null || value === '') {
          newErrors[field.storeKey] = 'This field is required';
        } else if (field.min !== undefined && value < field.min) {
          newErrors[field.storeKey] = `Value must be at least ${field.min}`;
        } else if (field.max !== undefined && value > field.max) {
          newErrors[field.storeKey] = `Value must be at most ${field.max}`;
        }
      } else if (field.type === 'string') {
        if (field.minLength !== undefined && value.length < field.minLength) {
          newErrors[field.storeKey] = `Must be at least ${field.minLength} characters`;
        } else if (field.maxLength !== undefined && value.length > field.maxLength) {
          newErrors[field.storeKey] = `Must be at most ${field.maxLength} characters`;
        }
      }
      
      if (field.validate && !newErrors[field.storeKey]) {
        const validationResult = field.validate(value);
        if (validationResult !== true && validationResult !== '') {
          newErrors[field.storeKey] = typeof validationResult === 'string' 
            ? validationResult 
            : 'Invalid value';
        }
      }
    });
    
    setErrors(newErrors);
    
    if (Object.keys(newErrors).length === 0) {
      updateStore(values);
      next(values);
    }
  };

  const hasErrors = Object.keys(errors).length > 0;
  
  return (
    <div className="max-w-prose mx-auto mt-20 mb-20 px-4">
      <h1 className="text-4xl font-bold mb-6">{title}</h1>
      
      {description && (
        <article className="prose prose-lg mb-10">
          {description}
        </article>
      )}
      
      <div className="mt-12 space-y-12">
        {fields.map((field) => (
          <div key={field.storeKey} className="space-y-2">
            <label className="block text-xl font-medium text-gray-900">
              {field.label}
              {field.type === 'integer' && field.min !== undefined && field.max !== undefined && 
                ` (${field.min}-${field.max})`}
              {field.type === 'float' && field.min !== undefined && field.max !== undefined && 
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
                    let parsedValue;
                    
                    if (field.type === 'integer') {
                      parsedValue = rawValue === '' ? '' : parseInt(rawValue, 10);
                    } else if (field.type === 'float') {
                      parsedValue = rawValue === '' ? '' : parseFloat(rawValue);
                    }
                    
                    if (rawValue === '' || !isNaN(parsedValue as number)) {
                      handleChange(field.storeKey, parsedValue);
                    }
                  }}
                  step={field.step || (field.type === 'integer' ? 1 : 0.1)}
                  min={field.min}
                  max={field.max}
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
          className={`bg-white cursor-pointer px-8 py-3 border-2 border-black font-bold text-black text-lg rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ${hasErrors ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {saveButtonText}
        </button>
      </div>
    </div>
  );
}

export default StoreUI;