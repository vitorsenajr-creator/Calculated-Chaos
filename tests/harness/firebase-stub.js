// Replaces src/config/firebase.js in the harness dev server only (see
// tests/harness/vite.config.js). Keeps the same window.* surface the app
// uses, backed by an in-memory copy of the sample data. Only what the app
// calls is implemented; anything else fails loudly in the console.
import { sampleDocs } from '/tests/harness/sample-data.js';

const docs = new Map(sampleDocs());

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const joinPath = (...parts) => parts.filter(Boolean).join('/');

function colRef(base, segs){ return { kind: 'col', path: joinPath(base, ...segs) }; }
function docRef(parent, segs){
  const base = parent && parent.kind === 'col' ? parent.path : '';
  const parts = segs.length ? segs : [Math.random().toString(36).slice(2, 12)];
  const path = joinPath(base, ...parts);
  return { kind: 'doc', path, id: path.split('/').pop() };
}

function docSnap(path){
  const data = docs.get(path);
  return {
    id: path.split('/').pop(),
    ref: { kind: 'doc', path, id: path.split('/').pop() },
    exists: () => data !== undefined,
    data: () => clone(data),
    get: (field) => clone(data && data[field]),
  };
}

function snapOf(list){
  return {
    docs: list,
    size: list.length,
    empty: list.length === 0,
    forEach: (fn) => list.forEach(fn),
    docChanges: () => [],
  };
}

function matches(data, field, op, val){
  const v = data ? data[field] : undefined;
  switch (op){
    case '==': return v === val;
    case '!=': return v !== val;
    case '<': return v < val;
    case '<=': return v <= val;
    case '>': return v > val;
    case '>=': return v >= val;
    case 'in': return Array.isArray(val) && val.includes(v);
    default: throw new Error(`harness: where op "${op}" is not implemented`);
  }
}

function listDocs(q){
  const col = q.kind === 'query' ? q.col : q;
  const wheres = q.kind === 'query' ? q.cs.filter(c => c.kind === 'where') : [];
  const out = [];
  for (const path of docs.keys()){
    const parts = path.split('/');
    if (parts.slice(0, -1).join('/') !== col.path) continue;
    const data = docs.get(path);
    if (wheres.every(w => matches(data, w.field, w.op, w.val))) out.push(docSnap(path));
  }
  return out;
}

const where = (field, op, val) => ({ kind: 'where', field, op, val });
const query = (col, ...cs) => ({ kind: 'query', col, cs });
const collection = (db, ...segs) => colRef('', segs);
const doc = (parent, ...segs) => {
  // doc(db, 'a', 'b') or doc(colRef, 'id')
  if (parent && parent.kind === 'col') return docRef(parent, segs);
  return docRef(null, segs);
};

async function getDocs(q){ return snapOf(listDocs(q)); }
async function getDoc(ref){ return docSnap(ref.path); }

async function setDoc(ref, data, opts){
  const prev = docs.get(ref.path);
  docs.set(ref.path, opts && opts.merge ? { ...(prev || {}), ...clone(data) } : clone(data));
}
async function updateDoc(ref, fields){
  if (!docs.has(ref.path)) throw new Error(`No document to update: ${ref.path}`);
  docs.set(ref.path, { ...docs.get(ref.path), ...clone(fields) });
}
async function deleteDoc(ref){ docs.delete(ref.path); }

async function runTransaction(db, fn){
  const tx = {
    get: getDoc,
    set: (ref, data) => setDoc(ref, data),
    update: (ref, fields) => updateDoc(ref, fields),
    delete: (ref) => deleteDoc(ref),
  };
  return fn(tx);
}

function writeBatch(db){
  const ops = [];
  const batch = {
    set(ref, data, opts){ ops.push(() => setDoc(ref, data, opts)); return batch; },
    update(ref, fields){ ops.push(() => updateDoc(ref, fields)); return batch; },
    delete(ref){ ops.push(() => deleteDoc(ref)); return batch; },
    async commit(){ for (const op of ops) await op(); },
  };
  return batch;
}

function onSnapshot(q, next){
  setTimeout(() => next(snapOf(listDocs(q))), 0);
  return () => {};
}

// Signed in as an approved, verified owner of the sample business.
const user = {
  uid: 'harness-owner',
  email: 'owner@example.test',
  emailVerified: true,
  getIdToken: async () => 'harness-token',
  getIdTokenResult: async () => ({ claims: { email_verified: true } }),
  reload: async () => {},
};

window.db = { harness: true };
window.firestoreFns = { collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where, runTransaction, writeBatch, onSnapshot };
window.storage = {};
window.storageFns = { ref: () => ({}), uploadString: async () => ({}), getDownloadURL: async () => '' };
window.auth = { currentUser: user };
window.authFns = {
  onAuthStateChanged: (auth, cb) => { setTimeout(() => cb(user), 0); return () => {}; },
  signInWithEmailAndPassword: async () => ({ user }),
  createUserWithEmailAndPassword: async () => ({ user }),
  signOut: async () => {},
  sendEmailVerification: async () => {},
  GoogleAuthProvider: class {},
  signInWithPopup: async () => ({ user }),
  signInWithRedirect: async () => {},
};
window.firebaseReady = true;
console.info('[harness] Firebase replaced by the sample data (tests/harness/firebase-stub.js)');
