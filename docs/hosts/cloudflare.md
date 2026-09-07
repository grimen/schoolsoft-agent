# Cloudflare Tunnel: give your connector a public address

Use this route if you already have a computer or VPS that can keep Docker running
and a domain managed in Cloudflare. A **tunnel** carries requests from your public
HTTPS address to that computer without opening incoming website ports on it.
The connector and its saved login state still run on your computer or VPS.
[How Cloudflare Tunnel works](https://developers.cloudflare.com/tunnel/).

This is a fresh-deployment recipe, not a migration from an existing Render/Caddy
installation. It is a release candidate: live Cloudflare, SchoolSoft and AI-app
acceptance are still required. See [hosting choices](hosting-options.md) before
paying. If you have no always-on computer, use Render or a VPS; Cloudflare Tunnel
alone cannot host this application.

## 1. Prepare the computer and settings

Install Docker with Compose on the chosen computer, or use a VPS Docker template.
Download the complete connector revision you intend to review/run. During PR #16:

```sh
git clone --branch feat/parent-hosted-connectors https://github.com/grimen/schoolsoft-agent.git
cd schoolsoft-agent
```

Use the reviewed release/commit before a real deployment. Follow
[Docker setup step 2](parent-connector.md#route-2-docker-on-your-own-server) to make
`.env` with `CONNECTOR_DOMAIN`, `SCHOOLSOFT_SCHOOL`, `SCHOOLSOFT_ADMIN_PASSWORD` and
`SCHOOLSOFT_STORAGE_KEY`. Do not run the Caddy start command from that guide: this
route uses `compose.cloudflare.yaml` instead.

Use a new, unused hostname, for example `school.your-domain.com`. Do not point an
A record at the server for this route. Cloudflare associates the name with your
tunnel. Keep existing website and email DNS records intact.

## 2. Create a named tunnel in your own Cloudflare account

In Cloudflare, open **Networking → Tunnels**, create a tunnel and give it a
recognizable name such as `My school connector`. Choose the `cloudflared` connector
where prompted. The current provider walkthrough is the reference if dashboard
labels differ: [create a tunnel](https://developers.cloudflare.com/tunnel/setup/).

The installation instructions contain a private tunnel token, usually beginning
`eyJ`. Copy **only the token** into your `.env` as a fifth setting:

```dotenv
TUNNEL_TOKEN=replace-with-the-private-token-from-your-tunnel
```

Do not run the dashboard's separate installation command; the Compose file starts
that same tunnel software for you. Save the token in your password manager and
keep `.env` private. Anyone who has the token can connect a tunnel process to your
account. [Token handling and rotation](https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/).

Use a named tunnel with your stable domain. Temporary Quick Tunnels have changing
addresses and do not support Server-Sent Events, which this MCP transport can use.
[Quick Tunnel limitations](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

## 3. Start both services

From the project folder:

```sh
docker compose -f compose.cloudflare.yaml up -d --build
docker compose -f compose.cloudflare.yaml ps
```

This recipe starts the connector and `cloudflared`; it publishes no host ports.
Only the tunnel service receives the tunnel token. The SchoolSoft secrets are
passed only to the connector. State stays in its named Docker volume.

**Checkpoint:** the connector is healthy, the tunnel container is running, and
Cloudflare shows the tunnel connected. An offline tunnel usually means the token
is wrong, the computer is asleep, or outbound traffic is blocked. Follow
[Cloudflare troubleshooting](https://developers.cloudflare.com/tunnel/setup/) for
required connectivity; opening incoming port 3000 is not the fix.

## 4. Route your hostname to the connector

In the tunnel's **Routes**, add a **Published application**. Set:

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Public hostname | Your exact `CONNECTOR_DOMAIN`, such as `school.your-domain.com`                |
| Service type    | HTTP                                                                           |
| Service URL     | `http://connector:3000` (or `connector:3000` when HTTP is selected separately) |
| Path            | Leave empty, so the whole hostname reaches the connector                       |

`connector` is the name of the other Docker service. `localhost` would refer to
the tunnel container itself and would fail. Leave the HTTP Host Header override
unset, so your public hostname reaches the connector unchanged. The internal
Docker connection is HTTP; Cloudflare serves HTTPS to visitors.
[Published application routing](https://developers.cloudflare.com/tunnel/routing/).

Do not put an extra interactive Cloudflare Access login, browser challenge or
cache-everything rule across this dedicated hostname. AI clients need to reach
OAuth discovery and token endpoints without an additional browser login. The
connector's own OAuth and owner password still protect access; published does
not mean school data is anonymous. Avoid disabling security rules on unrelated
websites. If you already have organization-wide policies, ask the account
administrator to review this hostname's policy before proceeding.

**Checkpoint:** visit your HTTPS hostname. The owner page should open without an
extra Cloudflare login. Then follow
[SchoolSoft and AI-app connection](parent-connector.md#connect-your-school-and-ai-app).
If you get a 502, check the service name and port. A 421 points to a hostname that
does not match `CONNECTOR_DOMAIN`, or a changed Host header.

## Privacy, upkeep and stopping

Cloudflare terminates public HTTPS and forwards the requests. Treat Cloudflare
as another provider processing this traffic, alongside the server administrator
and AI provider. It is not an end-to-end encrypted channel that hides results
from Cloudflare. The project author does not operate the tunnel or receive data.

The computer must remain awake and connected. Restart with the same Compose file,
project directory and `.env` to keep the same volume. Do not run two connector
instances against the same state. Review updates to both this project and the
`cloudflared` image before applying them.

To pause: `docker compose -f compose.cloudflare.yaml stop`. To resume, repeat
step 3. If the tunnel token is exposed, rotate it in Cloudflare, replace its value
in `.env`, then recreate the tunnel service. To leave permanently, revoke AI
permissions first, stop the services, remove the published route and tunnel, and
follow the [data-removal guidance](parent-connector.md#everyday-use-and-recovery).
Cancel VPS billing separately if you rent the computer.
