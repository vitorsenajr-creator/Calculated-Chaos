# Employee accounts (added v3.13.2, 2026-08-09)

> **Current state (2026-10-19):** The UI-only restriction described below is still the only one. The
> Firestore rules gap is still open.


An admin (`window.ADMIN_EMAILS` in `config/firebase.js`) can create a
Catalog-only login from Settings → "Employee accounts" — enter an email +
temporary password, `window.createEmployeeAccount()` creates the Firebase
Auth user and writes `role: 'employee'` on their Firestore `users/{uid}`
doc, `status: 'approved'` immediately (no pending-approval step, since the
admin is creating it directly).

**How the restriction works**: `applyRoleRestrictions()` in `main.js` runs
right after login, reads that `role`, and if it's `'employee'`: hides
every sidebar/tab entry except Catalog, hides the header's stats strip and
daily quote (both can show profit/margin numbers), and `switchToTab()`
itself force-redirects to `'catalog'` regardless of what's requested, as a
second layer.

**⚠️ This is a UI-level restriction only.** It stops an employee from
casually navigating to financial data — it does NOT stop someone who opens
the browser devtools and calls `getDocs(collection(db, 'items'))` (or
similar) directly; nothing server-side currently distinguishes an
`'employee'` role from an `'owner'` one. This repo has no `firestore.rules`
file — the real rules live only in the Firebase Console (Firestore
Database → Rules), which this environment has no credentials to reach or
edit. **To actually close this gap**, add a rule there that checks the
signed-in user's own `users/{uid}.role` field and denies employee reads on
anything beyond what Catalog needs (the `items` collection, read-only, is
probably still required for cataloging — the sensitive surfaces are
whatever collections back Finance/Reports, if those differ from `items`).
Flagging this explicitly rather than implying the current state is secure
enough for genuinely sensitive data.

**Technical note**: `createEmployeeAccount()` creates the new user via a
throwaway secondary Firebase App instance (`initializeApp(firebaseConfig,
'secondary-<timestamp>')`), not the primary `window.auth` — calling
`createUserWithEmailAndPassword` on the primary app would sign the admin's
own browser session in as the new employee instead of the admin. The
secondary instance is torn down (`signOut` + `deleteApp`) right after.
