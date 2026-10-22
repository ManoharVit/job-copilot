import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Job Copilot',
    description: 'Autofills job applications',
    icons: {
      16: 'icons/job-copilot.png',
      32: 'icons/job-copilot.png',
      48: 'icons/job-copilot.png',
      128: 'icons/job-copilot.png',
    },
    action: {
      default_icon: {
        16: 'icons/job-copilot.png',
        32: 'icons/job-copilot.png',
        48: 'icons/job-copilot.png',
        128: 'icons/job-copilot.png',
      },
    },
    permissions: ['activeTab', 'storage', 'scripting', 'webNavigation', 'tabs'],
    host_permissions: ['<all_urls>', 'http://localhost:8765/*', 'http://127.0.0.1:8765/*'],
    commands: {
      autofill: {
        suggested_key: { default: 'Ctrl+Shift+F', mac: 'Command+Shift+F' },
        description: 'Autofill current page',
      },
    },
  },
});
