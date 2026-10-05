import { IconButton, type MenuRef, MobileMenu } from '@affine/component';
import { useEnableCloud } from '@affine/core/components/hooks/affine/use-enable-cloud';
import { DocService } from '@affine/core/modules/doc';
import { ShareMenuContent } from '@affine/core/modules/share-menu';
import { MemberPermissionsModal } from '@affine/core/modules/share-menu/view/share-menu/member-permissions';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { ShareiOsIcon } from '@blocksuite/icons/rc';
import { useServices } from '@toeverything/infra';
import { useCallback, useRef, useState } from 'react';

import * as styles from './page-header-share-button.css';

export const PageHeaderShareButton = () => {
  const { workspaceService, docService } = useServices({
    WorkspaceService,
    DocService,
  });
  const workspace = workspaceService.workspace;
  const doc = docService.doc.blockSuiteDoc;
  const confirmEnableCloud = useEnableCloud();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<MenuRef>(null);
  const [memberPermissionsOpen, setMemberPermissionsOpen] = useState(false);
  const openMemberPermissions = useCallback(() => {
    menuRef.current?.changeOpen(false);
    setMemberPermissionsOpen(true);
  }, []);

  if (workspace.meta.flavour === 'local') {
    return null;
  }

  return (
    <>
      <MobileMenu
        ref={menuRef}
        rootOptions={{ open: menuOpen, onOpenChange: setMenuOpen }}
        items={
          <div className={styles.content}>
            <ShareMenuContent
              workspaceMetadata={workspace.meta}
              currentPage={doc}
              onEnableAffineCloud={() =>
                confirmEnableCloud(workspace, {
                  openPageId: doc.id,
                })
              }
              onEditMemberPermissions={openMemberPermissions}
            />
          </div>
        }
      >
        <IconButton size={24} style={{ padding: 10 }} icon={<ShareiOsIcon />} />
      </MobileMenu>
      <MemberPermissionsModal
        docId={doc.id}
        open={memberPermissionsOpen}
        onOpenChange={setMemberPermissionsOpen}
      />
    </>
  );
};
