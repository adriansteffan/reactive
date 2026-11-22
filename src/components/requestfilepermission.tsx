import { BaseComponentProps } from '../core/component';
import { type ReactNode, useEffect, useState } from 'react';
import { noopSimulate } from '../core/simulation';
import { defineComponent } from '../core/component';
import { getNative } from '../core/platform';
import { t, useTheme } from '../runner/theme';

function RequestFilePermission({
  next,
  content = (
    <>
      <p>Storage permission is required to save your data.</p>
      <p>Please grant permission when prompted.</p>
      <p>If there is no popup, go to "Settings" {">"} "Apps" {">"} "Name of the App" {">"} "Permissions" {">"} "Storage" {">"} "Allow"</p>
    </>
  ),
  buttonText = 'Try Again',
}: BaseComponentProps & {
  /** Shown when the app may not save files. */
  content?: ReactNode;
  buttonText?: string;
}) {
  const [checking, setChecking] = useState(true);
  const th = t(useTheme());

  useEffect(() => {
    if (!checking) return;

    const checkPermission = async () => {
      const native = getNative();
      if (!native || (await native.canWriteFiles())) {
        next({});
      } else {
        setChecking(false);
      }
    };

    checkPermission();
  }, [next, checking]);

  if (checking) {
    return null;
  }
  
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 text-xl mt-16 px-10">
      {content}
      <button 
        onClick={() => setChecking(true)} 
        className={`mt-8 ${th.button}`}
      >
        {buttonText}
      </button>
    </div>
  );
}

export default defineComponent({
  name: 'RequestFilePermission',
  component: RequestFilePermission,
  csv: null,
  simulate: noopSimulate,
});
