# Evolution timeout recovery — 2026-11-19

Target: `marketing-ai_evolution-api` on 129.121.32.117. This patch is specific to
the exact bundled Evolution 2.4.0-rc2 image installed there. `patch.cjs` fails
closed if either expected code anchor is not unique. It changes the CommonJS
entrypoint used by `npm run start:prod`; it does not modify the upstream source maps.

Incident evidence: simultaneous 408 disconnects at 05:48–05:51 BRT, Docker DNS
timeouts, and upstream `codesToNotReconnect` including 408 followed by
`logout.instance` which removes authentication state. No host/container restart.
DNS failures coincide with the incident; they do not prove the precise origin
of every WhatsApp socket failure.

Behavior: intercept 408 before the logout branch, preserve authentication,
retry after 15/30/60/120/240/300 seconds, stop after six attempts, and emit
`connection.update` with `recovery=exhausted` plus a warning. Successful open
clears the retry state. Delete/end flags prevent queued reconnects. Other
status codes retain upstream behavior. Existing CRM connection monitoring
continues to receive the close/open events. No external notification channel
was configured by this patch.

Validation: `node --test ops/evolution-408/timeoutRecovery.test.cjs`, image build
anchor assertions and syntax check, same tests inside a network-isolated image.
No paired test number was available; no live timeout was injected into customer
sessions. Production restart reconnected Softilux, Demo and Informac. Demo2 and
ClikPrinter lacked credentials before deployment and require pairing again.

Production image: `lcd/evolution:408-recovery-20261119` (local Docker image).
Original image retained as `lcd/evolution:pre-408-20261119`. Root-only database
backup and previous service definition: `/var/backups/evolution-408-20261119/`.
Service DNS override: 1.1.1.1 and 9.9.9.9, both tested from this VPS. Host DNS and
other services were not changed. Swarm update/rollback order: stop-first to
avoid simultaneous processes accessing the same WhatsApp credentials.

Build on the VPS after copying this directory:

```sh
sudo docker build --build-arg BASE_IMAGE=lcd/evolution:pre-408-20261119 \
  -t lcd/evolution:408-recovery-20261119 /tmp/lcd-evolution-408
```

Rollback immediately after this deployment:

```sh
sudo docker service rollback marketing-ai_evolution-api
```

Follow-up on 2026-11-19: EasyPanel source is now an inline Dockerfile pinned to
the original upstream manifest digest, embedding the helper and guarded patch.
`persist-easypanel.cjs` performs a transactional update of only source/build and
zeroDowntime, retaining the original serialized service record in
`/etc/easypanel/data/backups/evolution-source-before-408-20261119.json`.
The exact saved Dockerfile was independently rebuilt successfully as
`lcd/evolution:408-persistent-20261119`. New panel deploys rebuild this patch;
do not manually replace the source with the original rc2 tag.

DNS is also persistent in the ens3 NetworkManager profile (ignore automatic DNS,
1.1.1.1 and 9.9.9.9) and `/etc/resolv.conf`, which is a regular static file on
this host. This affects host DNS and DNS inherited by new containers. Original
profile values and resolv.conf are backed up in the incident backup directory.
No Docker daemon/network restart was required.

The main application repository `connectbrazilads/multiatendimento`, commit
`6fd9e21`, adds the shared outage incident to the existing support overview and
notification monitor. It requires two active client companies, paired phone
numbers, explicit close/connecting states lasting at least two minutes, and
connection transitions in a ten-minute window. It uses the configured severity,
confirmation rounds, recipients, sender fallback, deduplication and recovery
notifications. If all configured senders are offline, delivery waits for a
sender to recover; the panel still records the incident. No alternate external
notification channel is introduced.
