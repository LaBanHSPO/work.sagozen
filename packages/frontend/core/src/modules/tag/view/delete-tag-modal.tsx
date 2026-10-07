import { toast, useConfirmModal } from '@affine/component';
import { Trans, useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback } from 'react';

import { WorkspacePermissionService } from '../../permissions';
import { TagService } from '../service/tag';

/**
 * Show a confirm modal AND delete the tags
 */
export const useDeleteTagConfirmModal = () => {
  const { openConfirmModal } = useConfirmModal();

  const t = useI18n();
  const tagService = useService(TagService);
  const permission = useService(WorkspacePermissionService).permission;
  const tags = useLiveData(tagService.tagList.tags$);

  const confirm = useCallback(
    (tagIdsToDelete: string[]) => {
      if (permission.isOwnerOrAdmin$.value !== true) {
        return Promise.resolve(false);
      }
      let closed = false;
      const { resolve, promise } = Promise.withResolvers<boolean>();
      const tagToDelete = tags.find(tag => tagIdsToDelete.includes(tag.id));
      const tagName = tagToDelete?.value$.value;
      const handleClose = (state: boolean) => {
        if (!closed) {
          closed = true;
          const confirmed = state && permission.isOwnerOrAdmin$.value === true;
          resolve(confirmed);

          if (confirmed) {
            tagIdsToDelete.forEach(tagId => {
              tagService.tagList.deleteTag(tagId);
            });
            toast(
              tagIdsToDelete.length > 1
                ? t['com.affine.delete-tags.count']({
                    count: tagIdsToDelete.length,
                  })
                : t['com.affine.tags.delete-tags.toast']()
            );
          }
        }
      };
      openConfirmModal({
        title: t['com.affine.delete-tags.confirm.title'](),
        description:
          tagIdsToDelete.length === 1 ? (
            <Trans
              i18nKey={'com.affine.delete-tags.confirm.description'}
              values={{ tag: tagName }}
              components={{ 1: <strong /> }}
            />
          ) : (
            t['com.affine.delete-tags.confirm.multi-tag-description']({
              count: tagIdsToDelete.length.toString(),
            })
          ),
        confirmText: t['Delete'](),
        confirmButtonOptions: {
          variant: 'error',
        },
        onConfirm: () => {
          handleClose(true);
        },
        onCancel: () => {
          handleClose(false);
        },
        onOpenChange: state => {
          handleClose(state);
        },
      });
      return promise;
    },
    [openConfirmModal, t, tagService.tagList, tags, permission]
  );

  return confirm;
};
