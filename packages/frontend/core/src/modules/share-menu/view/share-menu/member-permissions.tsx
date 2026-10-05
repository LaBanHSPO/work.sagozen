import { Button, Modal } from '@affine/component';
import { DocMemberPermissionsService } from '@affine/core/modules/permissions';
import { parseMemberPermissionRules } from '@affine/core/modules/permissions/member-permission-rules';
import { WorkspaceService } from '@affine/core/modules/workspace';
import type { DocMemberPermissionsSnapshot } from '@affine/realtime';
import { useService } from '@toeverything/infra';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as styles from './member-permissions.css';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const MemberPermissionsButton = ({
  docId,
  onClick,
}: {
  docId: string;
  onClick: () => void;
}) => {
  const service = useService(DocMemberPermissionsService);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCanEdit(false);
    setError(null);
    service.fetchMemberPermissions(docId, controller.signal).then(
      snapshot => {
        if (!controller.signal.aborted) setCanEdit(snapshot.canEdit);
      },
      error => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      }
    );
    return () => controller.abort();
  }, [attempt, docId, service]);

  return (
    <>
      {canEdit && (
        <Button
          variant="plain"
          onClick={onClick}
          data-testid="member-permissions-open"
        >
          Edit member permissions JSON
        </Button>
      )}
      {error && (
        <div className={styles.body}>
          <div className={styles.error} role="alert">
            Could not load member permission controls: {error}
          </div>
          <Button
            variant="plain"
            onClick={() => setAttempt(value => value + 1)}
          >
            Retry
          </Button>
        </div>
      )}
    </>
  );
};

export const MemberPermissionsModal = ({
  docId,
  open,
  onOpenChange,
}: {
  docId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const service = useService(DocMemberPermissionsService);
  const [snapshot, setSnapshot] = useState<DocMemberPermissionsSnapshot | null>(
    null
  );
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const id = useId();

  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await service.fetchMemberPermissions(
        docId,
        controller.signal
      );
      if (controller.signal.aborted) return;
      setSnapshot(result);
      setDraft(JSON.stringify(result.rules, null, 2));
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [docId, service]);

  useEffect(() => {
    if (open) {
      setSnapshot(null);
      setDraft('');
      setError(null);
      reload().catch(error => setError(errorMessage(error)));
    }
    return () => request.current?.abort();
  }, [open, reload]);

  const parsed = useMemo(() => {
    if (!snapshot?.canEdit) return { rules: null, error: null };
    try {
      return { rules: parseMemberPermissionRules(draft), error: null };
    } catch (error) {
      return { rules: null, error: errorMessage(error) };
    }
  }, [draft, snapshot?.canEdit]);
  const busy = loading || saving;
  const dirty =
    snapshot !== null && draft !== JSON.stringify(snapshot.rules, null, 2);
  const save = async () => {
    if (!snapshot?.canEdit || !parsed.rules || busy) return;
    setSaving(true);
    setError(null);
    try {
      const result = await service.setMemberPermissions(
        docId,
        snapshot.revision,
        parsed.rules
      );
      setSnapshot(result);
      setDraft(JSON.stringify(result.rules, null, 2));
      onOpenChange(false);
    } catch (error) {
      // The draft and its original revision stay intact on conflicts or failures.
      setError(
        `${errorMessage(error)} Your draft has been kept. Reload from server to replace it with the latest rules.`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={next => {
        if (!saving) onOpenChange(next);
      }}
      width={640}
      title="Document member permissions"
      description="Edit the default access and individual grants for active workspace members."
    >
      <div className={styles.body} aria-busy={busy}>
        {loading && <div role="status">Loading member permissions…</div>}
        {snapshot?.canEdit && (
          <>
            <p className={styles.description} id={`${id}-help`}>
              defaultRole accepts none, reader, commenter, editor or manager.
              Each member needs an active workspace userId and a role of reader,
              commenter, editor or manager. Omitted active non-owner member
              grants are removed, so those members inherit the default.
              Ownership, guests, inactive members, groups and public sharing are
              unchanged.
            </p>
            <details className={styles.description}>
              <summary>JSON example</summary>
              <pre>
                {
                  '{\n  "defaultRole": "reader",\n  "members": [\n    { "userId": "workspace-member-id", "role": "editor" }\n  ]\n}'
                }
              </pre>
            </details>
            <label htmlFor={`${id}-rules`}>Member permissions JSON</label>
            <textarea
              id={`${id}-rules`}
              className={styles.textarea}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              disabled={busy}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-invalid={!!parsed.error}
              aria-describedby={`${id}-help${parsed.error ? ` ${id}-validation` : ''}${error ? ` ${id}-error` : ''}`}
              data-testid="member-permissions-json"
            />
            {parsed.error && (
              <div
                className={styles.error}
                role="alert"
                id={`${id}-validation`}
              >
                {parsed.error}
              </div>
            )}
          </>
        )}
        {snapshot && !snapshot.canEdit && (
          <p role="status">
            Only eligible workspace administrators and document owners can edit
            these rules.
          </p>
        )}
        {error && (
          <div className={styles.error} role="alert" id={`${id}-error`}>
            {error}
          </div>
        )}
        {dirty && (
          <p className={styles.description}>
            Reload from server discards the unsaved draft. Permission updates do
            not replace your draft automatically.
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={() => void reload()} disabled={busy}>
            Reload from server
          </Button>
          <Button onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          {snapshot?.canEdit && (
            <Button
              variant="primary"
              loading={saving}
              disabled={busy || !parsed.rules || !dirty}
              onClick={() => void save()}
              data-testid="member-permissions-save"
            >
              Save
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

// The denied/loading route has no DocScope, but administrators must still be
// able to repair member access without being granted document content access.
export const RestrictedDocMemberPermissions = ({
  docId,
  showTrigger,
}: {
  docId: string;
  showTrigger: boolean;
}) => {
  const workspace = useService(WorkspaceService).workspace;
  const [open, setOpen] = useState(false);
  if (workspace.flavour !== 'affine-cloud') return null;
  return (
    <>
      {showTrigger && (
        <div className={styles.restrictedControls}>
          <MemberPermissionsButton
            docId={docId}
            onClick={() => setOpen(true)}
          />
        </div>
      )}
      <MemberPermissionsModal
        docId={docId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
};
