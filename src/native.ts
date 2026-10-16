import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { StatusBar } from '@capacitor/status-bar';
import { ImmersiveMode } from '@adriansteffan/immersive-mode';
import { FileBackend, registerNative } from './core/platform';

const isAndroid = Capacitor.getPlatform() === 'android';

function createFileBackend(parentFolder?: string): FileBackend {
  const getPath = (path: string): string => {
    if (!parentFolder) {
      return path;
    }
    return path ? `${parentFolder}/${path}` : parentFolder;
  };

  return {
    directoryExists: async (path: string): Promise<boolean> => {
      try {
        if (parentFolder) {
          try {
            await Filesystem.readdir({
              path: parentFolder,
              directory: Directory.Documents,
            });
          } catch {
            // Parent folder doesn't exist, so subpath doesn't exist either
            return false;
          }
        }

        const fullPath = getPath(path);
        const result = await Filesystem.readdir({
          path: fullPath,
          directory: Directory.Documents,
        });
        return result.files.length >= 0;
      } catch {
        return false;
      }
    },

    createDirectory: async (path: string): Promise<void> => {
      try {
        if (parentFolder) {
          try {
            await Filesystem.mkdir({
              path: parentFolder,
              directory: Directory.Documents,
              recursive: false,
            });
          } catch {
            // Parent directory might already exist, that's fine
          }
        }

        const fullPath = getPath(path);
        await Filesystem.mkdir({
          path: fullPath,
          directory: Directory.Documents,
          recursive: true,
        });
      } catch (e) {
        console.error('Error creating directory:', e);
        throw e;
      }
    },

    saveFile: async (filename: string, content: string, directory: string): Promise<void> => {
      const fullDirectory = getPath(directory);

      await Filesystem.writeFile({
        path: `${fullDirectory}/${filename}`,
        data: content,
        directory: Directory.Documents,
        encoding: 'utf8' as Encoding,
      });
    },
  };
}

// Only Android asks for storage permission, so a test write tells whether it was granted
async function canWriteFiles(): Promise<boolean> {
  if (!isAndroid) return true;

  try {
    await Filesystem.writeFile({
      path: 'permission_check.txt',
      data: 'Testing permissions',
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
  } catch (error) {
    console.error('Permission denied or error:', error);
    return false;
  }

  try {
    await Filesystem.deleteFile({
      path: 'permission_check.txt',
      directory: Directory.Documents,
    });
  } catch (e) {
    console.log('Cleanup error:', e);
  }
  return true;
}

// In a regular browser, e.g. during development, the experiment keeps behaving like the web version
if (Capacitor.isNativePlatform()) {
  registerNative({
    createFileBackend,
    canWriteFiles,
    enterFullscreen: () => {
      if (isAndroid) {
        StatusBar.hide();
        ImmersiveMode.enable();
      }
    },
    exitFullscreen: () => {
      if (isAndroid) {
        StatusBar.show();
        ImmersiveMode.disable();
      }
    },
  });
}
