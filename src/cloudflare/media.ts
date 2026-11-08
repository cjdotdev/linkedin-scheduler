import type { MediaFile, MediaSource } from "../core/types";

/** Media larger than this go to R2 (and media URLs larger than this are refused). */
export const KV_LIMIT = 25 * 1024 * 1024;

type MediaEnv = { MEDIA: KVNamespace; MEDIA_R2?: R2Bucket };

/**
 * Where a post's media comes from on Cloudflare: an https:// URL, then KV (the default, no card needed),
 * then R2 when the optional MEDIA_R2 bucket is bound (videos over 25 MB).
 */
export function cloudflareMedia(env: MediaEnv): MediaSource {
  return {
    async get(ref: string): Promise<MediaFile | null> {
      if (/^https?:\/\//i.test(ref)) {
        const res = await fetch(ref);
        if (!res.ok) throw new Error(`downloading ${ref} answered ${res.status}`);
        const body = await res.arrayBuffer();
        if (body.byteLength > KV_LIMIT) throw new Error(`${ref} is over 25 MB: put it in the repo with R2 instead`);
        return { body, size: body.byteLength };
      }
      const bytes = await env.MEDIA.get(ref, "arrayBuffer");
      if (bytes) return { body: bytes, size: bytes.byteLength };
      if (env.MEDIA_R2) {
        const obj = await env.MEDIA_R2.get(ref);
        if (obj) {
          // Stream with a known length: a 200 MB video never sits in the Worker's memory.
          const { readable, writable } = new FixedLengthStream(obj.size);
          void obj.body.pipeTo(writable);
          return { body: readable, size: obj.size };
        }
      }
      return null;
    },
  };
}
