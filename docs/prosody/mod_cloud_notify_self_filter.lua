-- Drop XEP-0357 cloud-notify pushes for 1:1 messages the user sent themselves.
--
-- Why: mod_cloud_notify pushes when a message is archived while the device has
-- no active session. If the app sends a message and is then backgrounded or
-- killed, the archived copy is pushed back to the same device, which shows a
-- notification for the user's own message. Prosody 13's `cloud_notify/push`
-- event exposes the original stanza and the recipient username, so we can drop
-- those pushes before they reach the push gateway.
--
-- Install:
--   cp mod_cloud_notify_self_filter.lua /etc/prosody/modules/
--   modules_enabled = { ..., "cloud_notify_self_filter" }
--   prosodyctl restart
--
-- Works with Prosody 13+ / recent prosody-modules (`cloud_notify/push`) and
-- older mod_cloud_notify versions (`archive-message-added`).

local ok, jid = pcall(require, "prosody.util.jid");
if not ok then
    jid = require "util.jid";
end

local function is_self_sent(stanza, username)
    if not stanza or not username then
        return false;
    end
    local from = stanza.attr and stanza.attr.from;
    return from ~= nil and jid.bare(from) == jid.join(username, module.host);
end

-- Prosody 13+ / recent prosody-modules fire this before the push is sent.
module:hook("cloud_notify/push", function(event)
    if is_self_sent(event.original_stanza, event.username) then
        event.reason = "self-sent message";
        return true; -- block the push
    end
end, 100);

-- Fallback for older mod_cloud_notify versions that do not fire
-- `cloud_notify/push`: stop the archive event before the push module sees it.
module:hook("archive-message-added", function(event)
    if is_self_sent(event.stanza, event.for_user) then
        return true; -- block propagation to mod_cloud_notify
    end
end, 100);
