import * as Y from 'yjs';

export class WorkspaceMetadataDeleteDenied extends Error {
  constructor() {
    super('Only workspace owners and admins may delete collections or tags');
    this.name = 'WorkspaceMetadataDeleteDenied';
  }
}

export interface WorkspaceDeletionState {
  collectionIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
}

function field(value: unknown, key: string): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Y.Map) return value.get(key);
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.prototype.hasOwnProperty.call(value, key)
      ? (value as Record<string, unknown>)[key]
      : undefined;
  }
  throw new WorkspaceMetadataDeleteDenied();
}

function ids(value: unknown): ReadonlySet<string> {
  if (value === undefined) return new Set();
  const entries = value instanceof Y.Array ? value.toArray() : value;
  if (!Array.isArray(entries)) throw new WorkspaceMetadataDeleteDenied();
  const result = new Set<string>();
  for (const entry of entries) {
    const id = field(entry, 'id');
    if (typeof id !== 'string' || !id.length || result.has(id)) {
      throw new WorkspaceMetadataDeleteDenied();
    }
    result.add(id);
  }
  return result;
}

function root(doc: Y.Doc, name: string): Y.Map<unknown> | undefined {
  if (!doc.share.has(name)) return undefined;
  // Applied updates initially hydrate root types as AbstractType. getMap
  // resolves the repository's known map schema before reading its contents.
  try {
    const map = doc.getMap(name);
    if (map._start !== null) throw new WorkspaceMetadataDeleteDenied();
    return map;
  } catch {
    throw new WorkspaceMetadataDeleteDenied();
  }
}

export function snapshotWorkspaceDeletionState(
  doc: Y.Doc
): WorkspaceDeletionState {
  return {
    collectionIds: ids(field(root(doc, 'setting'), 'collections')),
    tagIds: ids(
      field(field(field(root(doc, 'meta'), 'properties'), 'tags'), 'options')
    ),
  };
}

export function assertNoWorkspaceMetadataDeletion(
  before: WorkspaceDeletionState,
  after: WorkspaceDeletionState
): void {
  for (const id of before.collectionIds) {
    if (!after.collectionIds.has(id)) throw new WorkspaceMetadataDeleteDenied();
  }
  for (const id of before.tagIds) {
    if (!after.tagIds.has(id)) throw new WorkspaceMetadataDeleteDenied();
  }
}
