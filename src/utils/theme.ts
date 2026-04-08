import { createContext, useContext } from 'react';

export type Theme = 'light' | 'dark' | 'dark-plain';

export const ThemeContext = createContext<Theme>('light');
export const useTheme = () => useContext(ThemeContext);

const DARK_TOKENS = {
  text: 'text-[#f5f5f5]',
  prose: 'prose-invert',
  proseLink: 'prose-a:text-blue-400',
  buttonBg: 'bg-white',
  buttonText: 'text-black',
  buttonBorder: 'border-black',
  buttonShadow: 'shadow-[2px_2px_0px_rgba(0,0,0,1)]',
  buttonDisabledBg: 'bg-gray-700',
  buttonDisabledText: 'text-gray-500',
  buttonDisabledBorder: 'border-gray-600',
  buttonDisabledShadow: 'shadow-[2px_2px_0px_rgba(75,85,99,1)]',
  error: 'text-red-400',
  focusRing: 'focus:ring-blue-400',
  inputBg: 'bg-gray-700',
  inputBorder: 'border-gray-500',
  inputText: 'text-[#f5f5f5]',
  progressBg: 'bg-gray-700',
  progressStripe1: '#374151',
  progressStripe2: '#4B5563',
  dotActive: '#fff',
  dotInactive: 'rgba(255,255,255,0.3)',
  toastTheme: 'dark' as const,
} as const;

export const THEME = {
  light: {
    containerBg: '',
    text: 'text-black',
    prose: 'prose-slate',
    proseLink: 'prose-a:text-blue-600',
    buttonBg: 'bg-white',
    buttonText: 'text-black',
    buttonBorder: 'border-black',
    buttonShadow: 'shadow-[2px_2px_0px_rgba(0,0,0,1)]',
    buttonDisabledBg: 'bg-gray-200',
    buttonDisabledText: 'text-gray-400',
    buttonDisabledBorder: 'border-gray-400',
    buttonDisabledShadow: 'shadow-[2px_2px_0px_rgba(156,163,175,1)]',
    error: 'text-red-500',
    focusRing: 'focus:ring-blue-500',
    inputBg: '',
    inputBorder: 'border-black',
    inputText: '',
    progressBg: 'bg-gray-200',
    progressStripe1: '#E5E7EB',
    progressStripe2: '#D1D5DB',
    dotActive: '#000',
    dotInactive: 'rgba(0,0,0,0.2)',
    toastTheme: 'light' as const,
  },
  dark: {
    containerBg: 'reactive-dark-bg',
    ...DARK_TOKENS,
  },
  'dark-plain': {
    containerBg: 'reactive-dark-bg-plain',
    ...DARK_TOKENS,
  },
} as const;

export const DARK_BG_CLASS = 'reactive-dark-bg';
export const DARK_BG_PLAIN_CLASS = 'reactive-dark-bg-plain';

export function t(theme: Theme) {
  return THEME[theme];
}
