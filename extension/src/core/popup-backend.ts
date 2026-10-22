import { API_URL, BACKEND_PERMISSION } from '../shared/messages';

export async function setupBackendConnection(doc: Document, onReady: () => Promise<void>, chromeApi: typeof chrome = chrome) {
  const button = doc.getElementById('connectBackendBtn') as HTMLButtonElement;
  const status = doc.getElementById('backendStatus')!;
  const check = async () => {
    if (!await chromeApi.permissions.contains({ origins: [BACKEND_PERMISSION] })) {
      status.textContent = 'Local backend access is not allowed. Click Connect local backend.';
      return;
    }
    await onReady();
    status.textContent = `Connected to ${API_URL}.`;
  };
  button.addEventListener('click', event => {
    if (!event.isTrusted || button.disabled) return;
    let permission: Promise<boolean>;
    try {
      // Do not await anything before requesting the grant: Chrome needs the click.
      permission = chromeApi.permissions.request({ origins: [BACKEND_PERMISSION] });
    } catch {
      status.textContent = 'Chrome could not request local backend access. Check Job Copilot site access in Chrome extensions.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Connecting to the local backend...';
    permission.then(async granted => {
      if (!granted) { status.textContent = 'Local backend access was not granted.'; return; }
      await check();
    }).catch(error => {
      status.textContent = error instanceof Error ? error.message : 'Could not connect to the local backend.';
    }).finally(() => { button.disabled = false; });
  });
  try { await check(); }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not connect to the local backend.'; }
}
