type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const postingCache = new WeakMap<Document, { url: string; posting: JsonObject | null }>();

function normalizeUrl(url: URL): string {
  const normPath = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${normPath}${url.search}`;
}

function posting(document: Document): JsonObject | null {
  const cached = postingCache.get(document);
  if (cached && cached.url === document.URL) return cached.posting;

  const postings: JsonObject[] = [];
  let budget = 200_000;
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 20)) {
    const source = script.textContent || '';
    if (source.length > 50_000 || source.length > budget) continue;
    budget -= source.length;
    try {
      const pending: unknown[] = [JSON.parse(source)];
      for (let visited = 0; pending.length && visited < 100; visited++) {
        const value = pending.shift();
        if (Array.isArray(value)) { pending.push(...value.slice(0, 100 - pending.length)); continue; }
        if (!object(value)) continue;
        const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
        if (types.some(type => typeof type === 'string' && /(?:^|[/#])JobPosting$/.test(type))) postings.push(value);
        if (value['@graph']) pending.push(value['@graph']);
        if (value.mainEntity) pending.push(value.mainEntity);
      }
    } catch { /* Invalid publisher JSON must not break the form controller. */ }
  }

  let result: JsonObject | null = null;
  if (postings.length === 1) {
    result = postings[0]!;
  } else if (postings.length > 1) {
    // A board can contain many postings; never take the first unrelated vacancy.
    const matches = postings.filter(item => {
      const address = typeof item.url === 'string' ? item.url : item['@id'];
      if (typeof address !== 'string') return false;
      try {
        const candidate = new URL(address, document.baseURI);
        const current = new URL(document.URL);
        candidate.hash = ''; current.hash = '';
        return normalizeUrl(candidate) === normalizeUrl(current);
      } catch { return false; }
    });
    result = matches.length === 1 ? matches[0]! : null;
  }

  postingCache.set(document, { url: document.URL, posting: result });
  return result;
}

export function hiringOrganization(document: Document): string | null {
  const employer = posting(document)?.hiringOrganization;
  if (!object(employer) || typeof employer.name !== 'string') return null;
  const name = employer.name.replace(/\s+/g, ' ').trim();
  return name && name.length <= 200 ? name : null;
}

function decodeEntities(raw: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '—', hellip: '…',
  };
  return raw
    .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/gi, (_match, entity: string) => named[entity.toLowerCase()] || _match)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = parseInt(dec, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

export function postingDescription(document: Document): string | null {
  const description = posting(document)?.description;
  if (typeof description !== 'string') return null;
  // Treat metadata as text. Never insert publisher HTML into a document or load resources.
  const text = decodeEntities(description
    .replace(/<(script|style|form|textarea|button|label)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' '))
    .replace(/\s+/g, ' ').trim();
  return text.length > 100 ? text.substring(0, 2000) : null;
}
