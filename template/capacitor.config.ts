import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.PROJECT_NAME.app',
  appName: 'PROJECT_NAME',
  webDir: 'dist',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*']
  }
};

export default config;
