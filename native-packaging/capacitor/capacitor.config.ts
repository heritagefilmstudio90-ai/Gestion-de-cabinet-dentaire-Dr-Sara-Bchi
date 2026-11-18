import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ma.dentaflow.pro',
  appName: 'Gestion de cabinet dentaire Dr. Sara Bchi',
  webDir: '../../dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    cleartext: false,
    allowNavigation: [
      '*.firebaseapp.com',
      '*.googleapis.com',
      '*.google.com',
      '*.gstatic.com',
      'accounts.google.com',
      '*.run.app',
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    scheme: 'App',
    contentInset: 'automatic',
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#0B2239',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B2239',
    },
  },
};

export default config;
