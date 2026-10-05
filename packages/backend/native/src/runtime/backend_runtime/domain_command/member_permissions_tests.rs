use affine_core::access_control::DocAction;
use serde_json::{Value, json};
use sqlx::PgPool;

use super::{DomainCommandInputV1, execute::execute, member_permissions, test_support};
use crate::runtime::{
  Deployment, RuntimeResult,
  backend_runtime::permission::{PermissionAuthorizer, PermissionTelemetry},
};

async fn command(pool: &PgPool, value: Value) -> RuntimeResult<Value> {
  Ok(
    execute(
      pool.clone(),
      Deployment::Cloud,
      PermissionTelemetry::default(),
      true,
      serde_json::from_value::<DomainCommandInputV1>(value).unwrap(),
    )
    .await?
    .value,
  )
}

async fn snapshot(pool: &PgPool, actor: &str, workspace: &str, doc: &str) -> Value {
  command(
    pool,
    json!({"command":"get_doc_member_permissions", "actorUserId":actor,
    "workspaceId":workspace, "docId":doc}),
  )
  .await
  .unwrap()
}

fn replacement(actor: &str, workspace: &str, doc: &str, before: &Value, rules: Value) -> Value {
  json!({"command":"set_doc_member_permissions", "actorUserId":actor,
    "workspaceId":workspace, "docId":doc, "expectedRevision":before["revision"], "rules":rules})
}

async fn member(pool: &PgPool, workspace: &str, role: &str, state: &str) -> String {
  let user = format!("member-rules-{}", uuid::Uuid::new_v4().simple());
  sqlx::query(
    "INSERT INTO users(id,name,email,registered,email_verified,disabled) VALUES($1,'Member Rules',$2,true,now(),false)",
  )
  .bind(&user)
  .bind(format!("{user}@example.com"))
  .execute(pool)
  .await
  .unwrap();
  sqlx::query("INSERT INTO workspace_members(workspace_id,user_id,role,state) VALUES($1,$2,$3,$4)")
    .bind(workspace)
    .bind(&user)
    .bind(role)
    .bind(state)
    .execute(pool)
    .await
    .unwrap();
  user
}

async fn grant(pool: &PgPool, workspace: &str, doc: &str, user: &str, role: &str) {
  sqlx::query(
    "INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) VALUES($1,$2,'user',$3,$4)",
  )
  .bind(workspace)
  .bind(doc)
  .bind(user)
  .bind(role)
  .execute(pool)
  .await
  .unwrap();
}

async fn paid(pool: &PgPool, workspace: &str) {
  sqlx::query(
    "INSERT INTO entitlements(id,target_type,target_id,source,plan,status,starts_at,expires_at) \
    VALUES($1,'workspace',$2,'admin_grant','team','active',now()-interval '1 minute',now()+interval '1 hour')",
  )
  .bind(format!("member-rules-{workspace}"))
  .bind(workspace)
  .execute(pool)
  .await
  .unwrap();
}

async fn document(pool: &PgPool, workspace: &str, doc: &str) {
  sqlx::query("INSERT INTO snapshots(workspace_id,guid,blob,updated_at) VALUES($1,$2,$3,now())")
    .bind(workspace)
    .bind(doc)
    .bind([0_u8, 0_u8])
    .execute(pool)
    .await
    .unwrap();
}

#[test]
fn strict_native_wire_rejects_unknown_fields() {
  let base = json!({"command":"set_doc_member_permissions","actorUserId":"actor","workspaceId":"workspace",
    "docId":"doc","expectedRevision":"0","rules":{"defaultRole":"reader","members":[]}});
  assert!(serde_json::from_value::<DomainCommandInputV1>(base.clone()).is_ok());
  for location in ["command", "rules", "member"] {
    let mut invalid = base.clone();
    match location {
      "command" => invalid["unexpected"] = json!(true),
      "rules" => invalid["rules"]["unexpected"] = json!(true),
      _ => invalid["rules"]["members"] = json!([{"userId":"member","role":"reader","unexpected":true}]),
    }
    assert!(serde_json::from_value::<DomainCommandInputV1>(invalid).is_err());
  }
}

#[tokio::test]
async fn reader_baseline_and_editor_eligibility_use_canonical_facts() {
  let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
  let Some((pool, workspace, owner)) = test_support::owner_workspace().await else {
    return;
  };
  let reader = member(&pool, &workspace, "member", "active").await;
  let admin = member(&pool, &workspace, "admin", "active").await;
  let doc_owner = member(&pool, &workspace, "member", "active").await;
  let doc = "member-rules-reader-doc";
  document(&pool, &workspace, doc).await;
  // Exercise the native missing-policy fallback, independently of physical defaults.
  sqlx::query("DELETE FROM workspace_access_policies WHERE workspace_id=$1")
    .bind(&workspace)
    .execute(&pool)
    .await
    .unwrap();
  let before = snapshot(&pool, &reader, &workspace, doc).await;
  assert_eq!(before["rules"]["defaultRole"], "reader");
  assert_eq!(before["canEdit"], false);
  let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
  let mut transaction = pool.begin().await.unwrap();
  assert!(
    authorizer
      .authorize_doc_action_in(&mut transaction, &workspace, Some(&reader), doc, DocAction::Read)
      .await
      .unwrap()
      .allowed
  );
  assert!(
    !authorizer
      .authorize_doc_action_in(&mut transaction, &workspace, Some(&reader), doc, DocAction::Update)
      .await
      .unwrap()
      .allowed
  );
  transaction.rollback().await.unwrap();
  assert_eq!(snapshot(&pool, &owner, &workspace, doc).await["canEdit"], true);
  assert_eq!(snapshot(&pool, &admin, &workspace, doc).await["canEdit"], true);
  grant(&pool, &workspace, doc, &reader, "manager").await;
  let manager = snapshot(&pool, &reader, &workspace, doc).await;
  assert_eq!(manager["canEdit"], false);
  let error = command(
    &pool,
    replacement(&reader, &workspace, doc, &manager, manager["rules"].clone()),
  )
  .await
  .unwrap_err();
  assert_eq!(error.to_string(), "doc_member_permissions_edit_denied");
  grant(&pool, &workspace, doc, &doc_owner, "owner").await;
  assert_eq!(snapshot(&pool, &doc_owner, &workspace, doc).await["canEdit"], true);
  grant(&pool, &workspace, doc, &admin, "manager").await;
  let admin_before = snapshot(&pool, &admin, &workspace, doc).await;
  command(
    &pool,
    replacement(
      &admin,
      &workspace,
      doc,
      &admin_before,
      json!({"defaultRole":"none","members":[{"userId":reader,"role":"manager"}]}),
    ),
  )
  .await
  .unwrap();
  assert_eq!(snapshot(&pool, &admin, &workspace, doc).await["canEdit"], true);
  // The exemption is local to member rules, not a commercial feature unlock.
  let mut transaction = pool.begin().await.unwrap();
  assert!(
    !authorizer
      .authorize_doc_action_in(&mut transaction, &workspace, Some(&admin), doc, DocAction::Read)
      .await
      .unwrap()
      .allowed
  );
  assert!(
    !authorizer
      .authorize_doc_action_in(&mut transaction, &workspace, Some(&admin), doc, DocAction::UsersManage)
      .await
      .unwrap()
      .allowed
  );
  transaction.rollback().await.unwrap();
  paid(&pool, &workspace).await;
  assert_eq!(snapshot(&pool, &admin, &workspace, doc).await["canEdit"], true);
  let before = snapshot(&pool, &owner, &workspace, doc).await;
  command(
    &pool,
    replacement(
      &owner,
      &workspace,
      doc,
      &before,
      json!({"defaultRole":"none","members":[]}),
    ),
  )
  .await
  .unwrap();
  assert!(
    command(
      &pool,
      json!({"command":"get_doc_member_permissions","actorUserId":reader,"workspaceId":workspace,"docId":doc})
    )
    .await
    .is_err()
  );
}

#[tokio::test]
async fn complete_replacement_preserves_nonmember_group_owner_and_public_policy() {
  let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
  let Some((pool, workspace, owner)) = test_support::owner_workspace().await else {
    return;
  };
  paid(&pool, &workspace).await;
  let doc = "member-rules-complete-doc";
  document(&pool, &workspace, doc).await;
  let active = member(&pool, &workspace, "member", "active").await;
  let inactive = member(&pool, &workspace, "member", "left").await;
  grant(&pool, &workspace, doc, &owner, "owner").await;
  grant(&pool, &workspace, doc, &active, "manager").await;
  grant(&pool, &workspace, doc, &inactive, "commenter").await;
  grant(&pool, &workspace, doc, "external-guest", "editor").await;
  sqlx::query("INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) VALUES($1,$2,'group','group-policy','reader')")
    .bind(&workspace).bind(doc).execute(&pool).await.unwrap();
  sqlx::query("INSERT INTO doc_access_policies(workspace_id,doc_id,visibility,public_role,member_default_role,url_preview_enabled,published_at) \
    VALUES($1,$2,'public','external','manager',true,now())")
    .bind(&workspace).bind(doc).execute(&pool).await.unwrap();
  // More than a usual grant page: the replacement must operate on ALL members.
  for _ in 0..101 {
    let user = member(&pool, &workspace, "member", "active").await;
    grant(&pool, &workspace, doc, &user, "reader").await;
  }
  let before = snapshot(&pool, &owner, &workspace, doc).await;
  assert_eq!(before["rules"]["members"].as_array().unwrap().len(), 102);
  let after = command(
    &pool,
    replacement(
      &owner,
      &workspace,
      doc,
      &before,
      json!({"defaultRole":"reader","members":[{"userId":active,"role":"commenter"}]}),
    ),
  )
  .await
  .unwrap();
  assert_eq!(after["rules"]["members"], json!([{"userId":active,"role":"commenter"}]));
  assert_ne!(after["revision"], before["revision"]);
  let protected: Vec<(String, String, String)> = sqlx::query_as("SELECT principal_type,principal_id,role FROM doc_grants WHERE workspace_id=$1 AND doc_id=$2 AND principal_id<>$3 ORDER BY principal_id")
    .bind(&workspace).bind(doc).bind(&active).fetch_all(&pool).await.unwrap();
  assert_eq!(protected.len(), 4);
  assert!(protected.contains(&("user".into(), owner.clone(), "owner".into())));
  assert!(protected.contains(&("user".into(), inactive, "commenter".into())));
  assert!(protected.contains(&("user".into(), "external-guest".into(), "editor".into())));
  assert!(protected.contains(&("group".into(), "group-policy".into(), "reader".into())));
  let policy: (String, String, bool, bool) = sqlx::query_as("SELECT visibility,public_role,url_preview_enabled,published_at IS NOT NULL FROM doc_access_policies WHERE workspace_id=$1 AND doc_id=$2")
    .bind(&workspace).bind(doc).fetch_one(&pool).await.unwrap();
  assert_eq!(policy, ("public".into(), "external".into(), true, true));
}

#[tokio::test]
async fn stale_validation_and_quota_rejections_do_not_partially_write() {
  let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
  let Some((pool, workspace, owner)) = test_support::owner_workspace().await else {
    return;
  };
  let first = member(&pool, &workspace, "member", "active").await;
  let second = member(&pool, &workspace, "member", "active").await;
  let _overcapacity_member = member(&pool, &workspace, "member", "active").await;
  let doc = "member-rules-atomic-doc";
  document(&pool, &workspace, doc).await;
  grant(&pool, &workspace, doc, &owner, "owner").await;
  grant(&pool, &workspace, doc, &first, "manager").await;
  sqlx::query("INSERT INTO doc_access_policies(workspace_id,doc_id,member_default_role) VALUES($1,$2,'manager')")
    .bind(&workspace)
    .bind(doc)
    .execute(&pool)
    .await
    .unwrap();
  let before = snapshot(&pool, &owner, &workspace, doc).await;
  // An overcapacity cloud workspace permits contractions but rejects expansions.
  let mixed = replacement(
    &owner,
    &workspace,
    doc,
    &before,
    json!({"defaultRole":"reader","members":[{"userId":second,"role":"editor"}]}),
  );
  assert!(command(&pool, mixed).await.is_err());
  assert_eq!(snapshot(&pool, &owner, &workspace, doc).await, before);
  for members in [
    json!([{"userId":"missing","role":"reader"}]),
    json!([{"userId":owner,"role":"reader"}]),
    json!([{"userId":first,"role":"reader"},{"userId":first,"role":"editor"}]),
    json!([{"userId":first,"role":"none"}]),
  ] {
    assert!(
      command(
        &pool,
        replacement(
          &owner,
          &workspace,
          doc,
          &before,
          json!({"defaultRole":"reader","members":members})
        )
      )
      .await
      .is_err()
    );
    assert_eq!(snapshot(&pool, &owner, &workspace, doc).await, before);
  }
  command(
    &pool,
    json!({"command":"transition_doc_role","actorUserId":owner,"workspaceId":workspace,
    "docId":doc,"targetUserId":first,"newRole":"reader"}),
  )
  .await
  .unwrap();
  let changed = snapshot(&pool, &owner, &workspace, doc).await;
  let error = command(
    &pool,
    replacement(
      &owner,
      &workspace,
      doc,
      &before,
      json!({"defaultRole":"none","members":[]}),
    ),
  )
  .await
  .unwrap_err();
  assert_eq!(error.to_string(), "doc_member_permissions_revision_changed");
  assert_eq!(snapshot(&pool, &owner, &workspace, doc).await, changed);
  // The same operation stays within the caller transaction until commit.
  let mut transaction = pool.begin().await.unwrap();
  let authorizer = PermissionAuthorizer::new(pool.clone(), Deployment::Cloud);
  let input = replacement(
    &owner,
    &workspace,
    doc,
    &changed,
    json!({"defaultRole":"none","members":[]}),
  );
  if let DomainCommandInputV1::SetDocMemberPermissions(input) = serde_json::from_value(input).unwrap() {
    member_permissions::set(&authorizer, &mut transaction, input)
      .await
      .unwrap();
  } else {
    panic!("wrong command");
  }
  transaction.rollback().await.unwrap();
  assert_eq!(snapshot(&pool, &owner, &workspace, doc).await, changed);
}

#[tokio::test]
async fn source_boundary_rejects_root_missing_and_deleted_documents() {
  let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
  let Some((pool, workspace, owner)) = test_support::owner_workspace().await else {
    return;
  };
  document(&pool, &workspace, &workspace).await;
  for (doc, message) in [(&*workspace, "doc_is_workspace"), ("missing-doc", "doc_not_found")] {
    let get = json!({"command":"get_doc_member_permissions","actorUserId":owner,"workspaceId":workspace,"docId":doc});
    assert_eq!(command(&pool, get).await.unwrap_err().to_string(), message);
    let set = replacement(
      &owner,
      &workspace,
      doc,
      &json!({"revision":"0"}),
      json!({"defaultRole":"none","members":[]}),
    );
    assert_eq!(command(&pool, set).await.unwrap_err().to_string(), message);
  }
  let missing_rows: i64 = sqlx::query_scalar(
    "SELECT (SELECT count(*) FROM doc_access_policies WHERE workspace_id=$1 AND doc_id='missing-doc') \
     + (SELECT count(*) FROM doc_grants WHERE workspace_id=$1 AND doc_id='missing-doc')",
  )
  .bind(&workspace)
  .fetch_one(&pool)
  .await
  .unwrap();
  assert_eq!(missing_rows, 0);

  // Updates alone are a canonical source; neither metadata nor parsed root Yjs
  // is a prerequisite for configuring an existing ordinary document.
  sqlx::query("INSERT INTO updates(workspace_id,guid,blob,created_at) VALUES($1,'updates-only',$2,now())")
    .bind(&workspace)
    .bind([0_u8, 0_u8])
    .execute(&pool)
    .await
    .unwrap();
  let before = snapshot(&pool, &owner, &workspace, "updates-only").await;
  command(
    &pool,
    replacement(
      &owner,
      &workspace,
      "updates-only",
      &before,
      json!({"defaultRole":"none","members":[]}),
    ),
  )
  .await
  .unwrap();

  let doc = "deleted-document";
  document(&pool, &workspace, doc).await;
  let before = snapshot(&pool, &owner, &workspace, doc).await;
  let mut deletion = pool.begin().await.unwrap();
  super::lock_workspace_storage_shared(&mut deletion, &workspace)
    .await
    .unwrap();
  let mut doc_ids = [&*workspace, doc];
  doc_ids.sort_unstable();
  for id in doc_ids {
    super::lock_workspace_doc_update(&mut deletion, &workspace, id)
      .await
      .unwrap();
  }
  sqlx::query("DELETE FROM snapshots WHERE workspace_id=$1 AND guid=$2")
    .bind(&workspace)
    .bind(doc)
    .execute(&mut *deletion)
    .await
    .unwrap();
  let pending = {
    let pool = pool.clone();
    let set = replacement(
      &owner,
      &workspace,
      doc,
      &before,
      json!({"defaultRole":"none","members":[]}),
    );
    tokio::spawn(async move { command(&pool, set).await })
  };
  tokio::time::sleep(std::time::Duration::from_millis(100)).await;
  assert!(
    !pending.is_finished(),
    "permission write must wait for deletion's source fence"
  );
  deletion.commit().await.unwrap();
  assert_eq!(pending.await.unwrap().unwrap_err().to_string(), "doc_not_found");
  let rows: i64 = sqlx::query_scalar(
    "SELECT (SELECT count(*) FROM doc_access_policies WHERE workspace_id=$1 AND doc_id=$2) \
     + (SELECT count(*) FROM doc_grants WHERE workspace_id=$1 AND doc_id=$2)",
  )
  .bind(&workspace)
  .bind(doc)
  .fetch_one(&pool)
  .await
  .unwrap();
  assert_eq!(rows, 0);
}

#[tokio::test]
async fn member_rules_wait_for_quota_owner_before_locking_workspace_facts() {
  let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
  let Some((pool, workspace, owner)) = test_support::owner_workspace().await else {
    return;
  };
  let doc = "member-rules-lock-order";
  document(&pool, &workspace, doc).await;
  let before = snapshot(&pool, &owner, &workspace, doc).await;
  let mut owner_holder = pool.begin().await.unwrap();
  sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
    .bind(&owner)
    .execute(&mut *owner_holder)
    .await
    .unwrap();
  let pending = {
    let pool = pool.clone();
    let set = replacement(
      &owner,
      &workspace,
      doc,
      &before,
      json!({"defaultRole":"none","members":[]}),
    );
    tokio::spawn(async move { command(&pool, set).await })
  };
  tokio::time::sleep(std::time::Duration::from_millis(100)).await;
  assert!(!pending.is_finished());
  let mut workspace_probe = pool.begin().await.unwrap();
  sqlx::query("SET LOCAL lock_timeout='100ms'")
    .execute(&mut *workspace_probe)
    .await
    .unwrap();
  sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
    .bind(&workspace)
    .execute(&mut *workspace_probe)
    .await
    .unwrap();
  workspace_probe.rollback().await.unwrap();
  owner_holder.commit().await.unwrap();
  assert_eq!(pending.await.unwrap().unwrap()["rules"]["defaultRole"], "none");
}
