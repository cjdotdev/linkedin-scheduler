# LinkedIn setup

linkedin-scheduler publishes through LinkedIn's official **Share on LinkedIn** product, which lets an app
post on the personal profile of the member who authorized it. It is self-serve: no review, no paid plan.
You create your own app: nobody else's app ever holds a token for your profile.

## 1. Create the app (once)

1. Go to <https://www.linkedin.com/developers/apps> and click **Create app**.
2. Fill in a name (it does not appear on your posts), a logo (any square image) and a **LinkedIn Page**.
   LinkedIn requires a Page, even though posts go to your personal profile. Any Page you belong to works,
   or create an empty one.
3. **Settings** tab: if a **Verify** button shows next to the Page, you can skip it. The products below
   do not need it.
4. **Products** tab: add
   - **Share on LinkedIn**: `w_member_social`, needed to post
     ([docs](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin));
   - **Sign In with LinkedIn using OpenID Connect**: `openid profile`, used to read your member id
     ([docs](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)).

## 2. Get a token

1. Open the [Token Generator](https://www.linkedin.com/developers/tools/oauth/token-generator) (also
   linked from the app's **Auth** tab as "OAuth 2.0 tools").
2. Choose your app, tick **openid**, **profile** and **w_member_social**, sign in and allow.
3. Copy the token. Note today's date plus 60 days: that is `LINKEDIN_TOKEN_EXPIRES`.

Check it without publishing anything:

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.linkedin.com/v2/userinfo
```

It answers with your name and a `sub`. Optional: set `LINKEDIN_PERSON_URN` to `urn:li:person:<sub>` as a
secret to save one request per post.

## 3. Give it to the Worker

- **Deploy button:** paste it in the `LINKEDIN_ACCESS_TOKEN` field during setup.
- **Afterwards:** Cloudflare dashboard → your Worker → **Settings** → **Variables and Secrets**, or
  `pnpm exec wrangler secret put LINKEDIN_ACCESS_TOKEN`.

The token can post as you: never put it in a file, a commit, an issue or a chat.

## Renew the token

The token expires after **60 days**, and LinkedIn only gives refresh tokens to approved partners
([docs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)).
From 7 days before `LINKEDIN_TOKEN_EXPIRES`, `/status` shows a warning. Renewing is step 2 again, then
replace `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_TOKEN_EXPIRES`. With an expired token, posts fail with a
clear `401` message and nothing is published.

## Things that catch people out

- **A token generated before you added a product does not carry its permission.** LinkedIn answers
  `403`: generate a new token.
- **Requesting a different set of scopes invalidates your previous tokens**
  ([docs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)).
  Generate a token with other scopes for another experiment, and the scheduler's token stops working.
- **Personal profile only.** Posting as a Company Page needs `w_organization_social`, a partner permission.
- **150 requests per member per day.** One post with an image and a first comment uses about 6.
