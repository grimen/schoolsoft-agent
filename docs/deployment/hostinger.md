# Hostinger: set up your own parent connector

This walkthrough uses a **Hostinger VPS**, a rented computer in your own account.
It is intended for a fresh server. Do not reinstall an existing server to follow
these steps: reinstalling can erase its contents.

Read [hosting choices](README.md) first. This is a release candidate;
SchoolSoft's real public callback and AI-app acceptance remain unverified. Do not
purchase a long contract expecting a proven phone integration.

## 1. Choose the right product

Choose a VPS with the **Ubuntu Docker template**, rather than a website-builder or
WordPress plan. Hostinger documents a template with Docker and Compose already
installed. You will also need a domain you control. Choose a region appropriate
for your family, review renewal pricing and backup options, and turn on account
two-factor authentication.
[Hostinger Docker template](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/).

The VPS must have enough spare memory to build the application. If the build is
killed for lack of memory, stop and adjust the server resources; repeatedly
restarting the same build will not fix it. No Hostinger plan has been benchmarked
by this project.

**Checkpoint:** hPanel shows your VPS as running, its public IP address, and the
Docker environment. Save the IP address; it is needed in step 2.

## 2. Give it a browser address

Use a new subdomain such as `school.your-domain.com`, leaving your existing
website and email alone. In the dashboard that manages your domain's DNS, create:

| Field             | Value                 |
| ----------------- | --------------------- |
| Type              | `A`                   |
| Name              | `school`              |
| Points to / value | Your VPS IPv4 address |
| TTL               | Default               |

Remove a conflicting record only for this new `school` name if necessary. Do not
delete your main website or email records. If your DNS is managed by Cloudflare,
choose **DNS only** for this direct-server route. The separate
[Cloudflare guide](cloudflare.md) explains the Tunnel alternative.
[Hostinger domain instructions](https://www.hostinger.com/support/1583227-how-to-point-a-domain-to-your-vps-at-hostinger/).

DNS changes may take time to appear. An incorrect IPv6 (`AAAA`) record for this
same name can also send visitors to the wrong computer.

## 3. Allow the website through the firewall

In the VPS firewall settings, allow incoming TCP ports **80 and 443**. Those are
used for HTTPS setup and browsing. Keep the connector's port **3000 closed** to
the public. Preserve your existing administration/SSH access rule so you do not
lock yourself out; if using SSH, restrict it to your own IP when practical. Check
both Hostinger's firewall and any firewall installed inside Ubuntu.
[Hostinger firewall guide](https://www.hostinger.com/support/4805502-how-to-set-up-a-firewall-at-vps/).

## 4. Open the server terminal and download the project

Open the VPS **Web Console** in hPanel. This terminal runs commands on your rented
server, not on your phone or laptop. Paste one command at a time and press Enter.
[Hostinger Web Console](https://www.hostinger.com/support/how-to-use-the-web-console-in-hostinger/).

First check the installed tools:

```sh
docker --version
docker compose version
git --version
```

If Git is missing, install it from Ubuntu's packages in the administrator console:

```sh
apt-get update
apt-get install -y git
```

Download the connector branch while PR #16 is under review:

```sh
git clone --branch feat/parent-hosted-connectors https://github.com/grimen/schoolsoft-agent.git
cd schoolsoft-agent
```

For an approved deployment, select the reviewed release or commit before building;
do not automatically track changes on this development branch. Never clone over
an existing deployment folder. **Checkpoint:** `ls` includes
`Dockerfile.connector` and `compose.connector.yaml`.

Hostinger also has a Docker Manager with Compose import. Our recipe uses a local
Dockerfile and Caddy configuration, so importing just the YAML URL is insufficient.
The terminal route above downloads all required files together.
[Docker Manager deployment options](https://www.hostinger.com/support/12040815-how-to-deploy-your-first-container-with-hostinger-docker-manager/).

## 5. Create your private settings and start

Follow [Docker setup steps 2–3](connector.md#route-2-docker-on-your-own-server)
to create the `.env` file with your subdomain, school identifier and two different
random secrets. A text editor such as `nano .env` can create the file; in Nano,
Ctrl+O then Enter saves, and Ctrl+X exits. Install Nano from Ubuntu's packages if
it is absent. Keep the secrets in your password manager too.

Run the start command from the project directory:

```sh
docker compose -f compose.connector.yaml up -d --build
docker compose -f compose.connector.yaml ps
```

**Checkpoint:** the connector becomes healthy and the `https` service is running.
Open `https://school.your-domain.com` using your actual name. You should see the
owner sign-in page without a certificate warning. If it fails, check DNS and
ports 80/443 before changing passwords. Caddy creates and renews the certificate.

Finish [connecting SchoolSoft and your AI app](connector.md#connect-your-school-and-ai-app).
Closing the Web Console does not stop these background services.

## Keep it working, or remove it

Apply Ubuntu security updates, keep Docker maintained and update the connector
only to a reviewed revision. Preserve `.env` and the state volume during updates.
Check the owner page and one permitted tool after maintenance. A server reboot
should restart the services automatically; verify that once yourself.

To pause from the same project folder:

```sh
docker compose -f compose.connector.yaml stop
```

To resume, use the same `up -d --build` command above. Do not add `--volumes` or
`-v` to removal commands unless you intend to delete saved state. Stopping Docker
does not cancel VPS billing. To leave permanently, follow
[removal and backup guidance](connector.md#everyday-use-and-recovery), then
cancel the VPS in Hostinger and review domain renewal separately.
