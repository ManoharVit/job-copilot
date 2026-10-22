import type { EditableField } from '../shared/messages';

export type DegreePreference = 'master' | 'bachelor';

export interface ATSAdapter {
  readonly name: string;
  /** Match this document's URL. Embedded providers are resolved separately. */
  matches(url: URL, document: Document): boolean;
  hasEmbeddedATS?(document: Document): boolean;
  detectCompany?(document: Document): string | null;
  detectJobDescription?(document: Document): string | null;
  detectDegreePreference?(document: Document): DegreePreference | null;
  handleCustomModals?(document: Document): Promise<boolean>;
  getFieldContext?(field: EditableField): string | null;
  getFieldOptions?(field: EditableField): string[];
  getFieldDegreePreference?(field: EditableField): DegreePreference | null;
  getTextareaWrapper?(textarea: HTMLTextAreaElement): HTMLElement | null;
}
