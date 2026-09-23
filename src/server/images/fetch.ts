import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetching an image for baseline materialisation, behind an SSRF guard.
 * spec: 05-baselines-and-diff.md §3.2 step 7; `RD-012`, `RD-043`
 *
 * Freeze fetches URLs a user put in a document, from the server, with the server's
 * network position. That is textbook SSRF, so the guard is here, on its own, small
 * enough to read in one sitting, and tested as a table rather than incidentally.
 *
 * Everything it refuses is named in the refusal, because `RD-012` requires a freeze to
 * fail loudly rather than produce a snapshot that can rot.
 */

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export type FetchedImage = { ok: true; bytes: Uint8Array; mediaType: string };
export type FetchRefusal = { ok: false; reason: string };
export type FetchResult = FetchedImage | FetchRefusal;

/** Swappable for the tests: no test in this repository reaches the network or a resolver. */
export type Resolver = (hostname: string) => Promise<string[]>;
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type FetchOptions = {
  resolve?: Resolver;
  fetchImpl?: Fetcher;
  maxBytes?: number;
  timeoutMs?: number;
};

/** The system resolver. Webhook delivery shares it, and the guard below, with images. */
export const defaultResolver: Resolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true });
  return addresses.map((address) => address.address);
};

/**
 * True for an address the server must never be made to reach on a user's behalf:
 * loopback, the link-local range that carries cloud metadata, RFC1918, carrier-grade NAT,
 * and their IPv6 equivalents including IPv4-mapped forms.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return true; // Not an address at all: refuse rather than guess.

  if (version === 4) return isBlockedV4(address);

  const lower = address.toLowerCase();
  // ::ffff:127.0.0.1 and friends are IPv4 wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isBlockedV4(mapped[1]);

  if (lower === '::' || lower === '::1') return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  if (/^f[cd]/.test(lower)) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  return false;
}

function isBlockedV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, and 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/** Checks one URL: scheme, then every address its host resolves to. */
export async function checkUrl(raw: string, resolver: Resolver): Promise<FetchRefusal | { ok: true; url: URL }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `"${raw}" is not a URL.` };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: `${url.protocol}// images cannot be materialised; use http or https.` };
  }

  // A literal address in the URL never reaches the resolver, so it is checked directly.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0) {
    return isBlockedAddress(hostname)
      ? { ok: false, reason: `${hostname} is not a public address.` }
      : { ok: true, url };
  }

  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    return { ok: false, reason: `${hostname} could not be resolved.` };
  }

  if (addresses.length === 0) return { ok: false, reason: `${hostname} resolved to no addresses.` };
  // *Every* address, not the first: a host with one public and one private A record is
  // the oldest trick in this family.
  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked) return { ok: false, reason: `${hostname} resolves to ${blocked}, which is not a public address.` };

  return { ok: true, url };
}

/**
 * Fetches an image, or explains why not. Redirects are followed by hand so the guard runs
 * again on every hop: a permitted host redirecting to 127.0.0.1 is the classic bypass,
 * and `redirect: 'follow'` would take it.
 */
export async function fetchImage(raw: string, options: FetchOptions = {}): Promise<FetchResult> {
  const resolver = options.resolve ?? defaultResolver;
  const fetcher = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const maxBytes = options.maxBytes ?? IMAGE_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? IMAGE_TIMEOUT_MS;

  let target = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = await checkUrl(target, resolver);
    if (!checked.ok) return checked;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetcher(checked.url.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'image/*' },
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        reason: aborted ? `${raw} did not respond within ${timeoutMs / 1000}s.` : `${raw} could not be fetched.`,
      };
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, reason: `${raw} redirected without saying where.` };
      // Resolved against the current URL, so a relative Location is handled too.
      target = new URL(location, checked.url).toString();
      continue;
    }

    if (!response.ok) {
      return { ok: false, reason: `${raw} answered ${response.status}.` };
    }

    const mediaType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!mediaType.startsWith('image/')) {
      return { ok: false, reason: `${raw} is ${mediaType || 'of unknown type'}, not an image.` };
    }

    const bytes = await readCapped(response, maxBytes);
    if (!bytes) {
      return { ok: false, reason: `${raw} is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.` };
    }

    return { ok: true, bytes, mediaType };
  }

  return { ok: false, reason: `${raw} redirected more than ${MAX_REDIRECTS} times.` };
}

/**
 * Reads the body, stopping at the cap. The cap is enforced while streaming rather than
 * from `Content-Length`, which a server is free to lie about or omit.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : buffer;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
