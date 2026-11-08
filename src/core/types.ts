// What the core needs from the platform it runs on. Cloudflare provides D1 (which already has this
// shape) and KV/R2; another runtime (Node + SQLite, say) would only have to provide the same two things.

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface Sql {
  prepare(query: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<{ meta: { changes?: number } }[]>;
}

/** A post's media, ready to send: bytes or a stream of known length. */
export interface MediaFile {
  body: ArrayBuffer | ReadableStream;
  size: number;
}

/** Finds a post's media by its `media:` value (a key such as images/card.png, or an https:// URL). */
export interface MediaSource {
  get(ref: string): Promise<MediaFile | null>;
}

export interface PostRow {
  slug: string;
  body: string;
  visibility: string;
  media: string | null;
  first_comment: string | null;
}
