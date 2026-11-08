# Chat UI behavior

## Connection state

`chat-view` and `muc-view` receive the app-shell connection status. While the
connection is not `connected`, the composer is disabled, the send button is
disabled, and the placeholder reads “Reconnecting…”. Draft text remains in the
textarea until the connection returns.

## Drafts and preferences

Drafts, muted, pinned, and archived state are stored per JID in `localStorage`
(`src/utils/preferences.ts`). `chat-list` renders mute/pin/archive indicators and
sorts pinned chats first, then unarchived chats, then archived chats.

## Unread handling

Opening a chat or room clears both `num_unread` and `num_unread_general` (see
`clearUnread` in `src/utils/unread.ts`). The first unread message id is captured
before clearing and rendered as a “New messages” divider. A floating jump button
appears when the user scrolls away from the bottom.

## Message actions

Each message has a `⋯` action sheet with:

- emoji reactions (XEP-0444)
- copy
- reply (XEP-0461)
- edit for own editable messages
- delete for own messages

Reply metadata is recorded by the bridge plugin in `src/xmpp/client.ts`;
reactions are aggregated per sender in `src/utils/reactions.ts`.

## Media and emoji

Image messages open in an in-app lightbox with download/close controls instead
of a new browser tab. The composer has an emoji picker with search.

## PWA

`public/sw.js` caches the app shell for offline launch in production. It is
registered from `src/main.ts` only when `import.meta.env.PROD` is true.
