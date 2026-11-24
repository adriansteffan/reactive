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
  focusOutline: 'focus-visible:outline-white',
  error: 'text-red-400',
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

const THEME = {
  light: {
    containerBg: '',
    text: 'text-black',
    prose: 'prose-slate',
    proseLink: 'prose-a:text-blue-600',
    buttonBg: 'bg-white',
    buttonText: 'text-black',
    buttonBorder: 'border-black',
    buttonShadow: 'shadow-[2px_2px_0px_rgba(0,0,0,1)]',
    focusOutline: 'focus-visible:outline-black',
    error: 'text-red-500',
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

// Keeps the cursor over a button while it shifts on hover. The shift also anchors the ::before to the button.
export const hoverArea = 'hover:before:absolute hover:before:-inset-1.5';

export function t(theme: Theme) {
  const tokens = THEME[theme];
  return {
    ...tokens,
    /** The button that ends a screen, faded while it is disabled. */
    button: `${tokens.buttonBg} cursor-pointer px-8 py-3 border-2 ${tokens.buttonBorder} font-bold ${tokens.buttonText} text-lg rounded-xl ${tokens.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ${hoverArea} focus-visible:outline-2 ${tokens.focusOutline} disabled:opacity-50 disabled:pointer-events-none`,
    /** A screen's text. */
    article: `reactive-article ${tokens.prose} ${tokens.proseLink} ${tokens.text}`,
  };
}
