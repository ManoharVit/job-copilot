import { API_URL } from '../shared/messages';
import type { ApiResponse } from '../shared/messages';

// Both popup and content scripts go through the worker's endpoint/method guard.
export async function requestBackend<T>(endpoint: string, chromeApi: typeof chrome = chrome): Promise<T> {
  const response: ApiResponse<T> | undefined = await chromeApi.runtime.sendMessage({
    action: 'fetchAPI', url: `${API_URL}${endpoint}`, options: {},
  });
  if (!response?.success) throw new Error(response?.error || 'The extension worker did not respond. Reload Job Copilot.');
  return response.data;
}
