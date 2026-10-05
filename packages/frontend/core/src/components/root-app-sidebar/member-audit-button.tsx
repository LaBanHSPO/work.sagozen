import { Button, Menu, Scrollable } from '@affine/component';
import { MenuItem } from '@affine/core/modules/app-sidebar/views';
import { WorkspaceServerService } from '@affine/core/modules/cloud';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { UserFriendlyError } from '@affine/error';
import { workspaceMemberAuditLogsQuery } from '@affine/graphql';
import { HistoryIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useGuard } from '../guard/use-guard';
import * as styles from './member-audit-button.style.css';

type AuditLog = {
  id: string;
  action: string;
  actorName: string;
  actorEmail: string | null;
  targetName: string | null;
  targetEmail: string | null;
  detail: string | null;
  createdAt: string;
};

const PAGE_SIZE = 20;

function describe(log: AuditLog) {
  const target = log.targetName ?? 'a member';
  switch (log.action) {
    case 'invited':
      return `${log.actorName} invited ${target}`;
    case 'approved':
      return `${log.actorName} approved ${target}`;
    case 'declined':
      return `${log.actorName} declined ${target}'s request to join`;
    case 'role_changed':
      return `${log.actorName} changed ${target}'s role to ${log.detail ?? 'a new role'}`;
    case 'removed':
      return `${log.actorName} removed ${target}`;
    case 'joined':
      return `${log.actorName} joined the workspace`;
    case 'left':
      return `${log.actorName} left the workspace`;
    case 'invite_link_created':
      return `${log.actorName} created an invite link`;
    case 'invite_link_revoked':
      return `${log.actorName} revoked an invite link`;
    case 'doc_published':
      return `${log.actorName} shared ${log.detail ?? 'a document'} with anyone with the link`;
    default:
      return `${log.actorName} updated a member`;
  }
}

const MemberAuditList = ({ workspaceId }: { workspaceId: string }) => {
  const serverService = useService(WorkspaceServerService);
  const server = useLiveData(serverService.server$);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [nextOffset, setNextOffset] = useState(0);

  const load = useCallback(
    async (skip: number) => {
      if (!server || loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await server.gql({
          query: workspaceMemberAuditLogsQuery,
          variables: { workspaceId, skip, take: PAGE_SIZE },
        });
        const page = result.workspaceMemberAuditLogs;
        setLogs(current => {
          if (skip === 0) return page;
          const seen = new Set(current.map(log => log.id));
          return [...current, ...page.filter(log => !seen.has(log.id))];
        });
        setNextOffset(skip + page.length);
        setHasMore(page.length === PAGE_SIZE);
      } catch (cause) {
        setError(UserFriendlyError.fromAny(cause).message);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [server, workspaceId]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div
      className={styles.container}
      data-mobile={environment.isMobile ? '' : undefined}
    >
      <div className={styles.header}>Member activity</div>
      <Scrollable.Root className={styles.scrollRoot}>
        <Scrollable.Viewport className={styles.scrollViewport}>
          {logs.length === 0 && !loading && !error && (
            <div className={styles.empty}>No member activity recorded yet.</div>
          )}
          {logs.map(log => (
            <div className={styles.row} key={log.id}>
              <div>{describe(log)}</div>
              {(log.actorEmail || log.targetEmail) && (
                <div className={styles.identity}>
                  {[log.actorEmail, log.targetEmail]
                    .filter(Boolean)
                    .join(' → ')}
                </div>
              )}
              <time className={styles.time} dateTime={log.createdAt}>
                {new Date(log.createdAt).toLocaleString()}
              </time>
            </div>
          ))}
          {error && (
            <div className={styles.status}>
              <span>{error}</span>
              <Button onClick={() => void load(nextOffset)}>Retry</Button>
            </div>
          )}
          {loading && <div className={styles.status}>Loading...</div>}
          {!loading && !error && hasMore && logs.length > 0 && (
            <div className={styles.status}>
              <Button onClick={() => void load(nextOffset)}>Load more</Button>
            </div>
          )}
        </Scrollable.Viewport>
        <Scrollable.Scrollbar />
      </Scrollable.Root>
    </div>
  );
};

const CloudMemberAuditButton = ({ workspaceId }: { workspaceId: string }) => {
  const canManage = useGuard('Workspace_Users_Manage');
  const [open, setOpen] = useState(false);

  if (!canManage) return null;

  return (
    <Menu
      rootOptions={{ open, onOpenChange: setOpen }}
      contentOptions={{ side: 'right', sideOffset: -50 }}
      items={
        open ? (
          <MemberAuditList key={workspaceId} workspaceId={workspaceId} />
        ) : null
      }
    >
      <MenuItem icon={<HistoryIcon />} active={open}>
        <span data-testid="member-audit-button">Member activity</span>
      </MenuItem>
    </Menu>
  );
};

export const MemberAuditButton = () => {
  const workspace = useService(WorkspaceService).workspace;
  if (workspace.flavour === 'local' || workspace.openOptions.isSharedMode) {
    return null;
  }
  return <CloudMemberAuditButton workspaceId={workspace.id} />;
};
