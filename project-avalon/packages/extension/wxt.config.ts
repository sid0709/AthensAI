import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'Project Avalon',
    description: 'Remote browser control extension for Project Avalon',
    permissions: [
      'tabs',
      'activeTab',
      'scripting',
      'webRequest',
      'sidePanel',
      'storage',
      'downloads',
      'webNavigation',
      'contextMenus',
      'notifications',
      'unlimitedStorage',
      'alarms',
    ],
    host_permissions: [
      '<all_urls>',
      'http://localhost/*',
      'http://127.0.0.1/*',
      'ws://localhost/*',
      'ws://127.0.0.1/*',
    ],
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_title: 'Open Avalon sidebar',
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
  runner: {
    chromiumArgs: ['--auto-open-devtools-for-tabs'],
  },});
