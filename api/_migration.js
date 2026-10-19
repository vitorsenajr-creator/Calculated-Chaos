// Copy migration of the current single-business data into
// businesses/{bizId}/… (docs/multi-tenant.md step 6, v3.16.5). Not a route:
// api/platform.js calls it for the Developer Panel's "Business migration"
// card.
//
// Copy, never move: the root collections stay untouched and the app keeps
// using them until the switch (step 3c), so running this changes nothing
// the app sees. Re-running is safe: the business id is fixed in
// platform/migration and every doc keeps its id, so a second run rewrites
// the same docs instead of duplicating them, and the last page of each
// collection deletes business docs whose root doc is gone (deleted since
// an earlier run). Once the switch happens (switchedAt is set), copying is
// refused so old root data can never overwrite newer business data; only
// the 'setup' step (members and activeBizId for newly approved users)
// still runs.
//
// The switch (v3.17.0) is one field: businesses/{bizId}.live. The app,
// the server (requireApprovedUser → bizId) and firestore.rules (root
// writes blocked for a live business's members) all follow it, so
// switching back is the same field set to false.
//
// The copy runs in steps and pages (PAGE_SIZE docs per request) because
// the Hobby plan cuts long functions; the panel loops until done.

const MARKER = ['platform', 'migration'];
const PAGE_SIZE = 100;
const BUSINESS_NAME = 'Calculated Chaos';

// Whole collections copied with the same doc ids.
const COLLECTIONS = ['items', 'drafts', 'liveSessions', 'liveItems', 'ebay_error_log'];

// Root docs whose business home has a new name (src/modules/biz.js keeps
// the same mapping on the client).
const DOCS = [
  { from: ['live_catalog_options', 'main'], to: ['options', 'main'] },
  { from: ['live_catalog_options', 'skuCounter'], to: ['counters', 'liveSku'] },
  { from: ['app_settings', 'productCodeCounter'], to: ['counters', 'productCode'] },
  { from: ['app_config', 'settings'], to: ['config', 'settings'] },
];
// Collections the DOCS come from: any other doc in them isn't copied, and
// the status lists it so nothing is lost silently.
const DOC_SOURCES = ['live_catalog_options', 'app_settings', 'app_config'];

// The steps of a copy run, in order. 'setup' creates the business,
// members and activeBizId; 'docs' copies DOCS and the eBay connection.
const STEPS = ['setup', ...COLLECTIONS, 'docs'];

async function readMarker(db){
  const snap = await db.collection(MARKER[0]).doc(MARKER[1]).get();
  return snap.exists ? snap.data() : null;
}

async function count(ref){
  const snap = await ref.count().get();
  return snap.data().count;
}

// Counts on both sides, plus anything that wouldn't be copied. Read-only.
export async function migrationStatus(db){
  const marker = await readMarker(db);
  const bizId = marker && marker.bizId;
  const biz = bizId ? db.collection('businesses').doc(bizId) : null;

  const collections = [];
  for (const name of COLLECTIONS){
    collections.push({
      name,
      source: await count(db.collection(name)),
      target: biz ? await count(biz.collection(name)) : 0,
    });
  }

  const docs = [];
  for (const d of DOCS){
    const src = await db.collection(d.from[0]).doc(d.from[1]).get();
    const dst = biz ? await biz.collection(d.to[0]).doc(d.to[1]).get() : null;
    docs.push({ from: d.from.join('/'), to: d.to.join('/'), source: src.exists, target: !!(dst && dst.exists) });
  }
  const conn = await db.collection('ebay_connections').doc('main').get();
  const connCopy = bizId ? await db.collection('ebay_connections').doc(bizId).get() : null;
  docs.push({ from: 'ebay_connections/main', to: `ebay_connections/${bizId || '{bizId}'}`, source: conn.exists, target: !!(connCopy && connCopy.exists) });

  const mapped = new Set(DOCS.map(d => d.from.join('/')));
  const unmapped = [];
  for (const name of DOC_SOURCES){
    const snap = await db.collection(name).get();
    snap.docs.forEach(d => { if (!mapped.has(`${name}/${d.id}`)) unmapped.push(`${name}/${d.id}`); });
  }

  const usersSnap = await db.collection('users').get();
  const approved = usersSnap.docs.filter(d => d.data().status === 'approved');
  const members = biz ? await count(biz.collection('members')) : 0;

  return {
    ok: true,
    bizId: bizId || null,
    businessExists: biz ? (await biz.get()).exists : false,
    switchedAt: (marker && marker.switchedAt) || null,
    live: biz ? ((await biz.get()).data() || {}).live === true : false,
    lastCopiedAt: (marker && marker.lastCopiedAt) || null,
    collections,
    docs,
    unmapped,
    members: { source: approved.length, target: members },
    steps: STEPS,
  };
}

// The business id: fixed on first use, so every run targets the same one.
async function ensureBizId(db){
  const ref = db.collection(MARKER[0]).doc(MARKER[1]);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().bizId) return snap.data().bizId;
    const bizId = db.collection('businesses').doc().id;
    tx.set(ref, { bizId, createdAt: Date.now() }, { merge: true });
    return bizId;
  });
}

async function runSetup(db, bizId, auth){
  const biz = db.collection('businesses').doc(bizId);
  const existing = await biz.get();
  const batch = db.batch();
  if (!existing.exists){
    batch.set(biz, {
      name: BUSINESS_NAME,
      ownerUid: auth.uid,
      createdAt: Date.now(),
      migratedFrom: 'root',
    });
  }
  const usersSnap = await db.collection('users').get();
  let members = 0;
  for (const u of usersSnap.docs){
    const data = u.data();
    if (data.status !== 'approved') continue;
    // Employee logins stay employees; every other approved account owned
    // the shared catalog, so it's an owner of this business.
    batch.set(biz.collection('members').doc(u.id), {
      role: data.role === 'employee' ? 'employee' : 'owner',
      email: data.email || null,
      addedAt: Date.now(),
    }, { merge: true });
    batch.set(u.ref, { activeBizId: bizId }, { merge: true });
    members++;
  }
  await batch.commit();
  return { copied: members };
}

async function copyCollectionPage(db, bizId, name, cursor){
  let q = db.collection(name).orderBy('__name__').limit(PAGE_SIZE);
  if (cursor) q = q.startAfter(cursor);
  const snap = await q.get();
  if (snap.empty) return { copied: 0, nextCursor: null };
  const target = db.collection('businesses').doc(bizId).collection(name);
  const batch = db.batch();
  snap.docs.forEach(d => batch.set(target.doc(d.id), d.data()));
  await batch.commit();
  const last = snap.docs[snap.docs.length - 1].id;
  return { copied: snap.size, nextCursor: snap.size < PAGE_SIZE ? null : last };
}

// Deletes business docs whose root doc no longer exists, so something
// deleted after an earlier copy doesn't come back at the switch.
async function pruneCollection(db, bizId, name){
  const target = db.collection('businesses').doc(bizId).collection(name);
  const [src, dst] = await Promise.all([db.collection(name).select().get(), target.select().get()]);
  const keep = new Set(src.docs.map(d => d.id));
  const stale = dst.docs.filter(d => !keep.has(d.id));
  for (let i = 0; i < stale.length; i += 400){
    const batch = db.batch();
    stale.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return stale.length;
}

async function copyDocs(db, bizId){
  const biz = db.collection('businesses').doc(bizId);
  const batch = db.batch();
  let copied = 0;
  for (const d of DOCS){
    const src = await db.collection(d.from[0]).doc(d.from[1]).get();
    if (!src.exists) continue;
    batch.set(biz.collection(d.to[0]).doc(d.to[1]), src.data());
    copied++;
  }
  // The eBay connection keeps its server-only home, under the business id.
  const conn = await db.collection('ebay_connections').doc('main').get();
  if (conn.exists){
    batch.set(db.collection('ebay_connections').doc(bizId), conn.data());
    copied++;
  }
  await batch.commit();
  return { copied };
}

// One unit of work: { step, cursor } in, the next { step, cursor } out
// (step null = finished). The panel starts at step 0 and loops.
export async function migrationCopy(db, auth, body){
  const marker = await readMarker(db);
  const step = Number(body.step) || 0;
  const name = STEPS[step];
  if (!name) return { ok: false, status: 400, error: 'Unknown migration step.' };
  const switched = !!(marker && marker.switchedAt);
  if (switched && name !== 'setup'){
    return { ok: false, status: 409, error: 'The app already uses the business data, so copying the old data again is blocked.' };
  }
  const bizId = await ensureBizId(db);

  let result;
  let nextStep = step + 1;
  let nextCursor = null;
  if (name === 'setup'){
    result = await runSetup(db, bizId, auth);
  }else if (name === 'docs'){
    result = await copyDocs(db, bizId);
  }else{
    const cursor = typeof body.cursor === 'string' && body.cursor ? body.cursor : null;
    result = await copyCollectionPage(db, bizId, name, cursor);
    if (result.nextCursor){
      nextStep = step;
      nextCursor = result.nextCursor;
    }else{
      result.removed = await pruneCollection(db, bizId, name);
    }
  }

  // After the switch only the members step runs, and it isn't a copy.
  const finished = nextStep >= STEPS.length || switched;
  if (finished && !switched){
    await db.collection(MARKER[0]).doc(MARKER[1]).set({ lastCopiedAt: Date.now(), lastCopiedBy: auth.email || auth.uid }, { merge: true });
  }
  return {
    ok: true,
    bizId,
    step: name,
    copied: result.copied,
    removed: result.removed || 0,
    next: finished ? null : { step: nextStep, cursor: nextCursor },
  };
}

// Turns the business data on (live: true) or back off. Switching on needs
// a finished copy; the panel runs a fresh copy right before calling this.
export async function migrationSwitch(db, auth, body){
  const marker = await readMarker(db);
  if (!marker || !marker.bizId || !marker.lastCopiedAt){
    return { ok: false, status: 409, error: 'Copy the data to the business first.' };
  }
  const live = body.live === true;
  const biz = db.collection('businesses').doc(marker.bizId);
  if (!(await biz.get()).exists){
    return { ok: false, status: 409, error: 'The business doc is missing. Copy the data again.' };
  }
  const who = auth.email || auth.uid;
  await biz.set({ live, liveChangedAt: Date.now(), liveChangedBy: who }, { merge: true });
  await db.collection(MARKER[0]).doc(MARKER[1]).set(live
    ? { switchedAt: Date.now(), switchedBy: who }
    : { switchedAt: null, switchedBackAt: Date.now(), switchedBackBy: who }, { merge: true });
  return { ok: true, bizId: marker.bizId, live };
}
