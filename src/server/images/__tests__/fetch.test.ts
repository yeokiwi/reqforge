import { describe, expect, it } from 'vitest';
import { checkUrl, fetchImage, isBlockedAddress, type Fetcher, type Resolver } from '../fetch';

/**
 * The SSRF guard of `RD-043`, as a table.
 * No test here reaches the network or a resolver: both are injected.
 */

const publicResolver: Resolver = async () => ['93.184.216.34'];
const resolverFor = (addresses: string[]): Resolver => async () => addresses;

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const respondWith = (init: {
  status?: number;
  type?: string;
  body?: Uint8Array;
  location?: string;
}): Response => {
  const headers = new Headers();
  if (init.type) headers.set('content-type', init.type);
  if (init.location) headers.set('location', init.location);
  const status = init.status ?? 200;

  // A redirect or an error carries no body, which `Response` enforces.
  if (status >= 300 && status < 400) return new Response(null, { status, headers });
  return new Response(init.body ? Buffer.from(init.body) : null, { status, headers });
};

const serving = (init: Parameters<typeof respondWith>[0]): Fetcher => async () => respondWith(init);

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'this network'],
    ['10.1.2.3', 'RFC1918'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.254', 'RFC1918'],
    ['192.168.1.1', 'RFC1918'],
    ['169.254.169.254', 'cloud metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fc00::1', 'IPv6 unique-local'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['not-an-address', 'not an address at all'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([['93.184.216.34'], ['8.8.8.8'], ['172.32.0.1'], ['2606:2800:220:1:248:1893:25c8:1946']])(
    'allows the public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('checkUrl', () => {
  it('accepts an http(s) URL on a public host', async () => {
    await expect(checkUrl('https://example.test/a.png', publicResolver)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['file:///etc/passwd', 'file:'],
    ['data:image/png;base64,AAAA', 'data:'],
    ['gopher://example.test/', 'gopher:'],
    ['blob:https://example.test/x', 'blob:'],
  ])('refuses %s by naming its scheme', async (url, scheme) => {
    const outcome = await checkUrl(url, publicResolver);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain(scheme);
  });

  it('refuses a literal private address without consulting the resolver', async () => {
    const never: Resolver = async () => {
      throw new Error('the resolver must not be called for a literal address');
    };
    const outcome = await checkUrl('http://169.254.169.254/latest/meta-data/', never);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('not a public address');
  });

  it('refuses a literal IPv6 loopback in brackets', async () => {
    await expect(checkUrl('http://[::1]:8080/a.png', publicResolver)).resolves.toMatchObject({ ok: false });
  });

  it('refuses a hostname that resolves to a private address', async () => {
    const outcome = await checkUrl('https://evil.test/a.png', resolverFor(['10.0.0.5']));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('10.0.0.5');
  });

  it('refuses when *any* address is private, not just the first', async () => {
    const outcome = await checkUrl('https://evil.test/a.png', resolverFor(['93.184.216.34', '127.0.0.1']));
    expect(outcome.ok).toBe(false);
  });

  it('refuses a host that resolves to nothing, and one that will not resolve', async () => {
    await expect(checkUrl('https://nowhere.test/a.png', resolverFor([]))).resolves.toMatchObject({ ok: false });
    const throws: Resolver = async () => {
      throw new Error('NXDOMAIN');
    };
    await expect(checkUrl('https://nowhere.test/a.png', throws)).resolves.toMatchObject({ ok: false });
  });

  it('refuses something that is not a URL at all', async () => {
    await expect(checkUrl('/relative/path.png', publicResolver)).resolves.toMatchObject({ ok: false });
  });
});

describe('fetchImage', () => {
  const options = (fetchImpl: Fetcher, resolve: Resolver = publicResolver) => ({ resolve, fetchImpl });

  it('returns the bytes and the media type of an image', async () => {
    const outcome = await fetchImage(
      'https://example.test/a.png',
      options(serving({ type: 'image/png', body: png })),
    );
    expect(outcome).toMatchObject({ ok: true, mediaType: 'image/png' });
    if (outcome.ok) expect(Array.from(outcome.bytes)).toEqual(Array.from(png));
  });

  it('ignores parameters on the content type', async () => {
    const outcome = await fetchImage(
      'https://example.test/a.svg',
      options(serving({ type: 'image/svg+xml; charset=utf-8', body: png })),
    );
    expect(outcome).toMatchObject({ ok: true, mediaType: 'image/svg+xml' });
  });

  it('refuses a response that is not an image', async () => {
    const outcome = await fetchImage(
      'https://example.test/a.png',
      options(serving({ type: 'text/html', body: png })),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('not an image');
  });

  it('refuses an error response, naming the status', async () => {
    const outcome = await fetchImage('https://example.test/a.png', options(serving({ status: 404 })));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('404');
  });

  it('re-runs the guard on a redirect: a public host cannot hand off to localhost', async () => {
    let hop = 0;
    const fetchImpl: Fetcher = async () => {
      hop += 1;
      return hop === 1
        ? respondWith({ status: 302, location: 'http://127.0.0.1/secrets' })
        : respondWith({ type: 'image/png', body: png });
    };

    const outcome = await fetchImage('https://example.test/a.png', options(fetchImpl));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('not a public address');
    // The second request was never made.
    expect(hop).toBe(1);
  });

  it('follows a redirect to a public host', async () => {
    let hop = 0;
    const fetchImpl: Fetcher = async () => {
      hop += 1;
      return hop === 1
        ? respondWith({ status: 301, location: 'https://cdn.example.test/a.png' })
        : respondWith({ type: 'image/png', body: png });
    };
    await expect(fetchImage('https://example.test/a.png', options(fetchImpl))).resolves.toMatchObject({ ok: true });
  });

  it('refuses a redirect chain longer than the cap', async () => {
    let hop = 0;
    const fetchImpl: Fetcher = async () => {
      hop += 1;
      return respondWith({ status: 302, location: `https://example.test/hop-${hop}.png` });
    };
    const outcome = await fetchImage('https://example.test/a.png', options(fetchImpl));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('redirected more than 3 times');
  });

  it('refuses a redirect that says nowhere', async () => {
    const outcome = await fetchImage('https://example.test/a.png', options(serving({ status: 302 })));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('without saying where');
  });

  it('enforces the size cap while streaming, not from Content-Length', async () => {
    const big = new Uint8Array(4096);
    const fetchImpl: Fetcher = async () =>
      new Response(Buffer.from(big), {
        status: 200,
        // A lie: the body is 4096 bytes.
        headers: { 'content-type': 'image/png', 'content-length': '10' },
      });

    const outcome = await fetchImage('https://example.test/big.png', {
      resolve: publicResolver,
      fetchImpl,
      maxBytes: 1024,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('larger than');
  });

  it('reports a timeout as a timeout rather than as a network error', async () => {
    const fetchImpl: Fetcher = async (_url, init) => {
      const signal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };

    const outcome = await fetchImage('https://example.test/slow.png', {
      resolve: publicResolver,
      fetchImpl,
      timeoutMs: 20,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('did not respond within');
  });

  it('never lets a raw network error cross the boundary', async () => {
    const fetchImpl: Fetcher = async () => {
      throw new Error('ECONNREFUSED 10.0.0.1:80');
    };
    const outcome = await fetchImage('https://example.test/a.png', options(fetchImpl));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('could not be fetched');
      expect(outcome.reason).not.toContain('ECONNREFUSED');
    }
  });

  it('never requests a URL the guard refused', async () => {
    const never: Fetcher = async () => {
      throw new Error('fetch must not be called');
    };
    await expect(
      fetchImage('http://169.254.169.254/latest/meta-data/', options(never)),
    ).resolves.toMatchObject({ ok: false });
  });
});
