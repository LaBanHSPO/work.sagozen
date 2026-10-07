import { createHash } from 'node:crypto';

import * as Y from 'yjs';

import {
  assertNoWorkspaceMetadataDeletion,
  snapshotWorkspaceDeletionState,
} from './workspace-deletion-validation';

const POLICY_KEY = 'prop:memberEditUntil';
const DATABASE_FLAVOUR = 'affine:database';

export class DatabaseEditDenied extends Error {
  constructor() {
    super('Database editing is not permitted');
  }
}

export type DatabaseValidation = {
  stateHash: string;
  expiresAt?: number;
  historyHash?: string;
};

export function databaseStateHash(
  snapshot: Uint8Array | null,
  updates: readonly Uint8Array[]
) {
  const hash = createHash('sha256');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(snapshot?.byteLength ?? 0));
  hash.update(length);
  if (snapshot) hash.update(snapshot);
  for (const update of updates) {
    length.writeBigUInt64BE(BigInt(update.byteLength));
    hash.update(length);
    hash.update(update);
  }
  return hash.digest('hex');
}

function deny(): never {
  throw new DatabaseEditDenied();
}

function assertResolved(doc: Y.Doc) {
  if (doc.store.pendingStructs || doc.store.pendingDs) deny();
}

function load(snapshot: Uint8Array | null, updates: readonly Uint8Array[]) {
  // Retain deleted Item ancestry; existing GC structs still fail closed when
  // an incoming operation needs their attribution.
  const doc = new Y.Doc({ gc: false });
  doc.getMap('blocks');
  try {
    if (snapshot?.length) Y.applyUpdate(doc, snapshot);
    for (const update of updates) Y.applyUpdate(doc, update);
    assertResolved(doc);
    return doc;
  } catch (error) {
    doc.destroy();
    if (error instanceof DatabaseEditDenied) throw error;
    return deny();
  }
}

type Block = { flavour: unknown; children: string[]; until: unknown };
type Graph = Map<string, Block>;

function graph(doc: Y.Doc): Graph {
  const result: Graph = new Map();
  for (const [id, value] of doc.getMap('blocks')) {
    if (!(value instanceof Y.Map)) deny();
    const children = value.get('sys:children');
    const list = children instanceof Y.Array ? children.toArray() : children;
    if (
      list !== undefined &&
      (!Array.isArray(list) || list.some(id => typeof id !== 'string'))
    )
      deny();
    result.set(id, {
      flavour: value.get('sys:flavour'),
      children: list ?? [],
      until: value.get(POLICY_KEY),
    });
  }
  return result;
}

function databases(state: Graph) {
  return [...state]
    .filter(([, block]) => block.flavour === DATABASE_FLAVOUR)
    .map(([id]) => id);
}

function descendants(state: Graph, id: string) {
  const found = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) deny();
    if (found.has(id)) return;
    const block = state.get(id);
    if (!block) deny();
    found.add(id);
    visiting.add(id);
    for (const child of block.children) visit(child);
    visiting.delete(id);
  };
  visit(id);
  return found;
}

function ancestors(state: Graph, id: string) {
  const found = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) deny();
    visiting.add(id);
    for (const [parent, block] of state) {
      if (!block.children.includes(id)) continue;
      if (!found.has(parent)) {
        found.add(parent);
        visit(parent);
      } else if (visiting.has(parent)) deny();
    }
    visiting.delete(id);
  };
  visit(id);
  return found;
}

type Touch = {
  blockId: string;
  key: string | null;
  rootEntry: boolean;
  childIds?: string[];
};

function attribute(
  doc: Y.Doc,
  item: Y.Item,
  start = item.id.clock,
  end = item.id.clock + item.length
): Touch | null {
  let current: Y.Item | null = item;
  let key = item.parentSub;
  const seen = new Set<Y.Item>();
  while (current) {
    if (seen.has(current)) deny();
    seen.add(current);
    if (current.parentSub === POLICY_KEY) deny();
    const parent: Y.Item['parent'] = current.parent;
    if (!(parent instanceof Y.AbstractType)) deny();
    if (parent === doc.getMap('blocks')) {
      if (current.parentSub === null || current.deleted) deny();
      return {
        blockId: current.parentSub,
        key,
        rootEntry: current === item,
        ...(key === 'sys:children' && item.parent instanceof Y.Array
          ? {
              childIds: item.content
                .getContent()
                .slice(
                  Math.max(0, start - item.id.clock),
                  Math.min(item.length, end - item.id.clock)
                ) as string[],
            }
          : {}),
      };
    }
    if (!parent._item) {
      // Another top-level type (for example workspace metadata).
      if (![...doc.share.values()].includes(parent)) deny();
      return null;
    }
    key = current.parentSub ?? key;
    current = parent._item;
  }
  return deny();
}

function range(doc: Y.Doc, client: number, start: number, end: number) {
  const structs = doc.store.clients.get(client) ?? [];
  const result: (Y.Item | Y.GC)[] = [];
  let clock = start;
  // Binary search avoids rescanning a client's complete history for each op.
  let lo = 0;
  let hi = structs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const struct = structs[mid];
    if (struct.id.clock + struct.length <= start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < structs.length && clock < end; i++) {
    const struct = structs[i];
    if (struct.id.clock > clock) deny();
    result.push(struct);
    clock = struct.id.clock + struct.length;
  }
  if (clock < end) deny();
  return result;
}

function cutoff(before: Graph, after: Graph, touches: Touch[], now: number) {
  let expiresAt: number | undefined;
  for (const touch of touches) {
    if (!before.has(touch.blockId) && !after.has(touch.blockId)) deny();
  }
  for (const id of databases(after)) {
    if (before.get(id)?.flavour !== DATABASE_FLAVOUR) deny();
  }
  for (const id of databases(before)) {
    const members = descendants(before, id);
    const parents = ancestors(before, id);
    if (after.get(id)?.flavour === DATABASE_FLAVOUR) {
      for (const member of descendants(after, id)) members.add(member);
      for (const parent of ancestors(after, id)) parents.add(parent);
    }
    const touched = touches.some(
      touch =>
        members.has(touch.blockId) ||
        (parents.has(touch.blockId) &&
          (touch.rootEntry ||
            touch.key === 'sys:flavour' ||
            (touch.key === 'sys:children' &&
              (!touch.childIds ||
                touch.childIds.some(
                  child => child === id || parents.has(child)
                )))))
    );
    if (!touched) continue;
    const until = before.get(id)?.until;
    if (typeof until !== 'number' || !Number.isFinite(until) || until <= now)
      deny();
    expiresAt = expiresAt === undefined ? until : Math.min(expiresAt, until);
  }
  return expiresAt;
}

/** Validate every operation, including invisible writes, before any persistence. */
export function validateDatabaseUpdates(
  snapshot: Uint8Array | null,
  persisted: readonly Uint8Array[],
  incoming: readonly Uint8Array[],
  now = Date.now()
): DatabaseValidation {
  const doc = load(snapshot, persisted);
  let expiresAt: number | undefined;
  try {
    const metadataBefore = snapshotWorkspaceDeletionState(doc);
    for (const update of incoming) {
      const before = graph(doc);
      const decoded = Y.decodeUpdate(update);
      const state = Y.decodeStateVector(Y.encodeStateVector(doc));
      const touches: Touch[] = [];
      // Attribute deletions before applying, while deleted flags still reflect
      // the canonical state. Already-deleted ranges are ordinary replay.
      for (const [client, deletes] of decoded.ds.clients) {
        const knownEnd = state.get(client) ?? 0;
        for (const deletion of deletes) {
          const end = Math.min(knownEnd, deletion.clock + deletion.len);
          if (deletion.clock >= end) continue;
          for (const struct of range(doc, client, deletion.clock, end)) {
            if (struct instanceof Y.GC) continue; // Already deleted: replay.
            if (!struct.deleted) {
              const touch = attribute(doc, struct, deletion.clock, end);
              if (touch) touches.push(touch);
            }
          }
        }
      }
      Y.applyUpdate(doc, update);
      assertResolved(doc);
      for (const struct of decoded.structs) {
        const start = Math.max(
          state.get(struct.id.client) ?? 0,
          struct.id.clock
        );
        const end = struct.id.clock + struct.length;
        if (start >= end) continue;
        if (!(struct instanceof Y.Item)) deny();
        for (const integrated of range(doc, struct.id.client, start, end)) {
          if (!(integrated instanceof Y.Item)) deny();
          const touch = attribute(doc, integrated, start, end);
          if (touch) {
            if (
              touch.key === 'sys:flavour' &&
              integrated.content.getContent().includes(DATABASE_FLAVOUR)
            )
              deny();
            touches.push(touch);
          }
        }
      }
      // Delete ranges can include newly inserted structs in the same update.
      // Their insertion attribution above covers even insert-then-delete ops;
      // unresolved or GC deletion ancestry is never accepted.
      for (const [client, deletes] of decoded.ds.clients) {
        for (const deletion of deletes) {
          for (const struct of range(
            doc,
            client,
            deletion.clock,
            deletion.clock + deletion.len
          )) {
            if (
              !(struct instanceof Y.Item) &&
              struct.id.clock + struct.length > (state.get(client) ?? 0)
            )
              deny();
          }
        }
      }
      const next = cutoff(before, graph(doc), touches, now);
      if (next !== undefined)
        expiresAt = expiresAt === undefined ? next : Math.min(expiresAt, next);
    }
    assertNoWorkspaceMetadataDeletion(
      metadataBefore,
      snapshotWorkspaceDeletionState(doc)
    );
    return {
      stateHash: databaseStateHash(snapshot, persisted),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
  } catch (error) {
    if (error instanceof DatabaseEditDenied) throw error;
    return deny();
  } finally {
    doc.destroy();
  }
}

/** Windows cannot authorize restoring historical policies or database content. */
export function validateDatabaseRecovery(
  snapshot: Uint8Array | null,
  persisted: readonly Uint8Array[],
  historical: Uint8Array
): DatabaseValidation {
  const before = load(snapshot, persisted);
  let after: Y.Doc | undefined;
  try {
    after = load(historical, []);
    if (databases(graph(before)).length || databases(graph(after)).length)
      deny();
    assertNoWorkspaceMetadataDeletion(
      snapshotWorkspaceDeletionState(before),
      snapshotWorkspaceDeletionState(after)
    );
    return {
      stateHash: databaseStateHash(snapshot, persisted),
      historyHash: createHash('sha256').update(historical).digest('hex'),
    };
  } catch (error) {
    if (error instanceof DatabaseEditDenied) throw error;
    return deny();
  } finally {
    before.destroy();
    after?.destroy();
  }
}
