# Connect Claude or ChatGPT using your own server

This option is for a parent who wants to use their existing AI app without
installing OpenClaw, Hermes, Pi or another agent. You rent a small computer on the
internet, called a **server**, and run your own copy of this project there. Claude
or ChatGPT connects to that computer using a private, revocable permission.

**Release candidate:** the connector and deployment files are implemented, but a
real SchoolSoft login using an external HTTPS callback still needs a parent-led
acceptance test. Automated tests cannot establish whether SchoolSoft accepts that
callback. Claude/ChatGPT account eligibility and mobile availability also need
checking with real accounts. Do not buy hosting expecting a proven phone setup
yet. The [support matrix](../integrations/support-matrix.md) lists the existing local alternatives.

One server is for **one guardian account**, with that guardian's selected children.
Use separate servers for different guardians. This project is independent of
SchoolSoft AB and BankID; neither endorses or operates it.

## Before you start

You need your usual SchoolSoft guardian login and BankID, a Claude or ChatGPT
account that allows custom remote connectors, and your own hosting account. Check
that your AI app offers **Add custom connector/app** before paying for anything.
Your workplace's account administrator may disable this feature.

Start with [choose a hosting provider](README.md) for a plain-language comparison,
including detailed [Hostinger VPS](hostinger.md) and [Cloudflare Tunnel](cloudflare.md) walkthroughs.
The two foundational routes below are:

| Route           | What you arrange                                     | Effort                                                         |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| Render          | Your own Render account and paid service with a disk | Fewer server administration steps; guided below                |
| Your own server | Docker, a domain name, DNS and ports 80/443          | For you or a trusted person comfortable administering a server |

You still complete BankID yourself. Never give an AI assistant your BankID code,
admin password, storage key or hosting login.

## What is private, and from whom?

The project author receives no account, session or school data from this deployment.
Your server stores the SchoolSoft login state encrypted on its disk. The encryption
key is stored separately in your hosting account's environment settings.

Your hosting provider, anyone with administrator access to that account or server,
and software running on the server could access the data while it is being used.
Encryption does not remove that trust. Claude or ChatGPT receives the school data
returned by the tools you use, and may retain it under your account's data settings.
The connector therefore does not mean that only you can ever see the information.

The initial tool selection is deliberately small: children, schedule and lunch.
There is no remote BankID automation, web-session import, absence reporting or
message sending. A permission can be removed without disconnecting another AI app.
This guide describes the technical boundaries; it is not a guarantee of legal
compliance for every use of children's data.

## Route 1: your Render account

A **disk** keeps your login state when the server restarts. Render's persistent disks
require a paid service, and this template uses one server in Frankfurt with a 1 GB
disk. Review the price shown by Render before creating it. Disk-backed deployments
can have brief downtime during updates. [Render disk documentation](https://render.com/docs/disks)

1. Make your own GitHub fork of this repository, using the reviewed connector
   release you intend to run. In Render, choose **New → Blueprint**, connect your
   fork and select its `render.yaml`. A Blueprint is a saved setup recipe. At the
   release-candidate stage, the recipe must come from the branch containing these
   connector files; the default branch may not contain them yet.
2. Review the service name, region, paid plan and disk. The recipe turns automatic
   code deployments off. Enter `SCHOOLSOFT_SCHOOL`: the school identifier from your
   SchoolSoft website address, not your child's name. For an address like
   `https://sms.schoolsoft.se/example-school/...`, enter `example-school`.
3. Enter `SCHOOLSOFT_PUBLIC_URL`, the complete HTTPS address for this service, such
   as `https://your-unique-service.onrender.com`. Include no path after the hostname.
   If Render has not assigned the address yet, use `https://pending.invalid`
   temporarily. Create the service, copy its actual address from the dashboard,
   replace this setting, and deploy again **before logging in**.
4. Render generates `SCHOOLSOFT_ADMIN_PASSWORD` and `SCHOOLSOFT_STORAGE_KEY`
   automatically. Open the service's **Environment** page and save both in your
   password manager. The admin password opens your connector's management page.
   The storage key protects its saved state; do not replace it during an ordinary
   update. Render generates a random 256-bit value for each secret.
   [Render environment variable documentation](https://render.com/docs/blueprint-spec#generating-random-secrets)
5. Wait for the service to become healthy. Open its HTTPS address. You should see
   the connector's owner sign-in page. Enter the admin password there. **Checkpoint:**
   this page is on your own service address, and it accepts the password saved in
   step 4. If the service fails to start, check the environment names and the disk
   mount `/data`; do not post environment values or login URLs in an issue.

Continue with **Connect your school and AI app** below.

## Connect your school and AI app

1. Open your server's address and sign in to the owner page. Start SchoolSoft login
   from that page. It opens the school's login address. Complete BankID yourself in
   the usual way, then return to the owner page.
2. Confirm that login succeeded. You will select children on the consent page
   when connecting each AI app.
   **Checkpoint:** if SchoolSoft rejects the callback address or login remains
   pending, stop here. Repeating an automated test will not fix SchoolSoft's
   redirect policy. Use a supported local option until this is resolved.
3. Copy your connector address: your HTTPS server address followed by `/mcp`, for
   example `https://your-unique-service.onrender.com/mcp`.
4. In the AI app's custom connector/app settings, add that address and choose OAuth
   authentication if asked. Follow the app's current instructions:
   [Claude](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
   or [ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt).
   Do not paste your admin password into a chat or a connector URL.
5. The app sends you to **your server's consent page**. Sign in if needed, check the
   app and requested permissions, select only the children and tools you want
   that app to use, then approve. Connect Claude and ChatGPT
   separately if you use both. Return to the AI app and enable the connector in a
   conversation.
6. Ask: **“What is for lunch at school this week?”** Then ask for one selected
   child's next school day. **Checkpoint:** the answer should agree with what you
   see in SchoolSoft. Check that an unselected child cannot be retrieved.

Complete setup in a desktop browser first. After a successful real test, check
whether the same connector appears in your phone app. A missing connector option
usually concerns the AI account or client, not SchoolSoft. Account settings and
availability can differ between desktop, web and mobile.

## Route 2: Docker on your own server

This route assumes a server already runs Docker with Compose and that you can point
a domain name at it. Ask a trusted administrator to help if those steps are new to
you. They will have access to your server, so choose them accordingly. Caddy, included
in this recipe, obtains and renews the HTTPS certificate. Your domain must point to
the server, and inbound ports 80 and 443 must reach it.

1. Download or clone the reviewed release on the server and open a terminal in its
   project folder. For terminal basics, see [computer basics](../getting-started/computer-basics.md).
2. Create a file named `.env` in that folder with these four settings. Replace the
   example domain and school identifier. Generate **two different** random secrets
   with a password manager: the admin password needs at least 32 characters; the
   storage key needs 64 hexadecimal characters or a base64-encoded 32-byte value.
   `openssl rand -hex 32` can generate either value; run it separately for each.

   ```dotenv
   CONNECTOR_DOMAIN=school.example.com
   SCHOOLSOFT_SCHOOL=example-school
   SCHOOLSOFT_ADMIN_PASSWORD=replace-with-your-first-random-secret
   SCHOOLSOFT_STORAGE_KEY=replace-with-your-second-random-secret
   ```

   Save both secrets in your password manager. Protect the file with `chmod 600 .env`.
   The repository ignores `.env`, and the Docker build excludes it. Never commit or
   send it. The sample strings above are placeholders and will not make a working
   deployment.

3. Start your copy:

   ```sh
   docker compose -f compose.connector.yaml up -d --build
   ```

4. Open `https://school.example.com`, replacing the domain with yours. You should
   see the owner sign-in page. Then follow **Connect your school and AI app** above.

Only Caddy publishes ports to the internet; the connector's port 3000 stays inside
the Docker network. A named volume stores state at `/data`, and the connector runs
as an unprivileged user. At startup, a small initialization step fixes ownership
of the `/data` directory and then permanently drops administrator privileges
before loading the connector. It never changes ownership recursively. Keep one connector process per state volume. Do not add
replicas or let another container share this volume.

## Everyday use and recovery

- **The AI says to sign in again:** open your server's owner page and repeat the
  SchoolSoft login. BankID sessions can expire; this does not require reinstalling
  the connector.
- **Remove one AI app:** revoke its permission on the owner page, then remove the
  connector in that app. Verify that it can no longer retrieve school data. The
  other app should retain its own permission.
- **Restart or update:** preserve the disk and storage key. On Render, manually
  deploy the reviewed revision. With Docker, update your checkout and rerun the
  `up -d --build` command above. Check owner status and ask for lunch again.
- **Lost admin password:** retrieve it from your password manager or your hosting
  account's environment settings. If it may have been exposed, stop the service,
  replace it with a new random value, restart, and revoke existing app permissions.
- **Lost storage key:** saved state cannot be decrypted without it. Restore the
  original key from your password manager. If it is gone, start with a new empty
  state volume and a new key, then reconnect SchoolSoft and each AI app.
- **Restore an old disk backup:** keep the service unavailable while recovering.
  An old backup can contain permissions that were later revoked. Start with empty
  connector state and reconnect instead of making a stale permission store public.
- **Stop using the connector:** revoke app permissions and log out of SchoolSoft
  on the owner page. Delete the service and disk in your hosting account when you
  no longer need them, and review the provider's backup retention settings. With
  Docker, `docker compose -f compose.connector.yaml down` stops the service and
  keeps volumes; add `--volumes` only when you intend to erase its saved state and
  Caddy certificates. Remove saved environment secrets too.

Logging out here cannot delete answers already retained by Claude or ChatGPT, or
backups kept by a hosting provider. Manage those separately in the relevant account.

## What still needs a real acceptance test?

Before calling this a supported parent-facing deployment, verify one complete
BankID login with the HTTPS callback, child selection, both AI clients' consent and
tool calls, restart/refresh, separate revocation, deletion, and phone availability.
These require the parent's own accounts and explicit BankID action. Packaging and
mock-provider tests exercise the implementation without exposing school data; they
do not stand in for these checks.

### Sign out of the dashboard

Use **Sign out of this dashboard** after managing access, especially on a shared
computer. This signs out that browser only. Your approved AI connections keep
working. Each connected-app entry shows its approved children and expiry date;
use **Disconnect this app** to remove that connection instead.

### If you change the network setup

The supplied Render and Caddy setups place one HTTPS proxy in front of the
connector. The connector trusts exactly one proxy hop for per-client request
limits (`SCHOOLSOFT_PROXY_HOPS=1`). Keep its internal port private. If you change
that arrangement, set this value to the actual trusted hop count (0, 1 or 2);
never trust forwarding headers from an untrusted public path. This advanced
setting is unnecessary for the supplied templates.

### Repeat the container checks

Developers can run the automated deployment smoke test without a SchoolSoft
account. It uses synthetic data and checks disk ownership, dropped privileges,
encrypted persistence, restart and shutdown:

```sh
docker build -f Dockerfile.connector -t schoolsoft-connector:review .
node test/packaging/connector-container.mjs
```
