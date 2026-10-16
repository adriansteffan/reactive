// Set by @adriansteffan/reactive/native when the experiment runs as an Android or iOS app

export interface FileBackend {
  directoryExists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  saveFile(filename: string, content: string, directory: string): Promise<void>;
}

export interface NativeIntegration {
  createFileBackend(parentFolder?: string): FileBackend;
  canWriteFiles(): Promise<boolean>;
  enterFullscreen(): void;
  exitFullscreen(): void;
}

let nativeIntegration: NativeIntegration | null = null;

export function registerNative(integration: NativeIntegration) {
  nativeIntegration = integration;
}

export function getNative(): NativeIntegration | null {
  return nativeIntegration;
}

/** `native` when the experiment runs as an Android or iOS app. */
export type Platform = 'native' | 'web';

export const getPlatform = (): Platform => (getNative() ? 'native' : 'web');
