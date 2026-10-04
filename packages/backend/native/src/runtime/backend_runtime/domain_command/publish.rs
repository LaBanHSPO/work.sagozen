use affine_core::access_control::DomainCommand;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};

use super::authorize_domain;
use crate::runtime::{RuntimeError, RuntimeResult, backend_runtime::permission::PermissionAuthorizer};

pub(super) async fn set_published(
  authorizer: &PermissionAuthorizer,
  transaction: &mut Transaction<'_, Postgres>,
  actor_user_id: String,
  workspace_id: String,
  doc_id: String,
  mode: i16,
  publish: bool,
) -> RuntimeResult<Value> {
  if workspace_id == doc_id {
    return Err(RuntimeError::invalid_input("doc_is_workspace"));
  }
  let command = if publish {
    DomainCommand::PublishDoc { doc_id: doc_id.clone() }
  } else {
    DomainCommand::UnpublishDoc { doc_id: doc_id.clone() }
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

  // Authorization holds the workspace transaction lock, so concurrent publishes
  // observe the committed visibility before recording another sharing event.
  let was_public = sqlx::query_scalar::<_, bool>(
    "SELECT EXISTS(SELECT 1 FROM doc_access_policies WHERE workspace_id=$1 AND doc_id=$2 AND visibility='public' \
     AND public_role='external')",
  )
  .bind(&workspace_id)
  .bind(&doc_id)
  .fetch_one(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("check public doc transition", error))?;

  if publish {
    let snapshot =
      sqlx::query_scalar::<_, String>("SELECT guid FROM snapshots WHERE workspace_id=$1 AND guid=$2 FOR UPDATE")
        .bind(&workspace_id)
        .bind(&doc_id)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|error| RuntimeError::database("lock published doc snapshot", error))?;
    let updates = sqlx::query_scalar::<_, String>(
      "SELECT guid FROM updates WHERE workspace_id=$1 AND guid=$2 ORDER BY created_at FOR SHARE",
    )
    .bind(&workspace_id)
    .bind(&doc_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|error| RuntimeError::database("lock published doc updates", error))?;
    if snapshot.is_none() && updates.is_empty() {
      return Err(RuntimeError::invalid_input("doc_not_found"));
    }
  } else if !was_public {
    return Err(RuntimeError::invalid_input("doc_is_not_public"));
  }

  sqlx::query(
    r#"INSERT INTO doc_access_policies
         (workspace_id, doc_id, visibility, public_role, published_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $3='public' THEN now() ELSE NULL END)
       ON CONFLICT (workspace_id, doc_id) DO UPDATE SET
         visibility=EXCLUDED.visibility,
         public_role=EXCLUDED.public_role,
         published_at=EXCLUDED.published_at,
         updated_at=now()"#,
  )
  .bind(&workspace_id)
  .bind(&doc_id)
  .bind(if publish { "public" } else { "private" })
  .bind(if publish { Some("external") } else { None::<&str> })
  .execute(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("write public doc policy", error))?;

  let row = sqlx::query(
    r#"INSERT INTO workspace_pages (workspace_id, page_id, mode, published_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END)
       ON CONFLICT (workspace_id, page_id) DO UPDATE SET
         mode=CASE WHEN $4 THEN EXCLUDED.mode ELSE workspace_pages.mode END,
         published_at=EXCLUDED.published_at
       RETURNING mode, published_at"#,
  )
  .bind(&workspace_id)
  .bind(&doc_id)
  .bind(mode)
  .bind(publish)
  .fetch_one(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("write public doc metadata", error))?;

  let notified_user_ids = if publish && !was_public {
    record_public_share(transaction, &actor_user_id, &workspace_id, &doc_id, mode).await?
  } else {
    Vec::new()
  };

  Ok(json!({
    "workspaceId": workspace_id,
    "docId": doc_id,
    "mode": row.try_get::<i16, _>("mode").map_err(|error| RuntimeError::database("decode doc mode", error))?,
    "public": publish,
    "publishedAt": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("published_at").map_err(|error| RuntimeError::database("decode published time", error))?,
    "notifiedUserIds": notified_user_ids,
  }))
}

async fn record_public_share(
  transaction: &mut Transaction<'_, Postgres>,
  actor_user_id: &str,
  workspace_id: &str,
  doc_id: &str,
  mode: i16,
) -> RuntimeResult<Vec<String>> {
  let title =
    sqlx::query_scalar::<_, Option<String>>("SELECT title FROM workspace_pages WHERE workspace_id=$1 AND page_id=$2")
      .bind(workspace_id)
      .bind(doc_id)
      .fetch_one(&mut **transaction)
      .await
      .map_err(|error| RuntimeError::database("load public share title", error))?
      .unwrap_or_default();
  let detail = format!("{} ({doc_id})", if title.is_empty() { "Untitled" } else { &title });
  sqlx::query(
    "INSERT INTO workspace_member_audit_logs(id,workspace_id,actor_user_id,actor_name,actor_email,action,detail) \
     SELECT gen_random_uuid()::text,$1,id,name,email,'doc_published',$3 FROM users WHERE id=$2",
  )
  .bind(workspace_id)
  .bind(actor_user_id)
  .bind(detail)
  .execute(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("record public share activity", error))?;

  let body = json!({
    "workspaceId": workspace_id,
    "createdByUserId": actor_user_id,
    "doc": { "id": doc_id, "title": title, "mode": if mode == 1 { "edgeless" } else { "page" } },
  });
  sqlx::query_scalar::<_, String>(
    r#"INSERT INTO notifications(id,user_id,level,type,body)
       SELECT gen_random_uuid()::text,user_id,'Default','DocPublished',$3
       FROM workspace_members
       WHERE workspace_id=$1 AND state='active' AND role IN ('owner','admin') AND user_id<>$2
       RETURNING user_id"#,
  )
  .bind(workspace_id)
  .bind(actor_user_id)
  .bind(sqlx::types::Json(body))
  .fetch_all(&mut **transaction)
  .await
  .map_err(|error| RuntimeError::database("create public share notifications", error))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::runtime::Deployment;

  #[tokio::test]
  async fn public_share_records_managers_once_per_transition() {
    use super::super::{DomainCommandInputV1, execute::execute};
    use crate::runtime::backend_runtime::permission::PermissionTelemetry;

    let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
    let Some((pool, workspace_id, actor_user_id)) = super::super::test_support::owner_workspace().await else {
      return;
    };
    let admin_id = format!("share-admin-{}", uuid::Uuid::new_v4().simple());
    let member_id = format!("share-member-{}", uuid::Uuid::new_v4().simple());
    let inactive_id = format!("share-inactive-{}", uuid::Uuid::new_v4().simple());
    for (id, role, state) in [
      (&admin_id, "admin", "active"),
      (&member_id, "member", "active"),
      (&inactive_id, "admin", "left"),
    ] {
      sqlx::query("INSERT INTO users(id,name,email,registered,disabled) VALUES($1,'Share User',$2,true,false)")
        .bind(id)
        .bind(format!("{id}@example.com"))
        .execute(&pool)
        .await
        .unwrap();
      sqlx::query("INSERT INTO workspace_members(workspace_id,user_id,role,state) VALUES($1,$2,$3,$4)")
        .bind(&workspace_id)
        .bind(id)
        .bind(role)
        .bind(state)
        .execute(&pool)
        .await
        .unwrap();
    }
    let doc_id = format!("share-doc-{}", uuid::Uuid::new_v4().simple());
    sqlx::query("INSERT INTO snapshots(workspace_id,guid,blob,updated_at) VALUES($1,$2,$3,now())")
      .bind(&workspace_id)
      .bind(&doc_id)
      .bind([0_u8, 0_u8])
      .execute(&pool)
      .await
      .unwrap();
    sqlx::query("INSERT INTO workspace_pages(workspace_id,page_id,title) VALUES($1,$2,'Shared doc')")
      .bind(&workspace_id)
      .bind(&doc_id)
      .execute(&pool)
      .await
      .unwrap();
    let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
    let mut transaction = pool.begin().await.unwrap();
    set_published(
      &authorizer,
      &mut transaction,
      actor_user_id.clone(),
      workspace_id.clone(),
      doc_id.clone(),
      1,
      true,
    )
    .await
    .unwrap();
    transaction.rollback().await.unwrap();
    let count = |table: &'static str| {
      let pool = pool.clone();
      let workspace_id = workspace_id.clone();
      async move {
        let sql = if table == "audit" {
          "SELECT count(*) FROM workspace_member_audit_logs WHERE workspace_id=$1"
        } else {
          "SELECT count(*) FROM notifications WHERE body->>'workspaceId'=$1"
        };
        sqlx::query_scalar::<_, i64>(sql)
          .bind(&workspace_id)
          .fetch_one(&pool)
          .await
          .unwrap()
      }
    };
    assert_eq!(count("audit").await, 0);
    assert_eq!(count("notifications").await, 0);
    let publish = || {
      execute(
        pool.clone(),
        Deployment::Cloud,
        PermissionTelemetry::default(),
        true,
        DomainCommandInputV1::PublishDoc {
          actor_user_id: actor_user_id.clone(),
          workspace_id: workspace_id.clone(),
          doc_id: doc_id.clone(),
          mode: 1,
        },
      )
    };
    let (first, repeated) = tokio::join!(publish(), publish());
    let results = [first.unwrap().value, repeated.unwrap().value];
    assert_eq!(
      results
        .iter()
        .filter(|result| result["notifiedUserIds"] == json!([admin_id]))
        .count(),
      1
    );
    assert_eq!(count("audit").await, 1);
    assert_eq!(count("notifications").await, 1);
    let body: Value = sqlx::query_scalar("SELECT body FROM notifications WHERE user_id=$1")
      .bind(&admin_id)
      .fetch_one(&pool)
      .await
      .unwrap();
    assert_eq!(body["createdByUserId"], actor_user_id);
    assert_eq!(body["doc"], json!({"id":doc_id,"title":"Shared doc","mode":"edgeless"}));
    let audit =
      sqlx::query("SELECT actor_name,actor_email,action,detail FROM workspace_member_audit_logs WHERE workspace_id=$1")
        .bind(&workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit.get::<String, _>("actor_name"), "Domain Owner");
    assert_eq!(audit.get::<String, _>("action"), "doc_published");
    assert_eq!(audit.get::<String, _>("detail"), format!("Shared doc ({doc_id})"));
    assert!(audit.get::<String, _>("actor_email").contains("@example.com"));

    let denied = execute(
      pool.clone(),
      Deployment::Cloud,
      PermissionTelemetry::default(),
      true,
      DomainCommandInputV1::PublishDoc {
        actor_user_id: inactive_id,
        workspace_id: workspace_id.clone(),
        doc_id: doc_id.clone(),
        mode: 0,
      },
    )
    .await;
    assert!(denied.is_err());
    assert_eq!(count("audit").await, 1);
    assert_eq!(count("notifications").await, 1);
    execute(
      pool.clone(),
      Deployment::Cloud,
      PermissionTelemetry::default(),
      true,
      DomainCommandInputV1::UnpublishDoc {
        actor_user_id: actor_user_id.clone(),
        workspace_id: workspace_id.clone(),
        doc_id: doc_id.clone(),
      },
    )
    .await
    .unwrap();
    assert_eq!(count("audit").await, 1);
    // An admin sharing again notifies the owner rather than the admin actor.
    let reshared = execute(
      pool.clone(),
      Deployment::Cloud,
      PermissionTelemetry::default(),
      true,
      DomainCommandInputV1::PublishDoc {
        actor_user_id: admin_id,
        workspace_id: workspace_id.clone(),
        doc_id,
        mode: 0,
      },
    )
    .await
    .unwrap();
    assert_eq!(reshared.value["notifiedUserIds"], json!([actor_user_id]));
    assert_eq!(count("audit").await, 2);
    assert_eq!(count("notifications").await, 2);
  }

  #[tokio::test]
  async fn readonly_denies_publish_but_allows_unpublish() {
    let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
    let Some((pool, workspace_id, actor_user_id)) = super::super::test_support::owner_workspace().await else {
      return;
    };
    let doc_id = format!("domain-doc-{}", uuid::Uuid::new_v4().simple());
    let missing_doc_id = format!("missing-{doc_id}");
    let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
    let mut transaction = pool.begin().await.unwrap();
    assert!(
      set_published(
        &authorizer,
        &mut transaction,
        actor_user_id.clone(),
        workspace_id.clone(),
        missing_doc_id.clone(),
        0,
        true,
      )
      .await
      .is_err()
    );
    transaction.rollback().await.unwrap();
    let ghost_rows = sqlx::query_scalar::<_, i64>(
      "SELECT (SELECT count(*) FROM doc_access_policies WHERE workspace_id=$1 AND doc_id=$2) + (SELECT count(*) FROM \
       workspace_pages WHERE workspace_id=$1 AND page_id=$2)",
    )
    .bind(&workspace_id)
    .bind(&missing_doc_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ghost_rows, 0);
    sqlx::query("INSERT INTO snapshots(workspace_id,guid,blob,updated_at) VALUES($1,$2,$3,now())")
      .bind(&workspace_id)
      .bind(&doc_id)
      .bind([0_u8, 0_u8])
      .execute(&pool)
      .await
      .unwrap();
    let mut overflow_user_ids = Vec::new();
    for index in 0..3 {
      let user_id = format!("domain-publish-overflow-{index}-{}", uuid::Uuid::new_v4().simple());
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
      overflow_user_ids.push(user_id);
    }
    let mut transaction = pool.begin().await.unwrap();
    let denied = set_published(
      &authorizer,
      &mut transaction,
      actor_user_id.clone(),
      workspace_id.clone(),
      doc_id.clone(),
      0,
      true,
    )
    .await;
    assert!(denied.is_err());
    transaction.rollback().await.unwrap();

    sqlx::query("UPDATE workspace_members SET state='left' WHERE workspace_id=$1 AND user_id=$2")
      .bind(&workspace_id)
      .bind(&overflow_user_ids[0])
      .execute(&pool)
      .await
      .unwrap();
    let mut transaction = pool.begin().await.unwrap();
    set_published(
      &authorizer,
      &mut transaction,
      actor_user_id.clone(),
      workspace_id.clone(),
      doc_id.clone(),
      0,
      true,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();

    sqlx::query("UPDATE workspace_members SET state='active' WHERE workspace_id=$1 AND user_id=$2")
      .bind(&workspace_id)
      .bind(&overflow_user_ids[0])
      .execute(&pool)
      .await
      .unwrap();
    let mut transaction = pool.begin().await.unwrap();
    set_published(
      &authorizer,
      &mut transaction,
      actor_user_id,
      workspace_id,
      doc_id,
      0,
      false,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
  }
}
