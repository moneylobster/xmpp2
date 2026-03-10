# XMPP Client Project Plan
## Converse.js-based, Mobile-ready, Modern UI

---

## Phase 1: Project Scaffolding & Core Setup ✅
- [x] Initialize TypeScript project with Vite
- [x] Set up tsconfig
- [x] Install Converse.js and dependencies
- [x] Set up basic project structure (src/xmpp, src/components, src/types, src/styles)
- [x] Choose and set up UI framework: Lit
- [x] Configure CSS: Tailwind CSS v3 + PostCSS
- [x] Converse.js integration: using UMD dist build (avoids ESM webpack chunk issues)
- [x] Bridge plugin (xmpp2-bridge) for connection events
- [x] Login view with JID/password form
- [x] App shell with sidebar + main panel layout
- [x] Connection state management via custom EventBus

## Phase 2: Connection & Authentication ✅ (handled by Converse.js)
- [x] .well-known/host-meta discovery (XEP-0156) — built into Converse.js
- [x] WebSocket connection with auto-reconnect — built into Converse.js
- [x] SASL authentication — built into Converse.js
- [x] Stream management (XEP-0198) — converse-smacks plugin
- [x] Connection status UI (connecting, connected, error, reconnecting)

## Phase 3: Core Chat — 1:1 Messaging ✅
- [x] Roster management (contact list with presence, search, unread badges)
- [x] 1:1 chat view with message input and message bubbles
- [x] Real-time message send/receive
- [x] Message carbons (XEP-0280) — handled by Converse.js
- [x] Chat state notifications (typing indicators, XEP-0085)
- [x] Responsive mobile layout (stacked views with back navigation)
- [ ] Delivery receipts (XEP-0184) — deferred to polish phase
- [ ] Read markers — deferred to polish phase

## Phase 4: Message Archive & History (MAM) ✅
- [x] MAM queries (XEP-0313) — handled by Converse.js automatically on chat open
- [x] Infinite scroll / lazy loading of older history (scroll to top triggers fetch)
- [x] Local message cache in IndexedDB — handled by Converse.js (persistent_store)
- [x] Sync strategy — Converse.js fetches from server, merges with local cache
- [x] Date separators between message groups (Today, Yesterday, dates)
- [x] Scroll position preserved when loading older messages
- [ ] Search through message history — deferred to polish phase

## Phase 5: OMEMO Encryption ✅
- [x] Load libsignal (bundled with Converse.js) for OMEMO support
- [x] Configure Converse.js for OMEMO (trusted: true, clear_cache_on_logout: false)
- [x] Per-conversation encryption toggle (lock icon in chat header)
- [x] Encrypted message indicators in chat view (🔒 on messages)
- [ ] Key management UI (fingerprints, trust) — deferred to polish phase
- [ ] Device management — deferred to polish phase

## Phase 6: Group Chats (MUC) ✅
- [x] Room list in sidebar with unread badges
- [x] Join room dialog (room JID + nickname)
- [x] MUC chat view with sender nicknames (color-coded)
- [x] Occupant/member list panel (toggle in header)
- [x] Role/affiliation indicators (owner/admin/moderator icons)
- [x] MUC message history via MAM (automatic via Converse.js)
- [x] Date separators in room messages
- [ ] Room configuration UI — deferred
- [ ] Room discovery and bookmarks — deferred

## Phase 7: File Uploads ✅
- [x] HTTP File Upload (XEP-0363)
- [x] Upload progress indicator
- [x] Image/file preview in chat (thumbnails, file info)
- [x] Drag-and-drop and paste-to-upload
- [x] File size limits and type validation
- [x] Integration with OMEMO (encrypt before upload, aesgcm:// URL decryption & preview)

## Phase 8: Modern UI & UX ✅
- [x] Design system: CSS custom properties for all colors, dark/light/auto mode
- [x] Dark mode via `prefers-color-scheme` + manual `.dark`/`.light` class toggle
- [x] Theme preference persisted in localStorage, toggle button in sidebar
- [x] Skeleton loaders (contact, room, message variants with pulse animation)
- [x] Toast notification system (stackable, auto-dismiss with progress bar)
- [x] Settings screen (theme picker, notification sound toggle, about)
- [x] Enhanced empty states with SVG icons and action prompts
- [x] Message entrance animation (fade + slide up)
- [x] Typing indicator animated dots (bouncing)
- [x] Presence dot pulse animation for online contacts
- [x] Button micro-interactions (scale on active/click)
- [x] Dialog and card entrance animations
- [x] Login error shake animation
- [x] Mobile slide-in transition for chat view
- [x] ARIA labels/roles on all interactive elements
- [x] Keyboard navigation (Tab through contacts/rooms, Enter/Space to select)
- [x] `focus-visible` styling globally
- [x] Tab title unread badge (e.g. "(3) XMPP Chat")
- [x] Notification sound on new unread message (toggleable in settings)

## Phase 9: Capacitor Integration (Mobile) ✅
- [x] Add Capacitor to the project (@capacitor/core, cli, android, ios)
- [x] Configure capacitor.config.ts (SplashScreen, StatusBar, Keyboard)
- [x] Platform detection utilities (isNative, isAndroid, isIOS, isWeb)
- [x] Haptic feedback on send message, contact/room tap (no-op on web)
- [x] Push notification registration + XEP-0357 stanza helper
- [x] App lifecycle: auto-reconnect on resume from background
- [x] Android back button handling (navigate back or minimize)
- [x] Keyboard show/hide body class for layout adjustments
- [x] Status bar theme sync (dark/light)
- [x] Splash screen auto-hide after connection
- [x] GitHub Actions: manual Android APK build workflow
- [x] GitHub Actions: manual iOS simulator build workflow
- [x] android/ and ios/ in .gitignore (generated in CI)
- [ ] App icon and splash screen assets — deferred
- [ ] Test on physical devices — deferred

## Phase 10: Polish & Reliability
- [ ] Comprehensive error handling throughout
- [ ] Offline mode: queue messages, show status
- [ ] Unit tests for core logic (connection, MAM, OMEMO)
- [ ] Integration tests with a test XMPP server
- [ ] Performance profiling (large chat histories, many contacts)
- [ ] Bundle optimization and code splitting

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| XMPP Library | Converse.js + Strophe.js | Mature, well-tested, extensible |
| UI Framework | Lit | Lightweight, web-standard, Converse.js compatible |
| Styling | Tailwind CSS | Rapid prototyping, mobile-first, consistent design |
| Build Tool | Vite | Fast dev, good TS support, clean builds |
| Local Storage | IndexedDB | Large capacity, async, good for message archives |
| Mobile | Capacitor | Web-first with native access when needed |
| State Mgmt | Minimal (event-driven) | Keep simple; Converse.js already manages XMPP state |

## XEPs Required

- XEP-0156: Discovering Alternative XMPP Connection Methods (.well-known)
- XEP-0198: Stream Management (reliable delivery, resume)
- XEP-0280: Message Carbons (multi-device sync)
- XEP-0313: Message Archive Management (history)
- XEP-0384: OMEMO Encryption
- XEP-0045: Multi-User Chat
- XEP-0048/0402: Bookmarks
- XEP-0363: HTTP File Upload
- XEP-0085: Chat State Notifications
- XEP-0184: Message Delivery Receipts
- XEP-0357: Push Notifications (for mobile)

## Out of Scope
- Voice/video calls (Jingle)
- Server administration
- Account registration (use existing accounts)

## Other stuff
  ┌────────────────────────────────┬──────────────────────────────────────┬───────────────────────────────────────────────────────────────────────┐
  │                                │               Android                │                                  iOS                                  │
  ├────────────────────────────────┼──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ Firebase config file           │ google-services.json in android/app/ │ GoogleService-Info.plist in ios/App/App/                              │
  ├────────────────────────────────┼──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ Firebase Console               │ Add Android app (com.xmpp2.app)      │ Upload APNs .p8 key under Cloud Messaging                             │
  ├────────────────────────────────┼──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ Xcode                          │ N/A                                  │ Enable Push Notifications + Background Modes capabilities             │
  ├────────────────────────────────┼──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ Notification Service Extension │ N/A                                  │ Future: native Swift extension for decrypting message content in push │
  └────────────────────────────────┴──────────────────────────────────────┴───────────────────────────────────────────────────────────────────────┘

  The iOS Notification Service Extension (for showing decrypted message content in notifications without opening the app) requires native Swift code in the Xcode project — that's a separate step. For now, iOS
   will show whatever the push app server puts in the FCM notification payload.
