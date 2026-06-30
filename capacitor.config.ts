import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buzzna.d74',
  appName: 'BuzzNa D74',
  webDir: 'apps/web/dist', // Points to the Vite build output
  bundledWebRuntime: false,
  plugins: {
    BackgroundRunner: {
      label: 'com.capacitor.background.check',
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
  }
};

export default config; 