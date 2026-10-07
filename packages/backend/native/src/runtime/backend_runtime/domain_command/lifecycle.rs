use affine_core::access_control::{DocLifecycleCommand, DomainCommand};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use chrono::Utc;
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use y_octo::{Any, Doc, Value as YValue};

use super::{
  DocLifecycle, authorize_domain, invalidate_doc_blob_projection, lock_workspace_doc_update,
  lock_workspace_storage_shared, next_workspace_doc_update_timestamp,
};
use crate::runtime::{RuntimeError, RuntimeResult, backend_runtime::permission::PermissionAuthorizer};

pub(super) async fn apply(
  authorizer: &PermissionAuthorizer,
  transaction: &mut Transaction<'_, Postgres>,
  actor_user_id: String,
  workspace_id: String,
  doc_id: String,
  lifecycle: DocLifecycle,
  embedding_schema_ready: bool,
) -> RuntimeResult<Value> {
  if workspace_id == doc_id {
    return Err(RuntimeError::invalid_input("doc_is_workspace"));
  }
  lock_workspace_storage_shared(transaction, &workspace_id).await?;
  let mut locked_doc_ids = [&*workspace_id, &*doc_id];
  locked_doc_ids.sort_unstable();
  for locked_doc_id in locked_doc_ids {
    lock_workspace_doc_update(transaction, &workspace_id, locked_doc_id).await?;
  }
  let command = DomainCommand::ApplyDocLifecycle {
    doc_id: doc_id.clone(),
    lifecycle: match lifecycle {
      DocLifecycle::Trash => DocLifecycleCommand::Trash,
      DocLifecycle::Restore => DocLifecycleCommand::Restore,
      DocLifecycle::Delete => DocLifecycleCommand::Delete,
    },
  };
  authorize_domain(
    authorizer,
    transaction,
    &actor_user_id,
    &workspace_id,
    Some(&doc_id),
    &command,
  )
  .await?;

  let snapshot =
    sqlx::query_scalar::<_, Vec<u8>>("SELECT blob FROM snapshots WHERE workspace_id=$1 AND guid=$1 FOR UPDATE")
      .bind(&workspace_id)
      .fetch_optional(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("load workspace root snapshot", error))?
      .ok_or_else(|| RuntimeError::invalid_input("workspace_root_not_found"))?;
  let updates = sqlx::query_scalar::<_, Vec<u8>>(
    "SELECT blob FROM updates WHERE workspace_id=$1 AND guid=$1 ORDER BY created_at FOR SHARE",
  )
  .bind(&workspace_id)
  .fetch_all(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("load workspace root updates", error))?;
  let root_update = mutate_root(snapshot, updates, &doc_id, lifecycle)?;
  let timestamp = next_workspace_doc_update_timestamp(transaction, &workspace_id, &workspace_id).await?;
  sqlx::query("INSERT INTO updates (workspace_id,guid,blob,created_at,created_by) VALUES($1,$1,$2,$3,$4)")
    .bind(&workspace_id)
    .bind(&root_update)
    .bind(timestamp)
    .bind(&actor_user_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| RuntimeError::database("persist workspace root lifecycle update", error))?;
  invalidate_doc_blob_projection(transaction, &workspace_id, &workspace_id, embedding_schema_ready).await?;

  if matches!(lifecycle, DocLifecycle::Delete) {
    delete_doc_rows(transaction, &workspace_id, &doc_id).await?;
  }
  Ok(json!({
    "workspaceId": workspace_id,
    "docId": doc_id,
    "lifecycle": match lifecycle {
      DocLifecycle::Trash => "trash",
      DocLifecycle::Restore => "restore",
      DocLifecycle::Delete => "delete",
    },
    "rootUpdate": BASE64.encode(root_update),
    "timestamp": timestamp,
  }))
}

pub(super) async fn append_root_update(
  authorizer: &PermissionAuthorizer,
  transaction: &mut Transaction<'_, Postgres>,
  actor_user_id: String,
  workspace_id: String,
  encoded_update: String,
  expected_permission_generation: Option<i64>,
  embedding_schema_ready: bool,
  database_validation: Option<super::super::doc_writer::DatabaseValidationV1>,
) -> RuntimeResult<Value> {
  lock_workspace_storage_shared(transaction, &workspace_id).await?;
  lock_workspace_doc_update(transaction, &workspace_id, &workspace_id).await?;
  let command = DomainCommand::AppendRootUpdate {
    doc_id: workspace_id.clone(),
  };
  authorize_domain(
    authorizer,
    transaction,
    &actor_user_id,
    &workspace_id,
    Some(&workspace_id),
    &command,
  )
  .await?;
  if let Some(expected) = expected_permission_generation {
    sqlx::query(
      "INSERT INTO workspace_sync_permission_generations(workspace_id,generation) VALUES($1,0) ON CONFLICT DO NOTHING",
    )
    .bind(&workspace_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| RuntimeError::database("initialize sync permission generation", error))?;
    let current = sqlx::query_scalar::<_, i64>(
      "SELECT generation FROM workspace_sync_permission_generations WHERE workspace_id=$1 FOR SHARE",
    )
    .bind(&workspace_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| RuntimeError::database("lock sync permission generation", error))?;
    if current != expected {
      return Err(RuntimeError::invalid_state("sync_permission_generation_changed"));
    }
  }
  let snapshot =
    sqlx::query_scalar::<_, Vec<u8>>("SELECT blob FROM snapshots WHERE workspace_id=$1 AND guid=$1 FOR UPDATE")
      .bind(&workspace_id)
      .fetch_optional(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("load root snapshot for append", error))?;
  let updates = sqlx::query_scalar::<_, Vec<u8>>(
    "SELECT blob FROM updates WHERE workspace_id=$1 AND guid=$1 ORDER BY created_at FOR SHARE",
  )
  .bind(&workspace_id)
  .fetch_all(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("load root updates for append", error))?;
  let update = BASE64
    .decode(encoded_update)
    .map_err(|error| RuntimeError::invalid_input(format!("invalid root update: {error}")))?;
  let initialize = snapshot.is_none();
  let merged = validate_root_update(snapshot.unwrap_or_else(|| vec![0, 0]), updates, &update)?;
  super::super::doc_writer::validate_database_proof(
    transaction,
    &workspace_id,
    &workspace_id,
    &actor_user_id,
    database_validation.as_ref(),
    None,
  )
  .await?;
  let timestamp = next_workspace_doc_update_timestamp(transaction, &workspace_id, &workspace_id).await?;
  if initialize {
    sqlx::query(
      "INSERT INTO snapshots (workspace_id,guid,blob,size,updated_at,created_by,updated_by) \
       VALUES($1,$1,$2,$3,$4,$5,$5)",
    )
    .bind(&workspace_id)
    .bind(&merged)
    .bind(merged.len() as i64)
    .bind(timestamp)
    .bind(&actor_user_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| RuntimeError::database("initialize canonical root snapshot", error))?;
  } else {
    sqlx::query("INSERT INTO updates (workspace_id,guid,blob,created_at,created_by) VALUES($1,$1,$2,$3,$4)")
      .bind(&workspace_id)
      .bind(&update)
      .bind(timestamp)
      .bind(&actor_user_id)
      .execute(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("append canonical root update", error))?;
  }
  invalidate_doc_blob_projection(transaction, &workspace_id, &workspace_id, embedding_schema_ready).await?;
  Ok(json!({ "timestamp": timestamp }))
}

pub(in crate::runtime::backend_runtime) async fn workspace_root_contains_active_doc(
  transaction: &mut Transaction<'_, Postgres>,
  workspace_id: &str,
  doc_id: &str,
) -> RuntimeResult<bool> {
  let Some(snapshot) =
    sqlx::query_scalar::<_, Vec<u8>>("SELECT blob FROM snapshots WHERE workspace_id=$1 AND guid=$1 FOR SHARE")
      .bind(workspace_id)
      .fetch_optional(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("load workspace root for document creation", error))?
  else {
    return Ok(false);
  };
  let updates = sqlx::query_scalar::<_, Vec<u8>>(
    "SELECT blob FROM updates WHERE workspace_id=$1 AND guid=$1 ORDER BY created_at FOR SHARE",
  )
  .bind(workspace_id)
  .fetch_all(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("load workspace root updates for document creation", error))?;
  let mut root = Doc::default();
  root
    .apply_update_from_binary_v1(&snapshot)
    .map_err(|error| RuntimeError::invalid_state(format!("workspace root snapshot invalid: {error}")))?;
  for update in updates {
    root
      .apply_update_from_binary_v1(&update)
      .map_err(|error| RuntimeError::invalid_state(format!("workspace root update invalid: {error}")))?;
  }
  let binary = root
    .encode_update_v1()
    .map_err(|error| RuntimeError::invalid_state(format!("encode workspace root failed: {error}")))?;
  Ok(project_complete_root(binary, false, "before document creation")?.contains(doc_id))
}

/// Called under the workspace root update lock for authenticated append batches.
pub(in crate::runtime::backend_runtime) async fn validate_workspace_root_updates_in<'a>(
  transaction: &mut Transaction<'_, Postgres>,
  workspace_id: &str,
  incoming: impl IntoIterator<Item = &'a [u8]>,
) -> RuntimeResult<()> {
  let snapshot =
    sqlx::query_scalar::<_, Vec<u8>>("SELECT blob FROM snapshots WHERE workspace_id=$1 AND guid=$1 FOR SHARE")
      .bind(workspace_id)
      .fetch_optional(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("load root lifecycle validation snapshot", error))?;
  let updates = sqlx::query_scalar::<_, Vec<u8>>(
    "SELECT blob FROM updates WHERE workspace_id=$1 AND guid=$1 ORDER BY created_at FOR SHARE",
  )
  .bind(workspace_id)
  .fetch_all(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("load root lifecycle validation updates", error))?;
  validate_root_updates(snapshot.unwrap_or_else(|| vec![0, 0]), updates, incoming)?;
  Ok(())
}

fn validate_root_update(snapshot: Vec<u8>, updates: Vec<Vec<u8>>, incoming: &[u8]) -> RuntimeResult<Vec<u8>> {
  validate_root_updates(snapshot, updates, std::iter::once(incoming))
}

fn validate_root_updates<'a>(
  snapshot: Vec<u8>,
  updates: Vec<Vec<u8>>,
  incoming: impl IntoIterator<Item = &'a [u8]>,
) -> RuntimeResult<Vec<u8>> {
  let mut root = Doc::default();
  root
    .apply_update_from_binary_v1(&snapshot)
    .map_err(|error| RuntimeError::invalid_state(format!("workspace root snapshot invalid: {error}")))?;
  for update in updates {
    root
      .apply_update_from_binary_v1(&update)
      .map_err(|error| RuntimeError::invalid_state(format!("workspace root update invalid: {error}")))?;
  }
  let mut before = root
    .encode_update_v1()
    .map_err(|error| RuntimeError::invalid_state(format!("encode root before append failed: {error}")))?;
  for update in incoming {
    root
      .apply_update_from_binary_v1(update)
      .map_err(|error| RuntimeError::invalid_input(format!("invalid root update: {error}")))?;
    let after = root
      .encode_update_v1()
      .map_err(|error| RuntimeError::invalid_state(format!("encode root after append failed: {error}")))?;
    validate_root_lifecycle_transition(before, &after)?;
    before = after;
  }
  Ok(before)
}

pub(in crate::runtime::backend_runtime) fn validate_root_lifecycle_transition(
  before: Vec<u8>,
  after: &[u8],
) -> RuntimeResult<()> {
  let old_all = project_complete_root(before.clone(), true, "before update")?;
  let old_active = project_complete_root(before, false, "before update")?;
  let new_all = project_complete_root(after.to_vec(), true, "after update")?;
  let new_active = project_complete_root(after.to_vec(), false, "after update")?;
  let deletes = old_all.iter().any(|id| !new_all.contains(id));
  let trashes = old_active.iter().any(|id| !new_active.contains(id))
    || new_all
      .iter()
      .any(|id| !old_all.contains(id) && !new_active.contains(id));
  let restores = new_active
    .iter()
    .any(|id| old_all.contains(id) && !old_active.contains(id));
  if deletes || trashes || restores {
    return Err(RuntimeError::invalid_input("doc_lifecycle_requires_command"));
  }
  Ok(())
}

fn project_complete_root(
  binary: Vec<u8>,
  include_trash: bool,
  operation: &str,
) -> RuntimeResult<std::collections::BTreeSet<String>> {
  if binary == [0, 0] {
    return Ok(Default::default());
  }
  let projection = affine_doc_loader::project_workspace_root(binary, include_trash)
    .map_err(|error| RuntimeError::invalid_state(format!("project root {operation} failed: {error}")))?;
  if !projection.complete {
    return Err(RuntimeError::invalid_state(format!(
      "workspace root {operation} is incomplete"
    )));
  }
  Ok(projection.doc_ids.into_iter().collect())
}

fn mutate_root(
  snapshot: Vec<u8>,
  updates: Vec<Vec<u8>>,
  doc_id: &str,
  lifecycle: DocLifecycle,
) -> RuntimeResult<Vec<u8>> {
  let mut root = Doc::default();
  root
    .apply_update_from_binary_v1(&snapshot)
    .map_err(|error| RuntimeError::invalid_state(format!("workspace root snapshot invalid: {error}")))?;
  for update in updates {
    root
      .apply_update_from_binary_v1(&update)
      .map_err(|error| RuntimeError::invalid_state(format!("workspace root update invalid: {error}")))?;
  }
  let before = root
    .encode_update_v1()
    .map_err(|error| RuntimeError::invalid_state(format!("encode workspace root failed: {error}")))?;
  project_complete_root(before, true, "before lifecycle command")?;
  let state = root.get_state_vector();
  let meta = root
    .get_map("meta")
    .map_err(|error| RuntimeError::invalid_state(format!("workspace root meta missing: {error}")))?;
  let mut pages = meta
    .get("pages")
    .and_then(|value| value.to_array())
    .ok_or_else(|| RuntimeError::invalid_state("workspace root pages missing"))?;
  let index = pages
    .iter()
    .position(|value| {
      value
        .to_map()
        .and_then(|page| page.get("id"))
        .and_then(|id| id.to_any())
        == Some(Any::String(doc_id.to_string()))
    })
    .ok_or_else(|| RuntimeError::invalid_input("doc_not_found"))?;
  match lifecycle {
    DocLifecycle::Trash | DocLifecycle::Restore => {
      let mut page = pages
        .iter()
        .nth(index)
        .and_then(|value| value.to_map())
        .ok_or_else(|| RuntimeError::invalid_state("workspace root doc meta invalid"))?;
      page
        .insert(
          "trash".to_string(),
          YValue::Any(if matches!(lifecycle, DocLifecycle::Trash) {
            Any::True
          } else {
            Any::False
          }),
        )
        .map_err(|error| RuntimeError::invalid_state(format!("write doc lifecycle failed: {error}")))?;
      if matches!(lifecycle, DocLifecycle::Trash) {
        page
          .insert(
            "trashDate".to_string(),
            YValue::Any(Any::BigInt64(Utc::now().timestamp_millis())),
          )
          .map_err(|error| RuntimeError::invalid_state(format!("write trash timestamp failed: {error}")))?;
      } else {
        page.remove("trashDate");
      }
    }
    DocLifecycle::Delete => pages
      .remove(index as u64, 1)
      .map_err(|error| RuntimeError::invalid_state(format!("delete doc meta failed: {error}")))?,
  }
  root
    .encode_state_as_update_v1(&state)
    .map_err(|error| RuntimeError::invalid_state(format!("encode workspace root lifecycle failed: {error}")))
}

async fn delete_doc_rows(
  transaction: &mut Transaction<'_, Postgres>,
  workspace_id: &str,
  doc_id: &str,
) -> RuntimeResult<()> {
  for statement in [
    "DELETE FROM replies WHERE workspace_id=$1 AND doc_id=$2",
    "DELETE FROM comments WHERE workspace_id=$1 AND doc_id=$2",
    "DELETE FROM updates WHERE workspace_id=$1 AND guid=$2",
    "DELETE FROM snapshot_histories WHERE workspace_id=$1 AND guid=$2",
    "DELETE FROM snapshots WHERE workspace_id=$1 AND guid=$2",
    "DELETE FROM doc_grants WHERE workspace_id=$1 AND doc_id=$2",
    "DELETE FROM doc_access_policies WHERE workspace_id=$1 AND doc_id=$2",
    "DELETE FROM workspace_pages WHERE workspace_id=$1 AND page_id=$2",
  ] {
    sqlx::query(statement)
      .bind(workspace_id)
      .bind(doc_id)
      .execute(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("delete document domain rows", error))?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use std::collections::BTreeSet;

  use super::*;
  use crate::runtime::{Deployment, backend_runtime::permission::PermissionAuthorizer};

  async fn add_test_member(pool: &sqlx::PgPool, workspace_id: &str) -> String {
    let user_id = format!("lifecycle-member-{}", uuid::Uuid::new_v4().simple());
    sqlx::query(
      "INSERT INTO users(id,name,email,registered,email_verified,disabled) VALUES($1,'Member',$2,true,now(),false)",
    )
    .bind(&user_id)
    .bind(format!("{user_id}@example.com"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO workspace_members(workspace_id,user_id,role,state) VALUES($1,$2,'member','active')")
      .bind(workspace_id)
      .bind(&user_id)
      .execute(pool)
      .await
      .unwrap();
    user_id
  }

  fn merge_root(snapshot: &[u8], updates: &[&[u8]]) -> Vec<u8> {
    let mut root = Doc::default();
    root.apply_update_from_binary_v1(snapshot).unwrap();
    for update in updates {
      root.apply_update_from_binary_v1(update).unwrap();
    }
    root.encode_update_v1().unwrap()
  }

  #[test]
  fn lifecycle_mutation_changes_only_target_membership() {
    let snapshot = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "a", None).unwrap();
    let add_b = affine_doc_loader::add_doc_to_root_doc(snapshot.clone(), "b", None).unwrap();
    let snapshot = merge_root(&snapshot, &[&add_b]);
    let trashed = mutate_root(snapshot.clone(), Vec::new(), "a", DocLifecycle::Trash).unwrap();
    let trashed_root = merge_root(&snapshot, &[&trashed]);
    let current = affine_doc_loader::get_doc_ids_from_binary(trashed_root.clone(), false).unwrap();
    assert_eq!(current, vec!["b"]);
    let all = affine_doc_loader::get_doc_ids_from_binary(trashed_root, true).unwrap();
    assert_eq!(BTreeSet::from_iter(all), BTreeSet::from(["a".into(), "b".into()]));
    let restored = mutate_root(snapshot.clone(), vec![trashed.clone()], "a", DocLifecycle::Restore).unwrap();
    let restored_root = merge_root(&snapshot, &[&trashed, &restored]);
    let current = affine_doc_loader::get_doc_ids_from_binary(restored_root, false).unwrap();
    assert_eq!(BTreeSet::from_iter(current), BTreeSet::from(["a".into(), "b".into()]));
    let deleted = mutate_root(snapshot.clone(), Vec::new(), "a", DocLifecycle::Delete).unwrap();
    let deleted_root = merge_root(&snapshot, &[&deleted]);
    assert_eq!(
      affine_doc_loader::get_doc_ids_from_binary(deleted_root, true).unwrap(),
      vec!["b"]
    );
  }

  #[test]
  fn ordinary_root_updates_cannot_encode_lifecycle_effects() {
    let snapshot = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "a", None).unwrap();
    let trash = mutate_root(snapshot.clone(), Vec::new(), "a", DocLifecycle::Trash).unwrap();
    assert!(validate_root_update(snapshot.clone(), Vec::new(), &trash).is_err());

    let restore = mutate_root(snapshot.clone(), vec![trash.clone()], "a", DocLifecycle::Restore).unwrap();
    assert!(validate_root_update(snapshot.clone(), vec![trash], &restore).is_err());

    let delete = mutate_root(snapshot.clone(), Vec::new(), "a", DocLifecycle::Delete).unwrap();
    assert!(validate_root_update(snapshot.clone(), Vec::new(), &delete).is_err());

    let add = affine_doc_loader::add_doc_to_root_doc(snapshot.clone(), "b", None).unwrap();
    assert!(validate_root_update(snapshot, Vec::new(), &add).is_ok());

    let new_doc = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "new-trash", None).unwrap();
    let new_trash = mutate_root(new_doc.clone(), Vec::new(), "new-trash", DocLifecycle::Trash).unwrap();
    let new_trashed_root = merge_root(&new_doc, &[&new_trash]);
    assert!(
      validate_root_update(vec![0, 0], Vec::new(), &new_trashed_root).is_err(),
      "ordinary root initialization cannot create already-trashed documents"
    );
    let existing = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "existing", None).unwrap();
    assert!(
      validate_root_update(existing, Vec::new(), &new_trashed_root).is_err(),
      "ordinary root appends cannot insert already-trashed documents"
    );
  }

  #[test]
  fn ordinary_root_batches_cannot_hide_trash_between_updates() {
    let snapshot = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "a", None).unwrap();
    let trash = mutate_root(snapshot.clone(), Vec::new(), "a", DocLifecycle::Trash).unwrap();
    let restore = mutate_root(snapshot.clone(), vec![trash.clone()], "a", DocLifecycle::Restore).unwrap();
    assert!(
      validate_root_updates(snapshot, Vec::new(), [trash.as_slice(), restore.as_slice()]).is_err(),
      "every update must obey lifecycle authority, not only the final merged state"
    );
  }

  #[tokio::test]
  async fn authenticated_root_appends_cannot_bypass_lifecycle_commands() {
    let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
    let Some((pool, workspace_id, actor_user_id)) = super::super::test_support::owner_workspace().await else {
      return;
    };
    let Some(runtime) = crate::runtime::backend_runtime::tests::runtime_from_database_url()
      .await
      .unwrap()
    else {
      return;
    };
    let doc_id = "root-append-deletion";
    let root = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], doc_id, None).unwrap();
    let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
    let mut transaction = pool.begin().await.unwrap();
    append_root_update(
      &authorizer,
      &mut transaction,
      actor_user_id.clone(),
      workspace_id.clone(),
      BASE64.encode(&root),
      None,
      true,
      None,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    let member_user_id = add_test_member(&pool, &workspace_id).await;
    sqlx::query(
      "INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) VALUES($1,$1,'user',$2,'owner')",
    )
    .bind(&workspace_id)
    .bind(&member_user_id)
    .execute(&pool)
    .await
    .unwrap();
    let trash = mutate_root(root.clone(), Vec::new(), doc_id, DocLifecycle::Trash).unwrap();
    let delete = mutate_root(root.clone(), Vec::new(), doc_id, DocLifecycle::Delete).unwrap();
    for (role, actor_user_id) in [("owner", &actor_user_id), ("member", &member_user_id)] {
      for update in [&trash, &delete] {
        let error = runtime
          .append_workspace_doc_updates_v1(
            crate::runtime::backend_runtime::doc_writer::AppendWorkspaceDocUpdatesInputV1 {
              workspace_id: workspace_id.clone(),
              doc_id: workspace_id.clone(),
              actor_user_id: actor_user_id.to_string(),
              write_intent: crate::runtime::backend_runtime::doc_writer::WorkspaceDocWriteIntentV1::UpdateDoc,
              updates: vec![napi::bindgen_prelude::Buffer::from(update.clone())],
              permission_doc_id: None,
              expected_permission_generation: None,
              database_validation: None,
            },
          )
          .await
          .unwrap_err();
        assert!(
          error.to_string().contains("doc_lifecycle_requires_command"),
          "{role}: {error}"
        );
      }
    }
    assert_eq!(
      sqlx::query_scalar::<_, i64>("SELECT count(*) FROM updates WHERE workspace_id=$1 AND guid=$1")
        .bind(&workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
      0,
      "rejected raw updates must not be persisted"
    );
    // The legacy root command has the same internal metadata-admission proof
    // requirement as ordinary authenticated append, including benign updates.
    let addition = affine_doc_loader::add_doc_to_root_doc(root.clone(), "member-added", None).unwrap();
    for mode in ["missing", "stale", "valid"] {
      let mut transaction = pool.begin().await.unwrap();
      lock_workspace_doc_update(&mut transaction, &workspace_id, &workspace_id)
        .await
        .unwrap();
      let state_hash =
        super::super::super::doc_writer::database_state_hash(&mut transaction, &workspace_id, &workspace_id)
          .await
          .unwrap();
      let proof = match mode {
        "missing" => None,
        _ => Some(super::super::super::doc_writer::DatabaseValidationV1 {
          state_hash: if mode == "stale" {
            "stale".to_string()
          } else {
            state_hash
          },
          expires_at: None,
          history_hash: None,
        }),
      };
      let result = append_root_update(
        &authorizer,
        &mut transaction,
        member_user_id.clone(),
        workspace_id.clone(),
        BASE64.encode(&addition),
        None,
        true,
        proof,
      )
      .await;
      match mode {
        "missing" => assert!(result.unwrap_err().to_string().contains("database_edit_denied")),
        "stale" => assert!(result.unwrap_err().to_string().contains("database_validation_stale")),
        _ => assert!(
          result.is_ok(),
          "validated benign member root metadata updates remain writable"
        ),
      }
      transaction.rollback().await.unwrap();
    }
    runtime
      .append_workspace_doc_updates_trusted_v1(
        crate::runtime::backend_runtime::doc_writer::AppendWorkspaceDocUpdatesTrustedInputV1 {
          workspace_id: workspace_id.clone(),
          doc_id: workspace_id,
          updates: vec![napi::bindgen_prelude::Buffer::from(trash)],
          editor_id: None,
        },
      )
      .await
      .unwrap();
  }

  #[test]
  fn partial_workspace_root_is_rejected_before_semantic_comparison() {
    let snapshot = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "a", None).unwrap();
    let dependent_delta = mutate_root(snapshot.clone(), Vec::new(), "a", DocLifecycle::Trash).unwrap();
    assert!(validate_root_update(vec![0, 0], Vec::new(), &dependent_delta).is_err());
    assert!(
      validate_root_update(dependent_delta, Vec::new(), &snapshot).is_err(),
      "a root update with missing client-clock predecessors must fail closed"
    );
  }

  #[tokio::test]
  async fn lifecycle_commands_restrict_deletion_to_active_workspace_privileged_roles() {
    let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
    let Some((pool, workspace_id, actor_user_id)) = super::super::test_support::owner_workspace().await else {
      return;
    };
    let doc_id = "lifecycle-role-matrix".to_string();
    let root = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], &doc_id, None).unwrap();
    let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
    let mut transaction = pool.begin().await.unwrap();
    append_root_update(
      &authorizer,
      &mut transaction,
      actor_user_id.clone(),
      workspace_id.clone(),
      BASE64.encode(&root),
      None,
      true,
      None,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    sqlx::query(
      "INSERT INTO entitlements(id,target_type,target_id,source,plan,status,quantity) \
       VALUES($1,'workspace',$2,'admin_grant','team','active',10)",
    )
    .bind(format!("lifecycle-entitlement-{workspace_id}"))
    .bind(&workspace_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO doc_access_policies(workspace_id,doc_id,member_default_role) VALUES($1,$2,'none')")
      .bind(&workspace_id)
      .bind(&doc_id)
      .execute(&pool)
      .await
      .unwrap();
    for (role, state, doc_role, allowed) in [
      ("member", "active", "manager", false),
      ("member", "active", "owner", false),
      ("owner", "active", "reader", true),
      ("admin", "active", "reader", true),
      ("owner", "suspended", "owner", false),
      ("admin", "suspended", "owner", false),
      ("owner", "removed", "owner", false),
      ("admin", "removed", "owner", false),
    ] {
      for lifecycle in [DocLifecycle::Trash, DocLifecycle::Delete] {
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query("UPDATE workspace_members SET role=$3,state=$4 WHERE workspace_id=$1 AND user_id=$2")
          .bind(&workspace_id)
          .bind(&actor_user_id)
          .bind(role)
          .bind(state)
          .execute(&mut *transaction)
          .await
          .unwrap();
        sqlx::query(
          "INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) VALUES($1,$2,'user',$3,$4)",
        )
        .bind(&workspace_id)
        .bind(&doc_id)
        .bind(&actor_user_id)
        .bind(doc_role)
        .execute(&mut *transaction)
        .await
        .unwrap();
        let result = apply(
          &authorizer,
          &mut transaction,
          actor_user_id.clone(),
          workspace_id.clone(),
          doc_id.clone(),
          lifecycle,
          true,
        )
        .await;
        assert_eq!(result.is_ok(), allowed, "{role}/{state}/{doc_role}");
        if let Ok(output) = result {
          let update = BASE64.decode(output["rootUpdate"].as_str().unwrap()).unwrap();
          let after = merge_root(&root, &[&update]);
          assert!(
            !project_complete_root(after.clone(), false, "after deletion")
              .unwrap()
              .contains(&doc_id)
          );
          assert_eq!(
            project_complete_root(after, true, "after deletion")
              .unwrap()
              .contains(&doc_id),
            matches!(lifecycle, DocLifecycle::Trash)
          );
        }
        transaction.rollback().await.unwrap();
      }
    }

    // A member who manages the document still has the existing restore permission.
    let trash = mutate_root(root.clone(), Vec::new(), &doc_id, DocLifecycle::Trash).unwrap();
    let trashed_root = merge_root(&root, &[&trash]);
    let member_user_id = add_test_member(&pool, &workspace_id).await;
    let mut transaction = pool.begin().await.unwrap();
    sqlx::query(
      "INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) VALUES($1,$2,'user',$3,'manager')",
    )
    .bind(&workspace_id)
    .bind(&doc_id)
    .bind(&member_user_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query("UPDATE snapshots SET blob=$2,size=$3 WHERE workspace_id=$1 AND guid=$1")
      .bind(&workspace_id)
      .bind(trashed_root.clone())
      .bind(trashed_root.len() as i64)
      .execute(&mut *transaction)
      .await
      .unwrap();
    let restored = apply(
      &authorizer,
      &mut transaction,
      member_user_id,
      workspace_id,
      doc_id.clone(),
      DocLifecycle::Restore,
      true,
    )
    .await
    .unwrap();
    let update = BASE64.decode(restored["rootUpdate"].as_str().unwrap()).unwrap();
    assert!(
      project_complete_root(merge_root(&trashed_root, &[&update]), false, "restored")
        .unwrap()
        .contains(&doc_id)
    );
    transaction.rollback().await.unwrap();
  }

  #[tokio::test]
  async fn readonly_denies_restore_but_allows_trash_and_delete() {
    let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
    let Some((pool, workspace_id, actor_user_id)) = super::super::test_support::owner_workspace().await else {
      return;
    };
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let doc_id = format!("domain-lifecycle-{suffix}");
    let root = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], &doc_id, None).unwrap();
    let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
    let mut transaction = pool.begin().await.unwrap();
    append_root_update(
      &authorizer,
      &mut transaction,
      actor_user_id.clone(),
      workspace_id.clone(),
      BASE64.encode(root),
      None,
      true,
      None,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();

    for index in 0..3 {
      let user_id = format!("domain-lifecycle-overflow-{index}-{suffix}");
      sqlx::query(
        "INSERT INTO users(id,name,email,registered,email_verified,disabled) VALUES($1,'Overflow',$2,true,now(),false)",
      )
      .bind(&user_id)
      .bind(format!("{user_id}@example.com"))
      .execute(&pool)
      .await
      .unwrap();
      sqlx::query("INSERT INTO workspace_members(workspace_id,user_id,role,state) VALUES($1,$2,'member','active')")
        .bind(&workspace_id)
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let mut root_writer = pool.begin().await.unwrap();
    lock_workspace_doc_update(&mut root_writer, &workspace_id, &workspace_id)
      .await
      .unwrap();
    let racing_pool = pool.clone();
    let racing_workspace_id = workspace_id.clone();
    let racing_actor_user_id = actor_user_id.clone();
    let racing_doc_id = doc_id.clone();
    let trash = tokio::spawn(async move {
      let authorizer = PermissionAuthorizer::new(racing_pool.clone(), Deployment::Cloud);
      let mut transaction = racing_pool.begin().await.unwrap();
      apply(
        &authorizer,
        &mut transaction,
        racing_actor_user_id,
        racing_workspace_id,
        racing_doc_id,
        DocLifecycle::Trash,
        true,
      )
      .await
      .unwrap();
      transaction.commit().await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(
      !trash.is_finished(),
      "a lifecycle update must wait for an in-flight workspace root writer"
    );
    root_writer.commit().await.unwrap();
    trash.await.unwrap();

    let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
    let mut transaction = pool.begin().await.unwrap();
    let restore = apply(
      &authorizer,
      &mut transaction,
      actor_user_id.clone(),
      workspace_id.clone(),
      doc_id.clone(),
      DocLifecycle::Restore,
      true,
    )
    .await;
    assert!(restore.is_err());
    transaction.rollback().await.unwrap();

    let mut transaction = pool.begin().await.unwrap();
    apply(
      &authorizer,
      &mut transaction,
      actor_user_id,
      workspace_id.clone(),
      doc_id,
      DocLifecycle::Delete,
      true,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    let timestamps = sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
      "SELECT created_at FROM updates WHERE workspace_id=$1 AND guid=$1 ORDER BY created_at",
    )
    .bind(&workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(timestamps.len(), 2);
    assert!(timestamps[0] < timestamps[1]);
  }
}
