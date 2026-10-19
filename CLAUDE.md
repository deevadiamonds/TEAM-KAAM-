# Team Kaam — project notes for Claude

Internal task-tracking app for Mayuresh Sisodiya's ~12-person team (spell the surname "Sisodiya"; brand is "Deeva Diamonds", never "Diva").
The owner is the Admin. He talks in Hindi/Hinglish and is not a developer: he describes *what* should change, Claude does
the code, testing and deploy, then tells him in plain Hindi what changed and what (if anything) he must do.
All UI text is Hindi (Devanagari) mixed with common English words (Task, Login, Report, Admin, Update) — keep that voice.

## Where things live

| What | Where |
|---|---|
| Repo | `github.com/deevadiamonds/TEAM-KAAM-` (git remote lowercases it: `deevadiamonds/team-kaam-`), branch `main`, public |
| Live app (web) | https://deevadiamonds.github.io/TEAM-KAAM-/ — GitHub Pages, deployed by `.github/workflows/pages.yml` on push to `web/**` |
| APK | https://github.com/deevadiamonds/TEAM-KAAM-/releases/latest/download/TeamKaam.apk — built by `.github/workflows/apk.yml` on push to `android/**`, release tag `apk-<run_number>` |
| Backend | Firebase project `task-management-5b21b` (**Blaze** plan, ₹100 budget alert): Authentication (Email/Password) + Cloud Firestore (Standard, asia-south1) + Cloud Functions 2nd gen (asia-south1) + FCM |
| Security rules, indexes, functions | **Auto-deployed** by `.github/workflows/firebase.yml` on push to `firestore.rules`, `firestore.indexes.json`, `functions/**`, `firebase.json` — uses secret `FIREBASE_SERVICE_ACCOUNT` (service account `github-deploy@task-management-5b21b.iam.gserviceaccount.com`, role Owner). No manual pasting any more. Errors surface as run annotations. |
| Test notification | `.github/workflows/test-push.yml` — re-run it, dispatch it, or change `tools/push-target.txt` (first line: `owner`, a member's name, or `all`). Its annotations list which people have notifications registered. |

Network from Claude's cloud sessions: GitHub (git + repo-scoped API, Actions runs/jobs/annotations, releases, re-run) works.
Firebase/googleapis, github.io, npm/pypi, maven are usually blocked — so test against the fake backend (below), and read CI
failures via `gh api repos/deevadiamonds/TEAM-KAAM-/check-runs/<job_id>/annotations` (raw logs are not downloadable).
GitHub Pages settings and Actions secrets cannot be changed from the session; the owner must do those in GitHub Settings.

## Files

- `web/index.html` — the whole app: HTML + CSS + two scripts in one file.
  - Firebase compat SDK v10.12.2 from gstatic, between `<!--FIREBASE-SDK-->` markers (the test harness swaps these out).
  - Script 1: `window.TK_CONFIG` (Firebase web config — public, safe to commit) + an adapter that builds `window.TK_BACKEND`
    (`auth.*` and `db.*` methods). **The app only talks to `TK_BACKEND`**, never to `firebase.*` directly.
    `db.update` flattens nested objects into dot-paths (`log.<key>`, `seenBy.<memberId>`) because Firestore `update()` replaces whole maps.
  - Script 2: the app. Global state object `S`, `render()` (rAF-batched) → `doRender()` → per-view renderers
    (`renderHome`, `renderMine`, `renderAll`, `renderAdmin`, `renderReport`, `renderAccount`). One delegated click handler
    switches on `data-act`. `patch(el, html)` re-renders a container while preserving typed text and focus.
  - Writes go through `write()` / `batch()` → `commit()`: resolves after server ack OR after 2.5 s (offline: the change is
    queued in Firestore's local cache and syncs later). Errors → `handleWriteErr` toasts.
- `web/sw.js` — service worker: app shell + gstatic SDK + Google Fonts cached; never touches Firestore traffic. Bump `VERSION` if cached shell files change shape.
- `web/manifest.webmanifest`, `web/icons/*` — PWA install (icons generated with PIL: blue square, white check, red margin line).
- `android/` — thin WebView shell (no AndroidX, AGP 8.5.2, Gradle 8.9 in CI, minSdk 24, targetSdk 34). `MainActivity.java` loads
  `APP_URL` (resValue set from the workflow) and exposes `window.TeamKaamApp`: `isApp()`, `isForeground()`, `notifyUser(title, body)`,
  `copy(text)`, `saveFile(name, text)` (→ Downloads), `retry()`. Links to other hosts (wa.me etc.) open outside. `assets/offline.html` on load failure.
  Because the APK just opens the live site, **web changes reach APK users without a new APK**. Only rebuild for shell changes.
- APK signing: secrets `TK_KEYSTORE_B64` / `TK_KEYSTORE_PASS` are set (stable key since release `apk-2`), so new APKs install over
  old ones. The workflow refuses to publish if those secrets are missing. apk-1 (one-time key) users had to uninstall once.
- APK push: `android/app/google-services.json` (Firebase Android app `com.teamkaam.app`; the file also lists a stray `com.teamkaam.apk`
  entry — harmless), firebase-messaging via BoM 33.5.1, AndroidX on. Manifest meta-data sets channel `tasks` + `ic_stat` icon.
  Bridge `TeamKaamApp.requestPushToken()` → page callback `window.__tkPushToken(token)`.
- `functions/index.js` — notification server (Node 22, firebase-functions v6, 2nd gen, asia-south1): `taskCreated` (→ receivers),
  `taskUpdated` (done → giver; reopened → receivers; reassigned → new receivers; new "note" log → everyone involved except writer).
  Sends via `sendEachForMulticast` to `pushTokens` of those people and deletes dead tokens.
- `tools/fake-backend.js` + `tools/test_flow.py` — in-memory fake of `TK_BACKEND` and a Playwright end-to-end test. Run `python3 tools/test_flow.py` (expects `PASS`).
- `firestore.rules` — see Permissions.

## Data model (Firestore)

| Path | Fields | Who |
|---|---|---|
| `config/admin` | `uid`, `at` | public get; created once (first setup = Admin, "first come"); only admin updates |
| `config/app` | `org`, `ownerName`, `lastNo`, `setupDone` | public get; admin writes |
| `config/counter` | `n` (last task number) | members/admin read+write (`n is int`) |
| `users/{authUid}` | `memberId`, `active`, `at` | own get; admin list/write. Maps a Firebase Auth account → team member |
| `team/{memberId}` | `name`, `role`, `canAssign`, `active`, `order`, `createdAt` | members read; admin writes. Removal = `active:false` |
| `groups/{groupId}` | `name`, `memberIds[]`, `leads[]` (Full control), `active`, `createdAt` | members read; admin writes |
| `logins/{loginId}` | `email`, `uid`, `memberId` | public get (login lookup); admin list/write |
| `private/contacts` | `phones{memberId: '91…'}` | admin only |
| `pushTokens/{fcmToken}` | `who` (memberId or 'owner'), `uid`, `platform` ('web'/'android'), `at` | the signed-in person may write their own; nobody reads (functions use admin SDK) |
| `tasks/{taskId}` | `no`, `title`, `details`, `kind` ('person'/'group'), `memberId`, `groupId`, `viaGroup`, `due` (YYYY-MM-DD), `priority` ('normal'/'urgent'), `status` ('todo'/'doing'/'done'), `createdAt`, `createdDay`, `createdBy` (memberId or 'owner'), `doneAt`, `doneDay`, `doneBy`, `doneNote`, `seenBy{memberId: ms}`, `log{key: {by, type, text, at}}`, `updatedAt`, **`watchers[]`** (creator if a member + person assignee or all group members), **`openFor[]`** (= watchers while not done, `[]` when done) | see rules |

Logins: Admin signs in with his real Gmail (password reset by email works). Members get a short Login ID (`[a-z0-9._@-]{3,60}`);
the real Auth account is a synthetic email `<slug>-<rand>@task-management-5b21b.firebaseapp.com` stored in `logins/{loginId}`.
Admin creates member accounts through a **secondary Firebase app** (persistence NONE) so he stays signed in.
"नया Password" = create a new Auth account, point `logins/{id}` + `users/{newUid}` at the member, set `users/{oldUid}.active=false`
(old password stops working; an open session on the member's phone logs out via its `users/{uid}` listener). Old Auth accounts stay orphaned — harmless.

## Permissions (mirror in UI and in `firestore.rules`)

- **Admin**: everything; only Admin adds/removes members, makes logins, edits groups/settings.
- **Task दे सकता है** (`team.canAssign`): can give tasks to anyone/any group; sees "Task दें" + Report tabs.
- **Full control in a group** (`groups.leads`): can give tasks to that group and its members (person tasks carry `viaGroup`),
  and manage (edit/delete/reopen/mark) that group's tasks.
- **Simple**: may only change progress fields (`status`, `doneAt`, `doneDay`, `doneBy`, `doneNote`, `updatedAt`, `log`, `seenBy`,
  `openFor` → only to `[]`) on tasks assigned to them; cannot reopen a done task.
- **Visibility (owner's rule, Oct 2026):** Admin sees every task. Everyone else sees ONLY tasks they gave or received
  (group task → all members of that group). E.g. Nishant→Darshana is seen by Nishant, Darshana and Admin — not Akash, not Payal.
  Enforced by `canSee()` in rules (`myMid() in watchers || myMid() in openFor`) and by member queries:
  open = `openFor array-contains me`; recent done / older = `watchers array-contains me` + `doneAt` (composite index in
  `firestore.indexes.json`: watchers CONTAINS + doneAt DESC — must exist in Firebase). `vis()` filters lists in the UI
  (also for Admin's "इनकी नज़र से देखें" preview). Keep `watchers`/`openFor` correct on every write: create/edit (`watchersFor()`),
  done (`openFor:[]`), reopen (`openFor:watchers`), group member edit (Admin rewrites that group's tasks).
  Admin's app back-fills old tasks once (`migrateTasks()`, flag `config/app.visV2`).
- Tabs: Admin = आज · सभी Tasks · Admin Panel · Report. Members = मुझे मिले · (Task दें if they can give) · मेरे सारे Tasks. Report is Admin-only.
- A task's creator can always manage it. UI helpers: `perms()`, `targets()`, `canManage()`, `canActOn()`, `viaGroupFor()`.

## Read budget (Spark plan: 50K reads/day, 20K writes/day)

Live listeners: `team`, `groups`, open tasks (`status in [todo, doing]`), tasks done in the last 7 days (`doneAt >= since`),
`config/*`; admin also `logins` and `private/contacts`. Older done tasks load on demand (50 per page) in "सभी Tasks";
past-day reports use one-off queries (`createdDay ==`, `doneDay ==`, `doneDay >`). Avoid adding listeners over the whole `tasks` collection.
Avoid queries needing composite indexes (sort client-side instead).

## Notifications

In-app toast + chime + vibrate when the app is open. When the app is in the background but still alive: APK → `TeamKaamApp.notifyUser`
(native notification); browser → `systemNotify()` via the service worker (`showNotification`) after the user taps "Notification चालू करें"
(banner; "बाद में" stored in localStorage `tk.notif.later`). Events: new task to me, task reopened for me, task I gave (or any, for Admin) marked done.
**Closed-app push (live since 19 Oct 2026):** Cloud Functions → FCM. Web/iPhone: `firebase-messaging-compat` in the page + `sw.js`
(importScripts, same config), token via `TK_CONFIG.vapidKey`; iPhone needs the app added to the Home Screen (iOS 16.4+) — a banner
explains this in Safari. APK: native FCM. `setupPush()` runs after login and after "Notification चालू करें"; `logout()` deletes the
device token. When `S.pushOn`, `alertUser()` skips local background notifications (the server sends them) to avoid doubles.
WhatsApp buttons (`wa.me`) are the fallback ping; phone numbers are admin-only.

## How to make a change (the routine)

1. Attach the repo in a new session if needed (`add_repo deevadiamonds/TEAM-KAAM-`, push access), clone, read this file.
2. Edit `web/index.html` (and `firestore.rules` if permissions/data change; `android/` only for shell changes).
3. Keep UI and rules in sync; keep Hindi copy plain and short; keep phone width (400px) without horizontal scroll; both light/dark tokens.
4. Run `python3 tools/test_flow.py` — extend it (and `tools/fake-backend.js`) for the new behaviour. It must print `PASS`.
5. Commit with the session's attribution lines and push to `main`. Watch the run:
   `gh api repos/deevadiamonds/TEAM-KAAM-/actions/runs --jq '.workflow_runs[0] | "\(.name) \(.status) \(.conclusion)"'`.
6. Tell the owner in Hindi: what changed and that the app updates by itself (close and reopen). Rules/functions deploy themselves —
   check the "Firebase (notifications + rules)" run succeeded. If the APK changed, give the APK link.
7. Update this file when the structure, data model or permissions change.
