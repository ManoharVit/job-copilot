export function matchesHost(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return host === domain || host.endsWith(`.${domain}`);
}

export function hasProviderFrame(document: Document, domain: string): boolean {
  return hasMatchingFrame(document, url => matchesHost(url, domain));
}

export function hasMatchingFrame(document: Document, matches: (url: URL) => boolean): boolean {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src]')).some(frame => {
    try {
      const source = new URL(frame.getAttribute('src') || '', document.baseURI);
      return ['https:', 'http:'].includes(source.protocol) && matches(source);
    } catch {
      return false;
    }
  });
}

const excludedContext = 'form, [role="form"], input, select, textarea, button, label, script, style, noscript, [hidden], [aria-hidden="true"], [contenteditable]:not([contenteditable="false"]), .jc-btn, .jc-toast';

export function descriptionText(root: HTMLElement | null): string {
  if (!root || root.closest(excludedContext)) return '';
  // Bound traversal and avoid cloning a whole application/page for each selector.
  const pending: Node[] = [root];
  const chunks: string[] = [];
  let visited = 0;
  let length = 0;
  while (pending.length && visited++ < 10_000 && length < 4_000) {
    const node = pending.pop()!;
    if (node.nodeType === 3) {
      const text = (node.textContent || '').slice(0, 4_000).replace(/\s+/g, ' ').trim();
      if (text) { chunks.push(text); length += text.length; }
    } else if (node.nodeType === 1) {
      const element = node as HTMLElement;
      if (element.matches(excludedContext) || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.getAttribute('style') || '')) continue;
      const children = node.childNodes;
      const count = Math.min(children.length, 10_000 - visited - pending.length);
      for (let index = count - 1; index >= 0; index--) pending.push(children[index]!);
    }
  }
  return chunks.join(' ').substring(0, 2000);
}

export function readDescription(document: Document, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const text = descriptionText(element);
      if (text.length > 100) return text;
    }
  }
  return null;
}

export function readCompanyMetadata(document: Document): string | null {
  for (const selector of ['meta[property="og:site_name"]', 'meta[name="application-name"]']) {
    const name = document.querySelector<HTMLMetaElement>(selector)?.content.trim();
    if (name && !['greenhouse', 'lever', 'lever.co', 'workday', 'ashby', 'ashbyhq', 'careers', 'jobs'].includes(name.toLowerCase())) {
      return name;
    }
  }
  return null;
}

export function genericTextareaWrapper(textarea: HTMLTextAreaElement): HTMLElement | null {
  return textarea.closest<HTMLElement>('.input-wrapper, .text-input-wrapper, .input-container, .field-wrapper');
}
