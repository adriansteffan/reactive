import type { ReactNode } from 'react';
import { t, useTheme } from '../runner/theme';

/** Text in the experiment's theme, in a column as wide as the one on the built-in screens. */
export function Article({ children }: { children: ReactNode }) {
  const th = t(useTheme());
  // The screens' column is 65ch at the normal font size, which the larger text reaches with 52ch, less their padding
  return <article className={`w-[calc(min(52ch,100vw)-2rem)] max-w-full ${th.article}`}>{children}</article>;
}
