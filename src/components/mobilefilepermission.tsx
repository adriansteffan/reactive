import { BaseComponentProps, getPlatform } from '../utils/common';
import { useEffect, useState } from 'react';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';


// currently needed for old android verions (<=10) because they need permissions to save data to the documents folder
export default function RequestFilePermission({ next }: BaseComponentProps) {
  const [permissionChecking, setPermissionChecking] = useState(false);
  
  useEffect(() => {
    // Prevent multiple checks
    if (permissionChecking) return;
    
    const checkPermission = async () => {
      // Only run on Android
      if (getPlatform() !== 'mobile' || Capacitor.getPlatform() !== 'android') {
        next({});
        return;
      }

      setPermissionChecking(true);
      
      try {
        // Try to write a test file to check permissions
        // For Android 9-10, this will trigger permission request
        // For Android 11+, this should work with scoped storage
        await Filesystem.writeFile({
          path: 'permission_check.txt',
          data: 'Testing permissions',
          directory: Directory.Documents,
          encoding: Encoding.UTF8
        });
        
        
        try {
          await Filesystem.deleteFile({
            path: 'permission_check.txt',
            directory: Directory.Documents
          });
        } catch (e) {
          
        }
        
        // Permission granted, proceed to next step
        next({});
      } catch (error) {
        console.error('Permission denied or error:', error);
        
        setPermissionChecking(false);
      }
    };
    
    checkPermission();
  }, [next, permissionChecking]);
  
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 text-xl mt-16 px-10">
      <p>Storage permission is required to save your data.</p>
      <p>Please grant permission when prompted.</p>
      <p>If there is not popup, go to "Settings" {">"} "Apps" {">"} "BeSeK" {">"} "Permissions" {">"} "Storage" {">"} "Allow"</p>
      <button 
        onClick={() => setPermissionChecking(false)} 
        className="mt-8 bg-white px-8 py-3 border-2 border-black font-bold text-black text-lg rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
      >
        Try Again
      </button>
    </div>
  );
}