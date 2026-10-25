# LinkedIn setup

The scripts publish through LinkedIn's official **Share on LinkedIn** product, which lets an app post on
the personal profile of the member who authorised it. It is self-serve: no review, no paid plan.

## 1. Create the app (once)

1. Go to <https://www.linkedin.com/developers/apps> and click **Create app**.
2. Fill in a name (it does not appear on your posts), a logo (any square image) and a **LinkedIn Page**.
   LinkedIn requires a Page; any Page you belong to works, or create an empty one. Posts still go to your
   personal profile.
3. **Settings** tab: if a **Verify** button shows next to the Page, a super admin of that Page must open
   the link it generates. If you are not one, skip it: the two products below do not need it.
4. **Products** tab: add **Share on LinkedIn** (gives `w_member_social`, needed to post) and
   **Sign In with LinkedIn using OpenID Connect** (gives `openid profile`, used to read your person id).

## 2. Get a token

1. Open the token generator: <https://www.linkedin.com/developers/tools/oauth/token-generator> (also
   linked from the app's **Auth** tab as "OAuth 2.0 tools").
2. Choose your app, tick **openid**, **profile** and **w_member_social**, request the token, sign in and
   allow.
3. Copy the token into `.env`, with its expiry date (about 60 days from today):

   ```
   LINKEDIN_ACCESS_TOKEN=AQ...
   LINKEDIN_TOKEN_EXPIRES=2026-12-24
   ```

4. Check it, without publishing anything:

   ```bash
   python3 scripts/publish.py --check
   ```

   It prints `Token OK: <your name>` and a `LINKEDIN_PERSON_URN=urn:li:person:...` line: copy that line
   into `.env` to save one request per run.

Never commit `.env` (it is in `.gitignore`) and never paste the token anywhere: it can post as you.

## 3. Renew it

The token expires after about 60 days. From 7 days before `LINKEDIN_TOKEN_EXPIRES`, every run logs a
warning. Renewing is step 2 again: generate a new token, replace it in `.env`, update the date. A run
with an expired token stops with a clear `401` message and publishes nothing.
