# Employee accounts (added v3.13.2, 2026-08-09)

> **Current state (2026-10-19):** The UI-only restriction described below is still the only one. The
> Firestore rules gap is still open.


A platform admin (the `platformAdmin` claim, v3.18.1) can create a
Catalog-only login from Settings → "Employee accounts" — enter an email +
temporary password. Since v3.18.2 the server does it
(`api/platform.js` → `employee_create`, `api/_users.js`): it creates the
Firebase Auth user, writes `role: 'employee'` and `status: 'approved'` on
their `users/{uid}` doc (no pending-approval step, since the admin is
creating it directly), and adds them as an employee member of the admin's
live business.

**How the restriction works**: `applyRoleRestrictions()` in `main.js` runs
right after login, reads that `role`, and if it's `'employee'`: hides
every sidebar/tab entry except Catalog, hides the header's stats strip and
daily quote (both can show profit/margin numbers), and `switchToTab()`
itself force-redirects to `'catalog'` regardless of what's requested, as a
second layer.

**⚠️ This is a UI-level restriction only.** It stops an employee from
casually navigating to financial data — it does NOT stop someone who opens
the browser devtools and calls `getDocs(collection(db, 'items'))` (or
similar) directly; the Firestore rules don't distinguish an `'employee'`
role from an `'owner'` one. The rules are versioned in `firestore.rules`
and pasted into the Firebase Console. **To actually close this gap**, add
a rule that checks the
signed-in user's own `users/{uid}.role` field and denies employee reads on
anything beyond what Catalog needs (the `items` collection, read-only, is
probably still required for cataloging — the sensitive surfaces are
whatever collections back Finance/Reports, if those differ from `items`).
Flagging this explicitly rather than implying the current state is secure
enough for genuinely sensitive data.

**History**: before v3.18.2 the browser created the login itself, on a
throwaway secondary Firebase App instance (so the admin's own session
wasn't replaced by the new employee's), and then wrote the `users/{uid}`
doc as the admin. The rules only let a user create their own doc, so that
write was denied and the employee showed up as a pending request instead.
Creating the login on the server avoids both problems.
