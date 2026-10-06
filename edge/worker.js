/**
 * The public site's only Worker code. Cloudflare serves the static export
 * straight from its asset store; this runs first for `/video/*` alone
 * (`run_worker_first` in wrangler.jsonc).
 *
 * The asset store answers every request with the whole file, ignoring
 * `Range`. A video needs byte ranges: Safari will not play an MP4 without
 * them, and no browser can seek past what it has already downloaded. So the
 * story film's requests come through here and get a 206 with just the bytes
 * asked for, streamed from the asset rather than buffered.
 */

export default {
  async fetch(request, env, ctx) {
    const asset = await env.ASSETS.fetch(request);
    // 304s, 404s and anything the asset store already ranged go out as they are.
    if (asset.status !== 200) return asset;

    const headers = new Headers(asset.headers);
    headers.set('Accept-Ranges', 'bytes');
    const ifRange = request.headers.get('If-Range');
    const stale = ifRange !== null && ifRange !== headers.get('ETag');
    const wanted = request.method === 'GET' && asset.body && !stale ? request.headers.get('Range') : null;
    if (!wanted) return new Response(asset.body, { status: 200, headers });

    // A range needs the file's size. The asset store usually says; when it
    // streams without a length, read the file once to learn it.
    let size = Number(headers.get('Content-Length'));
    let bytes = null;
    if (!(size > 0)) {
      bytes = new Uint8Array(await asset.arrayBuffer());
      size = bytes.byteLength;
    }
    const range = parseRange(wanted, size);
    if (range === null) return new Response(bytes ?? asset.body, { status: 200, headers });
    if (range === 'unsatisfiable') {
      if (!bytes) await asset.body.cancel();
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } });
    }

    const { start, end } = range;
    const length = end - start + 1;
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(length));
    if (bytes) return new Response(bytes.subarray(start, end + 1), { status: 206, headers });
    // eslint-disable-next-line no-undef -- a Workers runtime global
    const { readable, writable } = new FixedLengthStream(length);
    ctx.waitUntil(copyRange(asset.body, writable, start, end + 1));
    return new Response(readable, { status: 206, headers });
  },
};

/**
 * One `bytes=` range against a file of `size` bytes: `{ start, end }`
 * (inclusive), 'unsatisfiable', or null to send the whole file - no header,
 * an unknown size, or several ranges at once, which a client must accept a
 * full response to.
 */
function parseRange(header, size) {
  if (!header || !Number.isFinite(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** Copy bytes [from, to) of a stream into `writable`, then stop reading. */
async function copyRange(body, writable, from, to) {
  const reader = body.getReader();
  const writer = writable.getWriter();
  let offset = 0;
  try {
    while (offset < to) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkStart = offset;
      offset += value.byteLength;
      if (offset <= from) continue;
      await writer.write(value.subarray(Math.max(0, from - chunkStart), Math.min(value.byteLength, to - chunkStart)));
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
  } finally {
    reader.cancel().catch(() => {});
  }
}
