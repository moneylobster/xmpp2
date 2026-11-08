# Ghost Notifications — Diagnosis & Fix

## Symptom

Occasional "ghost" push notifications on the phone — a notification with no real
message behind it. The user suspected an fpush heartbeat.

## Root cause (confirmed from `mod_cloud_notify` source on the server)

fpush has **no heartbeat**. It only pushes when the XMPP server sends it a
XEP-0357 publish, and acks `ping` IQs without pushing
(`fpush/fpush/src/xmpp/message_loop.rs`).

The real cause is on the Snikket/Prosody side: `mod_cloud_notify` sends a push
for **unimportant** stanzas (chat states/typing, receipts, read markers,
presence) in addition to real messages. fpush turned *every* push into a generic
"You have a new message", so the unimportant ones surfaced as ghosts. The volume
also tripped fpush's 20s-per-token rate limit, which can drop real pushes.

How importance is encoded in the push payload (confirmed by dumping the real
payload fpush receives — **not** by reading the module source, which was
misleading here):

On this server (`mod_cloud_notify` + `mod_cloud_notify_extensions`) **every**
push carries the XEP-0357 summary `jabber:x:data` form with the same fields:
`FORM_TYPE`, `message-count` (always `"1"`), `pending-subscription-count`,
`last-message-sender`, and `last-message-body`. So field *presence* tells you
nothing. The distinguisher is the **value**:

- **Important** (real message, OMEMO, incoming call): `last-message-body` has a
  non-empty `<value>` (the dummy `"New Message!"` string — *not* real content).
- **Unimportant** (typing, receipts, markers, presence): `last-message-body` is
  present but **empty** (`<field var="last-message-body"/>`, `children: []`).

Earlier matchers that keyed on the *presence* of `last-message-body` (or a
`<priority>` tag, which this server doesn't emit) classified everything as
important and dropped nothing — which is why the ghosts persisted across the
first deploys. The diagnostic dump of the actual payload is what revealed it.

Note: the `push_notification_important_body_only = true` line that was in
`push-component.cfg.lua` is a **no-op** — that option name is not read anywhere
in `mod_cloud_notify`. It can be removed.

## Fix (implemented)

### fpush — drop unimportant pushes (fork `moneylobster/fpush`, commit `3c290ac`)

`message_loop.rs` now calls `is_important_push()` on each push payload and, if
the push is unimportant, acks the IQ **without** sending to FCM.
`is_important_push` recursively finds the `last-message-body` field and returns
true only if it has a **non-empty `<value>`**. This:

- kills the ghost notifications (only messages with a populated body notify),
- removes the unimportant traffic from the rate limiter, so real pushes are less
  likely to be dropped,
- uses **no message content** (the body value is only ever the dummy string),
- keeps OMEMO/calls working — `mod_cloud_notify` populates `last-message-body`
  (with the dummy) for those too.

Verified live: ~6 dropped vs. ~2 sent over 5 min, real messages still deliver.

Deployed on host `nano` (aarch64) at `/etc/snikket`, which builds fpush from the
fork via `fpush-docker/Dockerfile`:

```
cd /etc/snikket
docker compose build --no-cache fpush   # --no-cache busts the cached git clone
docker compose up -d fpush
```

### App — stop stale push registrations (`src/utils/push.ts`)

Independently, the app now persists the last-registered push node
(`xmpp-push-enabled-node`) and sends `<disable>` for the **old** node when the
FCM token rotates (both on a live `tokenReceived` refresh and at startup if it
changed while the app was closed). This stops the server pushing to dead tokens
(the `UNREGISTERED` / blocked-token spam seen in the logs). No privacy impact.

## Verification

- fpush rebuilt and redeployed cleanly (`release` build OK, container healthy,
  reconnected to the component on port 5347).
- Functional check (do on a device): background the phone, then
  1. send it a real message → exactly **one** notification arrives (and the log
     shows `Send push message to token …`);
  2. leave it idle / have a contact start typing → **no** ghost notification.
- To watch the filter live, set `RUST_LOG=debug` for the fpush service and
  recreate it; dropped pushes log `Dropping unimportant push from … (ghost
  suppression)`. (Drops are debug-level on purpose — at `info` they'd be noisy.)

## Alternative (not used)

A tiny server-side Prosody module hooking `cloud_notify/push` to block
`not event.important` pushes would cut the junk before it reaches fpush. It was
not used because the fpush fork is fully under the user's control and survives
Snikket updates, whereas a custom Snikket module needs `plugin_paths` wiring and
can be disrupted by upgrades.
