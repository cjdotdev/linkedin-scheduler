import { describe, expect, it } from "vitest";
import { createLinkedIn, PermanentError, RetryableError, UnknownOutcomeError } from "../src/core/linkedin";
import { linkedinText } from "../src/core/text";
import type { MediaSource, PostRow } from "../src/core/types";
import { cloudflareMedia } from "../src/cloudflare/media";

type Call = { method: string; url: string; body?: unknown };

/** A fake LinkedIn: answers by URL, records every call. */
function fakeLinkedIn(overrides: Partial<Record<"post" | "comment", () => Response>> = {}) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method!, url, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    if (url.endsWith("/userinfo")) return Response.json({ sub: "abc" });
    if (url.includes("registerUpload")) {
      return Response.json({
        value: {
          uploadMechanism: { "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: "https://upload.example/1" } },
          asset: "urn:li:digitalmediaAsset:A1",
        },
      });
    }
    if (url === "https://upload.example/1") return new Response(null, { status: 201 });
    if (url.includes("/assets/A1")) return Response.json({ recipes: [{ status: "AVAILABLE" }] });
    if (url.endsWith("/ugcPosts")) return overrides.post?.() ?? new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:9" } });
    if (url.includes("/comments")) return overrides.comment?.() ?? new Response("{}", { status: 201 });
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { calls, linkedin: createLinkedIn({ token: "t", fetch, sleep: async () => {} }) };
}

const post = (over: Partial<PostRow> = {}): PostRow => ({ slug: "a", body: "**Hi** there", visibility: "PUBLIC", media: null, first_comment: null, ...over });
const noMedia: MediaSource = { get: async () => null };
const oneImage: MediaSource = { get: async () => ({ body: new ArrayBuffer(4), size: 4 }) };

describe("linkedinText", () => {
  it("turns **x** into Unicode bold and keeps accents", () => {
    expect(linkedinText("**Hé 1**, ok")).toBe("𝗛𝗲́ 𝟭, ok");
  });
});

describe("publish", () => {
  it("posts text as the token's member", async () => {
    const { calls, linkedin } = fakeLinkedIn();
    expect(await linkedin.publish(post(), noMedia)).toBe("urn:li:share:9");
    const sent = calls.find((c) => c.url.endsWith("/ugcPosts"))!.body as any;
    expect(sent.author).toBe("urn:li:person:abc");
    expect(sent.specificContent["com.linkedin.ugc.ShareContent"]).toMatchObject({ shareMediaCategory: "NONE", shareCommentary: { text: "𝗛𝗶 there" } });
  });

  it("uploads the image, waits for it, then posts it", async () => {
    const { calls, linkedin } = fakeLinkedIn();
    await linkedin.publish(post({ media: "images/a.png" }), oneImage);
    expect(calls.map((c) => c.method + " " + c.url.split("?")[0].replace("https://api.linkedin.com/v2", ""))).toEqual([
      "GET /userinfo",
      "POST /assets",
      "PUT https://upload.example/1",
      "GET /assets/A1",
      "POST /ugcPosts",
    ]);
    const content = (calls.at(-1)!.body as any).specificContent["com.linkedin.ugc.ShareContent"];
    expect(content).toMatchObject({ shareMediaCategory: "IMAGE", media: [{ status: "READY", media: "urn:li:digitalmediaAsset:A1" }] });
  });

  it("is retryable when the media is missing, and posts nothing", async () => {
    const { calls, linkedin } = fakeLinkedIn();
    await expect(linkedin.publish(post({ media: "images/x.png" }), noMedia)).rejects.toBeInstanceOf(RetryableError);
    expect(calls.some((c) => c.url.endsWith("/ugcPosts"))).toBe(false);
  });

  it("is retryable on a 4xx, unknown on a 5xx", async () => {
    const refused = fakeLinkedIn({ post: () => new Response("throttled", { status: 429 }) });
    await expect(refused.linkedin.publish(post(), noMedia)).rejects.toBeInstanceOf(RetryableError);
    const unclear = fakeLinkedIn({ post: () => new Response("oops", { status: 502 }) });
    await expect(unclear.linkedin.publish(post(), noMedia)).rejects.toBeInstanceOf(UnknownOutcomeError);
  });

  it("refuses a post over 3000 characters before calling LinkedIn", async () => {
    const { calls, linkedin } = fakeLinkedIn();
    await expect(linkedin.publish(post({ body: "x".repeat(3001) }), noMedia)).rejects.toBeInstanceOf(PermanentError);
    expect(calls).toHaveLength(0);
  });

  it("adds the first comment, and a failed comment never fails the post", async () => {
    const ok = fakeLinkedIn();
    await ok.linkedin.publish(post({ first_comment: "The link" }), noMedia);
    expect(ok.calls.at(-1)!.url).toContain("/socialActions/urn%3Ali%3Ashare%3A9/comments");
    const broken = fakeLinkedIn({ comment: () => new Response("no", { status: 500 }) });
    await expect(broken.linkedin.publish(post({ first_comment: "The link" }), noMedia)).resolves.toBe("urn:li:share:9");
  });
});

describe("cloudflareMedia", () => {
  it("reads media from KV", async () => {
    const kv = { get: async (key: string) => (key === "images/a.png" ? new ArrayBuffer(3) : null) } as unknown as KVNamespace;
    const media = cloudflareMedia({ MEDIA: kv });
    expect((await media.get("images/a.png"))?.size).toBe(3);
    expect(await media.get("images/b.png")).toBeNull();
  });
});
