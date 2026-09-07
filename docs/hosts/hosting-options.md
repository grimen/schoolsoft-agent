# Choose where your connector will run

Your connector needs a small computer that stays on and keeps its saved login
state. You own its hosting account. Closing your laptop does not stop a rented
server, but it does stop a connector running on that laptop.

**Before buying anything:** this is a release candidate. Real SchoolSoft login
with a public callback and real Claude/ChatGPT connections still need acceptance
testing. A working hosting page alone does not prove the school integration works.
Check your AI account has custom connectors first. See the
[parent guide](parent-connector.md#before-you-start).

| Your situation                                                               | Choose                                                                          | What you pay for                                                                       | What you maintain                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| You want fewer server administration steps                                   | [Render](parent-connector.md#route-1-your-render-account)                       | Paid service and persistent disk; no separate domain required for its supplied address | Secrets, manual app updates, account security and access permissions |
| You already use Hostinger, or want your own server                           | [Hostinger VPS walkthrough](hostinger.md)                                       | VPS rental, domain renewal and any backup extras                                       | Server updates, firewall, Docker, secrets and permissions            |
| You already have an always-on Docker computer or VPS and a Cloudflare domain | [Cloudflare Tunnel walkthrough](cloudflare.md)                                  | Existing computer/VPS, domain and any optional Cloudflare services                     | That computer plus the tunnel and connector                          |
| You use another Linux VPS provider                                           | [Portable Docker recipe](parent-connector.md#route-2-docker-on-your-own-server) | VPS, domain and backup options                                                         | Same responsibilities as Hostinger; dashboard buttons differ         |

A **VPS** is a rented computer you administer. A **domain** is the name you type
in a browser. **DNS** points that name to the right service. **HTTPS** protects
traffic between your browser and the service. The provider guides explain where
to enter each setting, what success looks like, and how to recover.

Compare the **renewal price**, taxes, minimum billing period and backup charges,
not just the introductory monthly figure. A VPS usually costs money while stopped
until you cancel it. Read the checkout and cancellation terms before ordering.
We do not quote a fixed price because offers and account currencies change.

## Cloudflare is not one hosting product

Cloudflare Tunnel gives an existing server a public address. It does not replace
that server. Our tunnel recipe keeps state on your own Docker volume.
[Cloudflare explains Tunnel routing](https://developers.cloudflare.com/tunnel/routing/).

Cloudflare Containers currently use ephemeral disks: their local files are lost
when a container restarts after sleeping. This connector relies on durable local
files and one process per state volume. Deploying it directly to Containers would
need a separately implemented and tested storage/lifecycle design; pointing at
our Dockerfile is insufficient. Workers/Pages also have no deployment adapter in
this project. These are not supported direct-hosting recipes today.
[Cloudflare container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/).

## Who can access the data?

The hosting administrator can potentially access running data. Cloudflare also
handles traffic when you use its proxy or Tunnel. Your AI provider receives the
results you authorize. The project maintainer has no service account in these
setups. Read the [full privacy explanation](parent-connector.md#what-is-private-and-from-whom).

These guides were checked against provider documentation on 7 September 2026.
Provider dashboards can change. Hostinger and Cloudflare account deployments have
not been live-tested by this project; the supplied configuration can be checked
locally without connecting to a school.
