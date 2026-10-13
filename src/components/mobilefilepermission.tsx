import { BaseComponentProps } from '../utils/common';
import { useEffect, useState } from 'react';
import { registerSimulation, noopSimulate } from '../utils/simulation';
import { registerFlattener } from '../utils/upload';
import { getNative } from '../utils/native';

registerFlattener('RequestFilePermission', null);
registerSimulation('RequestFilePermission', noopSimulate, {});

export default function RequestFilePermission({ next }: BaseComponentProps) {
  const [permissionStatus, setPermissionStatus] = useState('checking');
  
  useEffect(() => {
    if (permissionStatus !== 'checking') return;
    
    const checkPermission = async () => {
      const native = getNative();
      if (!native || (await native.canWriteFiles())) {
        setPermissionStatus('granted');
        next({});
      } else {
        setPermissionStatus('denied');
      }
    };
    
    checkPermission();
  }, [next, permissionStatus]);

  if (permissionStatus === 'checking') {
    return null;
  }
  
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 text-xl mt-16 px-10">
      <p>Storage permission is required to save your data.</p>
      <p>Please grant permission when prompted.</p>
      <p>If there is no popup, go to "Settings" {">"} "Apps" {">"} "Name of the App" {">"} "Permissions" {">"} "Storage" {">"} "Allow"</p>
      <button 
        onClick={() => setPermissionStatus('checking')} 
        className="mt-8 bg-white px-8 py-3 border-2 border-black font-bold text-black text-lg rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
      >
        Try Again
      </button>
    </div>
  );
}