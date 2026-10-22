// Match Uvicorn's IPv4 loopback binding exactly; do not depend on localhost DNS.
export const API_URL = 'http://127.0.0.1:8765';
export const BACKEND_PERMISSION = 'http://127.0.0.1:8765/*';
export const CONTENT_SCRIPT = 'content-scripts/content.js';
export const CONTENT_CSS = 'content-scripts/content.css';

export type ToastType = boolean | 'success' | 'error' | 'info';
export interface AutofillCounts {
  filledCount: number;
  alreadyCorrectCount: number;
  skippedCount: number;
  failedCount: number;
  resumeAttachedCount?: number;
  resumeFailedCount?: number;
  resumeMessage?: string;
}
export type AutofillResponse = Partial<AutofillCounts> & {
  success: boolean;
  reason?: string;
  error?: string;
  deliveredFrames?: number;
  failedFrames?: number;
  frameIssues?: FrameIssue[];
};
export interface FrameIssue {
  frameId?: number;
  origin?: string;
  stage: 'script' | 'css' | 'message';
  code: 'site_access_required' | 'frame_unavailable' | 'injection_failed';
}
export interface SiteAccessResponse {
  success: boolean;
  tabId?: number;
  origins: string[];
  error?: string;
}
export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string; code?: string };
export type CopilotMessage =
  | { action: 'fetchAPI'; url: string; options: RequestInit }
  | { action: 'ensureInjected' }
  | { action: 'inspectSiteAccess' }
  | { action: 'broadcastAutofill' }
  | { action: 'autofill' }
  | { action: 'relayToast' | 'showToast'; message: string; toastType: ToastType };

export interface DetectedField {
  index: number;
  tagName: string;
  type: string;
  name: string;
  id: string;
  maxLength: number | null;
  context: string;
}
export type FieldMapping = Record<string, string | number | boolean | null>;
export interface GeneratedAnswer { answer?: string; cover_letter?: string }
export interface ProfileSummary { name?: string; email?: string; phone?: string; skills?: string | string[] }
export interface ApplicationStats { today?: number; total?: number }

export type EditableField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function isSelectField(field: EditableField): field is HTMLSelectElement {
  return field.tagName === 'SELECT';
}
export function isInputField(field: EditableField): field is HTMLInputElement {
  return field.tagName === 'INPUT';
}

declare global {
  interface Window { __jobCopilotLoaded?: boolean }
  interface HTMLInputElement { _valueTracker?: { setValue(value: string): void } }
  interface HTMLTextAreaElement { _valueTracker?: { setValue(value: string): void } }
}

// Keep sensitive questions out of generation, including summary/cover-letter routing.
export function requiresManualAnswer(text: string): boolean {
  return /\b(?:authori[sz](?:ed|ation)|visa|sponsor(?:ship|ed)?|work permit|itar|citizenship|citizen|legally eligible|consent|background check|drug test)\b/i.test(text.replace(/_/g, ' '));
}
