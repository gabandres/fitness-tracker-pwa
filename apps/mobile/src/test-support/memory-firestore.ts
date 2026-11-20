/**
 * An in-memory Firestore for tests: the second adapter behind the SDK calls
 * `lib/ledger.ts` makes, so a test runs the REAL ledger and reads back what
 * the code under test wrote.
 *
 *   jest.mock('firebase/firestore', () => require('@/test-support/memory-firestore').firestoreModule);
 *   jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
 *   import { memory } from '@/test-support/memory-firestore';
 *   beforeEach(() => memory.reset());
 *
 * Before 2026-11-20 each test invented its own ledger (73 files, 104 distinct
 * functions stubbed) or its own SDK (29 files). A stub answers what the test
 * told it to; nothing written was ever read back, which is how a session the
 * server had completed could stay "active" on screen with every test green.
 *
 * What it models: documents by path, `set` (with `merge`), `update` (dotted
 * paths, `not-found` on a missing doc), `delete`, batches, queries over one
 * collection (`where`, `orderBy`, `limit`, `documentId()`), one-shot reads,
 * listeners with `docChanges()`, and the `serverTimestamp` / `deleteField` /
 * `increment` sentinels. What it does NOT model: security rules (those have
 * their own emulator suite, `npm run test:rules`), indexes, offline queues,
 * transactions, collection groups. A test that needs one of those is not a
 * test for this adapter.
 *
 * Not imported by app code: nothing here reaches a bundle.
 */

type Data = Record<string, unknown>;

class MemoryTimestamp {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number,
  ) {}
  static now(): MemoryTimestamp {
    return MemoryTimestamp.fromMillis(memory.now());
  }
  static fromDate(d: Date): MemoryTimestamp {
    return MemoryTimestamp.fromMillis(d.getTime());
  }
  static fromMillis(ms: number): MemoryTimestamp {
    const seconds = Math.floor(ms / 1000);
    return new MemoryTimestamp(seconds, Math.round((ms - seconds * 1000) * 1e6));
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.round(this.nanoseconds / 1e6);
  }
  toDate(): Date {
    return new Date(this.toMillis());
  }
  isEqual(other: MemoryTimestamp): boolean {
    return other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }
}

interface DocRef {
  type: 'document';
  path: string;
  id: string;
}
interface CollectionRef {
  type: 'collection';
  path: string;
  id: string;
}
type Constraint =
  | { kind: 'where'; field: string; op: string; value: unknown }
  | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { kind: 'limit'; n: number };
interface QueryRef {
  type: 'query';
  path: string;
  constraints: Constraint[];
}
type Target = DocRef | CollectionRef | QueryRef;

interface Sentinel {
  __op: 'serverTimestamp' | 'delete' | 'increment';
  n?: number;
}
const isSentinel = (v: unknown): v is Sentinel => typeof v === 'object' && v !== null && '__op' in v;
const isPlain = (v: unknown): v is Data =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof MemoryTimestamp) && !(v instanceof Date) && !isSentinel(v);

function clone<T>(v: T): T {
  if (v instanceof MemoryTimestamp) return new MemoryTimestamp(v.seconds, v.nanoseconds) as T;
  if (v instanceof Date) return new Date(v.getTime()) as T;
  if (Array.isArray(v)) return v.map(clone) as T;
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  return v;
}

/** A stable text form, to tell "this document changed" from "it did not". */
function fingerprint(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (x instanceof MemoryTimestamp) return { __ts: x.toMillis() };
    if (isPlain(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]));
    return x;
  });
}

interface Listener {
  target: Target;
  next: (snap: unknown) => void;
  last: Map<string, string> | null;
  lastFromCache: boolean | null;
  includeMetadataChanges: boolean;
}

interface WriteRecord {
  op: 'set' | 'update' | 'delete';
  path: string;
}

class Memory {
  private docs = new Map<string, Data>();
  private listeners = new Set<Listener>();
  private counter = 0;
  private scheduled = false;
  /** Every write that landed, in order. */
  writes: WriteRecord[] = [];
  /** What `snapshot.metadata.fromCache` reports (an unreachable server). */
  fromCache = false;
  /** Return an Error to refuse a write (e.g. a `{ code: 'unavailable' }`). */
  failWrite: ((write: WriteRecord) => Error | null) | null = null;
  /** The clock `serverTimestamp()` and `Timestamp.now()` read. */
  now: () => number = () => Date.now();

  reset(): void {
    this.docs.clear();
    this.listeners.clear();
    this.counter = 0;
    this.writes = [];
    this.fromCache = false;
    this.failWrite = null;
    this.now = () => Date.now();
  }

  /** Put a document in place without it counting as a write. */
  seed(path: string, data: Data): void {
    this.docs.set(path, clone(data));
    this.schedule();
  }

  read(path: string): Data | undefined {
    const d = this.docs.get(path);
    return d ? clone(d) : undefined;
  }

  /** Paths of the documents directly inside a collection, sorted. */
  ids(collectionPath: string): string[] {
    return this.children(collectionPath).map(([p]) => p.slice(collectionPath.length + 1));
  }

  nextId(): string {
    this.counter += 1;
    return `mem${String(this.counter).padStart(17, '0')}`;
  }

  // ── writes ──
  private refuse(write: WriteRecord): void {
    const err = this.failWrite?.(write);
    if (err) throw err;
  }

  private resolve(value: unknown, existing: unknown, merge: boolean): unknown {
    if (isSentinel(value)) {
      if (value.__op === 'serverTimestamp') return MemoryTimestamp.fromMillis(this.now());
      if (value.__op === 'increment') return (typeof existing === 'number' ? existing : 0) + (value.n ?? 0);
      return undefined; // delete
    }
    if (isPlain(value)) {
      const base: Data = merge && isPlain(existing) ? clone(existing) : {};
      for (const [k, v] of Object.entries(value)) {
        if (isSentinel(v) && v.__op === 'delete') {
          delete base[k];
          continue;
        }
        const next = this.resolve(v, base[k], merge);
        if (next !== undefined) base[k] = next;
      }
      return base;
    }
    return clone(value);
  }

  applySet(ref: DocRef, data: Data, merge: boolean): void {
    this.refuse({ op: 'set', path: ref.path });
    this.docs.set(ref.path, this.resolve(data, merge ? this.docs.get(ref.path) : undefined, merge) as Data);
    this.writes.push({ op: 'set', path: ref.path });
  }

  applyUpdate(ref: DocRef, patch: Data): void {
    this.refuse({ op: 'update', path: ref.path });
    const current = this.docs.get(ref.path);
    if (!current) throw Object.assign(new Error(`No document to update: ${ref.path}`), { code: 'not-found' });
    const next = clone(current);
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      let node: Data = next;
      for (const part of parts.slice(0, -1)) {
        if (!isPlain(node[part])) node[part] = {};
        node = node[part] as Data;
      }
      const leaf = parts[parts.length - 1];
      if (isSentinel(value) && value.__op === 'delete') {
        delete node[leaf];
        continue;
      }
      // An update REPLACES the value at its path; only sentinels look at what was there.
      const resolved = this.resolve(value, node[leaf], false);
      if (resolved !== undefined) node[leaf] = resolved;
    }
    this.docs.set(ref.path, next);
    this.writes.push({ op: 'update', path: ref.path });
  }

  applyDelete(ref: DocRef): void {
    this.refuse({ op: 'delete', path: ref.path });
    this.docs.delete(ref.path);
    this.writes.push({ op: 'delete', path: ref.path });
  }

  has(path: string): boolean {
    return this.docs.has(path);
  }

  // ── reads ──
  private children(collectionPath: string): [string, Data][] {
    const prefix = `${collectionPath}/`;
    return [...this.docs.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  private field(path: string, data: Data, field: string): unknown {
    if (field === '__name__') return path.slice(path.lastIndexOf('/') + 1);
    let node: unknown = data;
    for (const part of field.split('.')) {
      if (!isPlain(node)) return undefined;
      node = node[part];
    }
    return node;
  }

  private rows(target: CollectionRef | QueryRef): [string, Data][] {
    let rows = this.children(target.path);
    const constraints = target.type === 'query' ? target.constraints : [];
    for (const c of constraints) {
      if (c.kind !== 'where') continue;
      rows = rows.filter(([p, d]) => matches(this.field(p, d, c.field), c.op, c.value));
    }
    const orders = constraints.filter((c): c is Extract<Constraint, { kind: 'orderBy' }> => c.kind === 'orderBy');
    for (const o of orders) rows = rows.filter(([p, d]) => this.field(p, d, o.field) !== undefined);
    if (orders.length) {
      rows = [...rows].sort(([pa, da], [pb, db]) => {
        for (const o of orders) {
          const diff = compare(this.field(pa, da, o.field), this.field(pb, db, o.field));
          if (diff !== 0) return o.dir === 'desc' ? -diff : diff;
        }
        const tie = pa < pb ? -1 : pa > pb ? 1 : 0;
        return orders[orders.length - 1].dir === 'desc' ? -tie : tie;
      });
    }
    const cap = constraints.find((c): c is Extract<Constraint, { kind: 'limit' }> => c.kind === 'limit');
    return cap ? rows.slice(0, cap.n) : rows;
  }

  private metadata() {
    return { fromCache: this.fromCache, hasPendingWrites: false };
  }

  docSnapshot(ref: DocRef) {
    const stored = this.docs.get(ref.path);
    const data = stored ? clone(stored) : undefined;
    return {
      id: ref.id,
      ref,
      metadata: this.metadata(),
      exists: () => data !== undefined,
      data: () => (data ? clone(data) : undefined),
      get: (field: string) => (data ? clone(this.field(ref.path, data, field)) : undefined),
    };
  }

  querySnapshot(target: CollectionRef | QueryRef, previous: Map<string, string> | null) {
    const rows = this.rows(target);
    const docs = rows.map(([path]) => this.docSnapshot({ type: 'document', path, id: path.slice(path.lastIndexOf('/') + 1) }));
    const current = new Map(rows.map(([path, data]) => [path, fingerprint(data)]));
    const changes: { type: 'added' | 'modified' | 'removed'; doc: unknown }[] = [];
    docs.forEach((d) => {
      const before = previous?.get(d.ref.path);
      if (before === undefined) changes.push({ type: 'added', doc: d });
      else if (before !== current.get(d.ref.path)) changes.push({ type: 'modified', doc: d });
    });
    for (const path of previous?.keys() ?? []) {
      if (!current.has(path)) {
        changes.push({ type: 'removed', doc: { id: path.slice(path.lastIndexOf('/') + 1), ref: { type: 'document', path } } });
      }
    }
    return {
      snapshot: {
        docs,
        size: docs.length,
        empty: docs.length === 0,
        metadata: this.metadata(),
        forEach: (fn: (d: unknown) => void) => docs.forEach(fn),
        docChanges: () => changes,
      },
      current,
    };
  }

  // ── listeners ──
  listen(listener: Listener): () => void {
    this.listeners.add(listener);
    this.schedule();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Deliver to every listener whose view changed, after the current task. */
  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    void Promise.resolve().then(() => {
      this.scheduled = false;
      this.deliver();
    });
  }

  /** Tell listeners about a provenance change (a server answer after a cache hit). */
  setFromCache(value: boolean): void {
    this.fromCache = value;
    this.schedule();
  }

  private deliver(): void {
    for (const l of [...this.listeners]) {
      if (!this.listeners.has(l)) continue;
      const metaChanged = l.lastFromCache !== this.fromCache;
      if (l.target.type === 'document') {
        const snap = this.docSnapshot(l.target);
        const now = new Map([[l.target.path, snap.exists() ? fingerprint(snap.data()) : '∅']]);
        const changed = l.last === null || l.last.get(l.target.path) !== now.get(l.target.path);
        if (!changed && !(metaChanged && l.includeMetadataChanges)) continue;
        l.last = now;
        l.lastFromCache = this.fromCache;
        l.next(snap);
      } else {
        const { snapshot, current } = this.querySnapshot(l.target, l.last);
        const changed = l.last === null || snapshot.docChanges().length > 0;
        if (!changed && !(metaChanged && l.includeMetadataChanges)) continue;
        l.last = current;
        l.lastFromCache = this.fromCache;
        l.next(snapshot);
      }
    }
  }
}

function rank(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 2;
  if (v instanceof MemoryTimestamp || v instanceof Date) return 3;
  if (typeof v === 'string') return 4;
  return 5;
}

function compare(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  const x = a instanceof MemoryTimestamp ? a.toMillis() : a instanceof Date ? a.getTime() : a;
  const y = b instanceof MemoryTimestamp ? b.toMillis() : b instanceof Date ? b.getTime() : b;
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  if (typeof x === 'string' && typeof y === 'string') return x < y ? -1 : x > y ? 1 : 0;
  if (typeof x === 'boolean' && typeof y === 'boolean') return Number(x) - Number(y);
  return 0;
}

function matches(actual: unknown, op: string, wanted: unknown): boolean {
  if (op === 'in') return Array.isArray(wanted) && wanted.some((w) => actual !== undefined && compare(actual, w) === 0 && rank(actual) === rank(w));
  if (op === 'array-contains') return Array.isArray(actual) && actual.some((a) => compare(a, wanted) === 0 && rank(a) === rank(wanted));
  if (actual === undefined) return false;
  if (op === '!=') return rank(actual) !== rank(wanted) || compare(actual, wanted) !== 0;
  if (rank(actual) !== rank(wanted)) return false;
  const diff = compare(actual, wanted);
  if (op === '==') return diff === 0;
  if (op === '<') return diff < 0;
  if (op === '<=') return diff <= 0;
  if (op === '>') return diff > 0;
  if (op === '>=') return diff >= 0;
  throw new Error(`memory-firestore: unsupported where operator "${op}"`);
}

/** The one store a test file sees: jest gives every test file its own module registry. */
export const memory = new Memory();

const fieldName = (f: unknown): string => (typeof f === 'string' ? f : '__name__');
const isRef = (v: unknown): v is Target => typeof v === 'object' && v !== null && 'type' in v && 'path' in v;
const idOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function doc(parent: unknown, ...segments: string[]): DocRef {
  const base = isRef(parent) ? parent.path : '';
  const parts = [base, ...segments].filter((s) => s !== '');
  // `doc(collectionRef)` with no id mints one, as the SDK does.
  if (isRef(parent) && parent.type === 'collection' && segments.length === 0) parts.push(memory.nextId());
  const path = parts.join('/');
  return { type: 'document', path, id: idOf(path) };
}

function collection(parent: unknown, ...segments: string[]): CollectionRef {
  const base = isRef(parent) ? parent.path : '';
  const path = [base, ...segments].filter((s) => s !== '').join('/');
  return { type: 'collection', path, id: idOf(path) };
}

function query(source: CollectionRef | QueryRef, ...constraints: Constraint[]): QueryRef {
  const inherited = source.type === 'query' ? source.constraints : [];
  return { type: 'query', path: source.path, constraints: [...inherited, ...constraints] };
}

type SnapshotArgs = [Target, ...unknown[]];

function onSnapshot(...args: SnapshotArgs): () => void {
  const [target, ...rest] = args;
  const options = typeof rest[0] === 'object' && rest[0] !== null && typeof rest[0] !== 'function' ? (rest.shift() as { includeMetadataChanges?: boolean }) : {};
  const next = rest[0] as (snap: unknown) => void;
  return memory.listen({
    target,
    next,
    last: null,
    lastFromCache: null,
    includeMetadataChanges: options.includeMetadataChanges === true,
  });
}

function writeBatch() {
  const ops: (() => void)[] = [];
  const checks: (() => void)[] = [];
  const batch = {
    set: (ref: DocRef, data: Data, options?: { merge?: boolean }) => {
      ops.push(() => memory.applySet(ref, data, options?.merge === true));
      return batch;
    },
    update: (ref: DocRef, data: Data) => {
      checks.push(() => {
        if (!memory.has(ref.path)) throw Object.assign(new Error(`No document to update: ${ref.path}`), { code: 'not-found' });
      });
      ops.push(() => memory.applyUpdate(ref, data));
      return batch;
    },
    delete: (ref: DocRef) => {
      ops.push(() => memory.applyDelete(ref));
      return batch;
    },
    commit: async () => {
      // All or nothing: a missing update target refuses the whole batch.
      checks.forEach((check) => check());
      ops.forEach((op) => op());
      memory.schedule();
    },
  };
  return batch;
}

/** Everything `firebase/firestore` exports that the app's own code calls. */
export const firestoreModule = {
  Timestamp: MemoryTimestamp,
  doc,
  collection,
  query,
  where: (field: unknown, op: string, value: unknown): Constraint => ({ kind: 'where', field: fieldName(field), op, value }),
  orderBy: (field: unknown, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ kind: 'orderBy', field: fieldName(field), dir }),
  limit: (n: number): Constraint => ({ kind: 'limit', n }),
  documentId: () => ({ __fieldPath: '__name__' }),
  serverTimestamp: (): Sentinel => ({ __op: 'serverTimestamp' }),
  deleteField: (): Sentinel => ({ __op: 'delete' }),
  increment: (n: number): Sentinel => ({ __op: 'increment', n }),
  getDoc: async (ref: DocRef) => memory.docSnapshot(ref),
  getDocs: async (target: CollectionRef | QueryRef) => memory.querySnapshot(target, null).snapshot,
  getCountFromServer: async (target: CollectionRef | QueryRef) => {
    const count = memory.querySnapshot(target, null).snapshot.size;
    return { data: () => ({ count }) };
  },
  setDoc: async (ref: DocRef, data: Data, options?: { merge?: boolean }) => {
    memory.applySet(ref, data, options?.merge === true);
    memory.schedule();
  },
  updateDoc: async (ref: DocRef, data: Data) => {
    memory.applyUpdate(ref, data);
    memory.schedule();
  },
  deleteDoc: async (ref: DocRef) => {
    memory.applyDelete(ref);
    memory.schedule();
  },
  addDoc: async (col: CollectionRef, data: Data) => {
    const ref = doc(col);
    memory.applySet(ref, data, false);
    memory.schedule();
    return ref;
  },
  writeBatch,
  onSnapshot,
};
