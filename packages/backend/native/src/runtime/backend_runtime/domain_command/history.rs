use affine_core::access_control::DomainCommand;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Row, Transaction};

use super::{
  authorize_domain, invalidate_doc_blob_projection, lifecycle::validate_root_lifecycle_transition,
  lock_workspace_doc_update,
};
use crate::runtime::backend_runtime::doc_writer::{DatabaseValidationV1, validate_database_proof};
use crate::runtime::{
  RuntimeError, RuntimeResult,
  backend_runtime::permission::{PermissionAuthorizer, active_workspace_owner_or_admin_in},
  storage_runtime::{CurrentDoc, CurrentDocUpdate, merge_current_doc},
};

#[derive(FromRow)]
struct LockedSnapshot {
  blob: Vec<u8>,
  updated_at: DateTime<Utc>,
}

pub(super) async fn recover(
  authorizer: &PermissionAuthorizer,
  transaction: &mut Transaction<'_, Postgres>,
  actor_user_id: String,
  workspace_id: String,
  doc_id: String,
  timestamp: DateTime<Utc>,
  embedding_schema_ready: bool,
  database_validation: Option<DatabaseValidationV1>,
) -> RuntimeResult<Value> {
  let command = DomainCommand::RecoverDoc { doc_id: doc_id.clone() };
  authorize_domain(
    authorizer,
    transaction,
    &actor_user_id,
    &workspace_id,
    Some(&doc_id),
    &command,
  )
  .await?;

  lock_workspace_doc_update(transaction, &workspace_id, &doc_id).await?;

  let snapshot = sqlx::query_as::<_, LockedSnapshot>(
    "SELECT blob, updated_at FROM snapshots WHERE workspace_id=$1 AND guid=$2 FOR UPDATE",
  )
  .bind(&workspace_id)
  .bind(&doc_id)
  .fetch_optional(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("load recovery current snapshot", error))?
  .ok_or_else(|| RuntimeError::invalid_input("doc_not_found"))?;
  let updates = sqlx::query_as::<_, CurrentDocUpdate>(
    "SELECT blob, created_at FROM updates WHERE workspace_id=$1 AND guid=$2 ORDER BY created_at FOR UPDATE",
  )
  .bind(&workspace_id)
  .bind(&doc_id)
  .fetch_all(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("load recovery pending updates", error))?;
  let current = merge_current_doc(
    Some(CurrentDoc {
      blob: snapshot.blob,
      updated_at: snapshot.updated_at,
    }),
    updates,
  )?
  .ok_or_else(|| RuntimeError::invalid_input("doc_not_found"))?;
  let history = sqlx::query(
    "SELECT blob, state, EXTRACT(EPOCH FROM expired_at - timestamp)::bigint AS retention FROM snapshot_histories \
     WHERE workspace_id=$1 AND guid=$2 AND timestamp=$3 FOR UPDATE",
  )
  .bind(&workspace_id)
  .bind(&doc_id)
  .bind(timestamp)
  .fetch_optional(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("load recovery history", error))?
  .ok_or_else(|| RuntimeError::invalid_input("doc_history_not_found"))?;
  let history_blob = history
    .try_get::<Vec<u8>, _>("blob")
    .map_err(|error| RuntimeError::database("decode recovery history blob", error))?;
  if workspace_id == doc_id && !active_workspace_owner_or_admin_in(transaction, &workspace_id, &actor_user_id).await? {
    validate_root_lifecycle_transition(current.blob.clone(), &history_blob)?;
  }
  validate_database_proof(
    transaction,
    &workspace_id,
    &doc_id,
    &actor_user_id,
    database_validation.as_ref(),
    Some(&history_blob),
  )
  .await?;
  invalidate_doc_blob_projection(transaction, &workspace_id, &doc_id, embedding_schema_ready).await?;
  sqlx::query(
    r#"INSERT INTO snapshot_histories
         (workspace_id, guid, timestamp, blob, state, expired_at, created_by)
       VALUES ($1, $2, $3, $4, NULL, clock_timestamp() + make_interval(secs => $5), $6)
       ON CONFLICT (workspace_id, guid, timestamp) DO NOTHING"#,
  )
  .bind(&workspace_id)
  .bind(&doc_id)
  .bind(current.updated_at)
  .bind(current.blob)
  .bind(
    history
      .try_get::<i64, _>("retention")
      .map_err(|error| RuntimeError::database("decode recovery retention", error))?,
  )
  .bind(&actor_user_id)
  .execute(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("record fixed recovery", error))?;
  sqlx::query("DELETE FROM updates WHERE workspace_id=$1 AND guid=$2")
    .bind(&workspace_id)
    .bind(&doc_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| RuntimeError::database("clear recovered pending updates", error))?;
  let recovered = sqlx::query(
    r#"UPDATE snapshots SET blob=$3, state=$4, updated_at=clock_timestamp(), updated_by=$5
       WHERE workspace_id=$1 AND guid=$2
       RETURNING updated_at"#,
  )
  .bind(&workspace_id)
  .bind(&doc_id)
  .bind(history_blob)
  .bind(
    history
      .try_get::<Option<Vec<u8>>, _>("state")
      .map_err(|error| RuntimeError::database("decode recovery history state", error))?,
  )
  .bind(&actor_user_id)
  .fetch_one(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("restore recovery snapshot", error))?;
  Ok(json!({
    "timestamp": timestamp,
    "updatedAt": recovered.try_get::<DateTime<Utc>, _>("updated_at")
      .map_err(|error| RuntimeError::database("decode recovered timestamp", error))?,
  }))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::runtime::Deployment;
  use sha2::Digest;

  #[tokio::test]
  async fn root_recovery_cannot_delete_documents_for_member_document_owners() {
    let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
    let Some((pool, workspace_id, actor_user_id)) = super::super::test_support::owner_workspace().await else {
      return;
    };
    let root = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "kept-document", None).unwrap();
    let timestamp = Utc::now() - chrono::Duration::minutes(10);
    sqlx::query("INSERT INTO snapshots(workspace_id,guid,blob,size,updated_at) VALUES($1,$1,$2,$3,now())")
      .bind(&workspace_id)
      .bind(&root)
      .bind(root.len() as i64)
      .execute(&pool)
      .await
      .unwrap();
    let timestamp = sqlx::query_scalar::<_, DateTime<Utc>>(
      "INSERT INTO snapshot_histories(workspace_id,guid,timestamp,blob,expired_at) \
       VALUES($1,$1,$2,$3,now()+interval '30 days') RETURNING timestamp",
    )
    .bind(&workspace_id)
    .bind(timestamp)
    .bind(vec![0u8, 0])
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
      "INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) VALUES($1,$1,'user',$2,'owner')",
    )
    .bind(&workspace_id)
    .bind(&actor_user_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
      "INSERT INTO entitlements(id,target_type,target_id,source,plan,status) \
       VALUES($1,'workspace',$2,'admin_grant','team','active')",
    )
    .bind(format!("root-recovery-entitlement-{workspace_id}"))
    .bind(&workspace_id)
    .execute(&pool)
    .await
    .unwrap();
    let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
    for (role, allowed) in [("owner", true), ("admin", true), ("member", false)] {
      let mut transaction = pool.begin().await.unwrap();
      sqlx::query("UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2")
        .bind(&workspace_id)
        .bind(&actor_user_id)
        .bind(role)
        .execute(&mut *transaction)
        .await
        .unwrap();
      let recovered = recover(
        &authorizer,
        &mut transaction,
        actor_user_id.clone(),
        workspace_id.clone(),
        workspace_id.clone(),
        timestamp,
        true,
        None,
      )
      .await;
      assert_eq!(recovered.is_ok(), allowed, "{role}");
      if let Err(error) = recovered {
        assert!(error.to_string().contains("doc_lifecycle_requires_command"));
      }
      transaction.rollback().await.unwrap();
    }
  }

  #[tokio::test]
  async fn recovery_archives_current_content_and_restores_target_content() {
    let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
    let Some((pool, workspace_id, actor_user_id)) = super::super::test_support::owner_workspace().await else {
      return;
    };
    let doc_id = format!("domain-history-{}", uuid::Uuid::new_v4().simple());
    let target_timestamp = Utc::now() - chrono::Duration::minutes(10);
    let current_timestamp = Utc::now() - chrono::Duration::minutes(1);
    let current_blob = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "current", None).unwrap();
    let pending_blob = affine_doc_loader::add_doc_to_root_doc(current_blob.clone(), "pending", None).unwrap();
    let target_blob = affine_doc_loader::add_doc_to_root_doc(vec![0, 0], "target", None).unwrap();
    let expected_current = merge_current_doc(
      Some(CurrentDoc {
        blob: current_blob.clone(),
        updated_at: current_timestamp,
      }),
      vec![CurrentDocUpdate {
        blob: pending_blob.clone(),
        created_at: current_timestamp + chrono::Duration::seconds(1),
      }],
    )
    .unwrap()
    .unwrap();
    let current_timestamp = sqlx::query_scalar::<_, DateTime<Utc>>(
      "INSERT INTO snapshots(workspace_id,guid,blob,state,updated_at,created_by,updated_by) \
       VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING updated_at",
    )
    .bind(&workspace_id)
    .bind(&doc_id)
    .bind(&current_blob)
    .bind(b"current-state".as_slice())
    .bind(current_timestamp)
    .bind(&actor_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let pending_timestamp = sqlx::query_scalar::<_, DateTime<Utc>>(
      "INSERT INTO updates(workspace_id,guid,blob,created_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING created_at",
    )
    .bind(&workspace_id)
    .bind(&doc_id)
    .bind(&pending_blob)
    .bind(current_timestamp + chrono::Duration::seconds(1))
    .bind(&actor_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let target_timestamp = sqlx::query_scalar::<_, DateTime<Utc>>(
      "INSERT INTO snapshot_histories(workspace_id,guid,timestamp,blob,state,expired_at,created_by) \
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING timestamp",
    )
    .bind(&workspace_id)
    .bind(&doc_id)
    .bind(target_timestamp)
    .bind(&target_blob)
    .bind(b"target-state".as_slice())
    .bind(target_timestamp + chrono::Duration::days(30))
    .bind(&actor_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
    sqlx::query(
      "INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) \
       VALUES($1,$2,'user',$3,'owner')",
    )
    .bind(&workspace_id)
    .bind(&doc_id)
    .bind(&actor_user_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE workspace_members SET role='member' WHERE workspace_id=$1 AND user_id=$2")
      .bind(&workspace_id)
      .bind(&actor_user_id)
      .execute(&pool)
      .await
      .unwrap();
    let mut proof_transaction = pool.begin().await.unwrap();
    lock_workspace_doc_update(&mut proof_transaction, &workspace_id, &doc_id)
      .await
      .unwrap();
    let state_hash =
      crate::runtime::backend_runtime::doc_writer::database_state_hash(&mut proof_transaction, &workspace_id, &doc_id)
        .await
        .unwrap();
    proof_transaction.rollback().await.unwrap();
    for (proof, code) in [
      (None, "database_edit_denied"),
      (
        Some(DatabaseValidationV1 {
          state_hash: state_hash.clone(),
          expires_at: None,
          history_hash: None,
        }),
        "database_edit_denied",
      ),
      (
        Some(DatabaseValidationV1 {
          state_hash: state_hash.clone(),
          expires_at: None,
          history_hash: Some("changed".to_string()),
        }),
        "database_validation_stale",
      ),
      (
        Some(DatabaseValidationV1 {
          state_hash: "changed".to_string(),
          expires_at: None,
          history_hash: Some(hex::encode(sha2::Sha256::digest(&target_blob))),
        }),
        "database_validation_stale",
      ),
    ] {
      let mut rejected = pool.begin().await.unwrap();
      let error = recover(
        &authorizer,
        &mut rejected,
        actor_user_id.clone(),
        workspace_id.clone(),
        doc_id.clone(),
        target_timestamp,
        true,
        proof,
      )
      .await
      .unwrap_err();
      assert_eq!(error.to_string(), code);
      rejected.rollback().await.unwrap();
    }
    assert_eq!(
      sqlx::query_scalar::<_, Vec<u8>>("SELECT blob FROM snapshots WHERE workspace_id=$1 AND guid=$2")
        .bind(&workspace_id)
        .bind(&doc_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
      current_blob,
    );
    assert_eq!(
      sqlx::query_scalar::<_, i64>("SELECT count(*) FROM updates WHERE workspace_id=$1 AND guid=$2")
        .bind(&workspace_id)
        .bind(&doc_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
      1,
    );
    sqlx::query("UPDATE workspace_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2")
      .bind(&workspace_id)
      .bind(&actor_user_id)
      .execute(&pool)
      .await
      .unwrap();
    let mut transaction = pool.begin().await.unwrap();
    recover(
      &authorizer,
      &mut transaction,
      actor_user_id,
      workspace_id.clone(),
      doc_id.clone(),
      target_timestamp,
      true,
      None,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();

    let restored = sqlx::query("SELECT blob,state,updated_at FROM snapshots WHERE workspace_id=$1 AND guid=$2")
      .bind(&workspace_id)
      .bind(&doc_id)
      .fetch_one(&pool)
      .await
      .unwrap();
    assert_eq!(restored.get::<Vec<u8>, _>("blob"), target_blob);
    assert_eq!(restored.get::<Vec<u8>, _>("state"), b"target-state");
    assert!(restored.get::<DateTime<Utc>, _>("updated_at") > current_timestamp);
    let pending_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM updates WHERE workspace_id=$1 AND guid=$2")
      .bind(&workspace_id)
      .bind(&doc_id)
      .fetch_one(&pool)
      .await
      .unwrap();
    assert_eq!(pending_count, 0);
    let archived = sqlx::query_scalar::<_, Vec<u8>>(
      "SELECT blob FROM snapshot_histories WHERE workspace_id=$1 AND guid=$2 AND timestamp=$3",
    )
    .bind(&workspace_id)
    .bind(&doc_id)
    .bind(pending_timestamp)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(archived, expected_current.blob);
  }
}
