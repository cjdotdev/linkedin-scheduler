// LinkedIn "Share on LinkedIn" API (w_member_social): register and upload media, create the post,
// add the first comment. https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
import { length, linkedinText, MAX_CHARS } from "./text";
import type { MediaSource, PostRow } from "./types";

const API = "https://api.linkedin.com/v2";

/** The post was certainly NOT created: safe to try again next minute. */
export class RetryableError extends Error {}
/** Retrying cannot help (bad input). */
export class PermanentError extends Error {}
/** The post request was sent but the answer is unclear: never retried, to avoid a double post. */
export class UnknownOutcomeError extends Error {}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface LinkedInConfig {
  token: string;
  /** urn:li:person:XXXX. Empty: read from /v2/userinfo. */
  personUrn?: string;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
  /** Waits between media status checks. Replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export function createLinkedIn(config: LinkedInConfig) {
  const doFetch = config.fetch ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function request(
    method: string,
    url: string,
    init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      ...init.headers,
    };
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers["Content-Type"] = "application/json";
    }
    const res = await doFetch(url, { method, headers, body });
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 401 ? " (the access token is invalid or expired: renew it)" : "";
      throw new HttpError(res.status, `LinkedIn ${res.status} on ${method} ${url}${hint}: ${text.slice(0, 400)}`);
    }
    return { headers: res.headers, data: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : null };
  }

  async function author(): Promise<string> {
    if (config.personUrn) return config.personUrn;
    const { data } = await request("GET", `${API}/userinfo`);
    return `urn:li:person:${data.sub}`;
  }

  async function uploadMedia(media: MediaSource, ref: string, owner: string) {
    const file = await media.get(ref);
    if (!file) throw new RetryableError(`media ${ref} was not found (did the sync run?)`);
    const kind = /\.mp4($|\?)/i.test(ref) ? "video" : "image";
    const { data: reg } = await request("POST", `${API}/assets?action=registerUpload`, {
      json: {
        registerUploadRequest: {
          recipes: [`urn:li:digitalmediaRecipe:feedshare-${kind}`],
          owner,
          serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
        },
      },
    });
    const uploadUrl: string =
      reg.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
    const asset: string = reg.value.asset;
    await request("PUT", uploadUrl, { body: file.body, headers: { "Content-Type": "application/octet-stream" } });

    // LinkedIn processes the file before it can be posted: wait until AVAILABLE (up to 5 minutes).
    const id = asset.split(":").pop();
    for (let i = 0; i < 60; i++) {
      const { data } = await request("GET", `${API}/assets/${id}`);
      const status = data?.recipes?.[0]?.status;
      if (status === "AVAILABLE") return { kind, asset };
      if (status === "PROCESSING_FAILED" || status === "CLIENT_ERROR") {
        throw new PermanentError(`LinkedIn could not process ${ref}: ${status}`);
      }
      await sleep(5000);
    }
    throw new RetryableError(`LinkedIn was still processing ${ref} after 5 minutes`);
  }

  /** Publishes one post. Returns its URN, or throws one of the three error kinds above. */
  async function publish(post: PostRow, media: MediaSource): Promise<string> {
    const text = linkedinText(post.body);
    if (length(text) > MAX_CHARS) throw new PermanentError(`${length(text)} characters, LinkedIn allows ${MAX_CHARS}`);
    if (!config.token) throw new RetryableError("LINKEDIN_ACCESS_TOKEN is not set");

    // Everything before the post request is safe to retry.
    let owner: string;
    const content: Record<string, unknown> = { shareCommentary: { text }, shareMediaCategory: "NONE" };
    try {
      owner = await author();
      if (post.media) {
        const { kind, asset } = await uploadMedia(media, post.media, owner);
        content.shareMediaCategory = kind.toUpperCase();
        content.media = [{ status: "READY", media: asset }];
      }
    } catch (e) {
      if (e instanceof PermanentError || e instanceof RetryableError) throw e;
      throw new RetryableError(`before posting: ${(e as Error).message}`);
    }

    let urn: string;
    try {
      const { headers } = await request("POST", `${API}/ugcPosts`, {
        json: {
          author: owner,
          lifecycleState: "PUBLISHED",
          specificContent: { "com.linkedin.ugc.ShareContent": content },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": post.visibility },
        },
      });
      urn = headers.get("x-restli-id") ?? "unknown";
    } catch (e) {
      // A 4xx is a clear refusal: nothing was posted. A 5xx or a lost connection: it may be out.
      if (e instanceof HttpError && e.status >= 400 && e.status < 500) throw new RetryableError(e.message);
      throw new UnknownOutcomeError((e as Error).message);
    }

    if (post.first_comment && urn !== "unknown") {
      try {
        await request("POST", `${API}/socialActions/${encodeURIComponent(urn)}/comments`, {
          json: { actor: owner, message: { text: post.first_comment } },
        });
      } catch (e) {
        // The post is out: a failed comment only warns, it never re-posts.
        console.warn(`${post.slug}: posted, but the first comment failed: ${(e as Error).message}`);
      }
    }
    return urn;
  }

  return { publish };
}
