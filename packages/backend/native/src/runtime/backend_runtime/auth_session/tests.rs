use std::sync::Arc;

use argon2::{
  Argon2, PasswordHasher,
  password_hash::{PasswordVerifier, phc::PasswordHash},
};
use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use zeroize::Zeroizing;

use super::{
  cookie, issuance, keyring, login, mail, oauth, oauth_http, principal, security, security_challenge, session,
  types::{PrincipalInput, SessionIssueInput},
};
use crate::runtime::{
  AuthRuntimeConfig, BackendRuntimeConfig, Deployment, InviteQuotaConfig, OAuthProviderRuntimeConfig,
  PaymentRuntimeConfig, RedisRuntimeConfig,
  config::{CopilotRuntimeConfig, SearchRuntimeConfig},
};

async fn pool() -> Option<PgPool> {
  let database_url = std::env::var("DATABASE_URL").ok()?;
  Some(
    PgPoolOptions::new()
      .max_connections(8)
      .connect(&database_url)
      .await
      .unwrap(),
  )
}

fn config(database_url: String) -> BackendRuntimeConfig {
  BackendRuntimeConfig {
    database_url,
    auth: AuthRuntimeConfig::default(),
    invite_quota: InviteQuotaConfig::default(),
    private_key: Arc::new(Zeroizing::new("rfc12-auth-test-private-key".to_string())),
    deployment: Deployment::Cloud,
    copilot: CopilotRuntimeConfig::default(),
    search: SearchRuntimeConfig::default(),
    redis: RedisRuntimeConfig::default(),
    payment: PaymentRuntimeConfig::default(),
  }
}

async fn create_user(pool: &PgPool, marker: &str) -> String {
  let id = uuid::Uuid::new_v4().to_string();
  sqlx::query(
    "INSERT INTO users(id,name,email,password,registered,disabled,auth_epoch) VALUES($1,'Auth \
     test',$2,'hash',true,false,0)",
  )
  .bind(&id)
  .bind(format!("auth-{marker}@example.invalid"))
  .execute(pool)
  .await
  .unwrap();
  id
}

struct LegacyDeviceSession {
  id: String,
  user_session_id: String,
  refresh_token_id: String,
  access_token: String,
}

async fn create_legacy_device_session(
  pool: &PgPool,
  config: &BackendRuntimeConfig,
  user_id: &str,
  marker: &str,
) -> LegacyDeviceSession {
  let mut tx = pool.begin().await.unwrap();
  let now = session::decision_time(&mut tx).await.unwrap();
  let cookie_session_id = uuid::Uuid::new_v4().to_string();
  let user_session_id = uuid::Uuid::new_v4().to_string();
  let id = uuid::Uuid::new_v4().to_string();
  let refresh_token_id = uuid::Uuid::new_v4().to_string();
  let expires_at = now + chrono::Duration::days(1);
  sqlx::query("INSERT INTO multiple_users_sessions(id,created_at) VALUES($1,$2)")
    .bind(&cookie_session_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .unwrap();
  sqlx::query(
    "INSERT INTO user_sessions(id,session_id,user_id,expires_at,created_at) VALUES($1,$2,$3,$4,$5)",
  )
  .bind(&user_session_id)
  .bind(&cookie_session_id)
  .bind(user_id)
  .bind(expires_at)
  .bind(now)
  .execute(&mut *tx)
  .await
  .unwrap();
  sqlx::query(
    r#"INSERT INTO auth_sessions(
         id,user_session_id,installation_id,platform,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
       VALUES($1,$2,$3,'ios',$4,$4,$5,$5)"#,
  )
  .bind(&id)
  .bind(&user_session_id)
  .bind(format!("legacy-{marker}"))
  .bind(now)
  .bind(expires_at)
  .execute(&mut *tx)
  .await
  .unwrap();
  sqlx::query(
    "INSERT INTO auth_refresh_tokens(id,auth_session_id,generation,secret_hash,created_at,expires_at) \
     VALUES($1,$2,0,$3,$4,$5)",
  )
  .bind(&refresh_token_id)
  .bind(&id)
  .bind("0".repeat(64))
  .bind(now)
  .bind(expires_at)
  .execute(&mut *tx)
  .await
  .unwrap();
  let key = keyring::active(&mut tx, config).await.unwrap();
  let access_token = crate::auth_session::sign_auth_session_access_token(
    user_id,
    &id,
    &key.id,
    &key.secret,
    now.timestamp(),
    (now + chrono::Duration::seconds(config.auth.access_token_ttl_seconds)).timestamp(),
  )
  .unwrap();
  tx.commit().await.unwrap();
  LegacyDeviceSession {
    id,
    user_session_id,
    refresh_token_id,
    access_token,
  }
}

async fn oidc_server(nonce: Arc<tokio::sync::Mutex<String>>) -> String {
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
  let address = listener.local_addr().unwrap();
  let issuer = format!("http://{address}");
  let server_issuer = issuer.clone();
  tokio::spawn(async move {
    loop {
      let (mut stream, _) = listener.accept().await.unwrap();
      let mut request = vec![0_u8; 16 * 1024];
      let read = tokio::io::AsyncReadExt::read(&mut stream, &mut request).await.unwrap();
      let request = String::from_utf8_lossy(&request[..read]);
      let path = request
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap();
      if path == "/redirect" {
        tokio::io::AsyncWriteExt::write_all(
          &mut stream,
          b"HTTP/1.1 302 Found\r\nLocation: /userinfo\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )
        .await
        .unwrap();
        continue;
      }
      let body = match path {
        "/.well-known/openid-configuration" => json!({
          "authorization_endpoint": format!("{server_issuer}/authorize"),
          "token_endpoint": format!("{server_issuer}/token"),
          "userinfo_endpoint": format!("{server_issuer}/userinfo"),
          "issuer": server_issuer,
          "jwks_uri": format!("{server_issuer}/jwks"),
        }),
        "/token" => {
          let claims = json!({
            "iss": server_issuer,
            "aud": "oidc-client",
            "sub": "oidc-subject",
            "email": "oidc@example.invalid",
            "email_verified": true,
            "nonce": nonce.lock().await.clone(),
            "exp": chrono::Utc::now().timestamp() + 300,
          });
          let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256);
          header.kid = Some("oidc-test".to_string());
          let token = jsonwebtoken::encode(
            &header,
            &claims,
            &jsonwebtoken::EncodingKey::from_ec_pem(crate::entitlement::tests::TEST_PRIVATE_KEY.as_bytes()).unwrap(),
          )
          .unwrap();
          json!({ "access_token": "access", "id_token": token })
        }
        "/jwks" => json!({ "keys": [{
          "kty": "EC", "crv": "P-256", "use": "sig", "alg": "ES256", "kid": "oidc-test",
          "x": "ObwJiTmbui7rkWfPJ7Lozvuy2Rclotcrb0V6dlS2ijI",
          "y": "hEoZu2bbU8EJ9PMc3rHY1_wMaaEeV_cn6B5GriAbrjE"
        }] }),
        "/userinfo" => json!({
          "sub": "oidc-subject", "email": "oidc@example.invalid", "email_verified": true, "name": "OIDC User"
        }),
        _ => json!({}),
      };
      let body = serde_json::to_vec(&body).unwrap();
      let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
      );
      tokio::io::AsyncWriteExt::write_all(&mut stream, response.as_bytes())
        .await
        .unwrap();
      tokio::io::AsyncWriteExt::write_all(&mut stream, &body).await.unwrap();
    }
  });
  issuer
}

#[test]
fn argon2_upgrade_verifies_existing_hashes() {
  let existing = "$argon2id$v=19$m=19456,t=2,p=1$/JC3Ue87NEBXtjra7TY9TQ$oysAbNozbP/Z6kdbyPXYDRcZFr4WJlFEHhx+88QRjoc";
  let parsed = PasswordHash::new(existing).unwrap();
  assert!(Argon2::default().verify_password(b"p4-password", &parsed).is_ok());

  let generated = Argon2::default().hash_password(b"replacement-password").unwrap();
  assert!(generated.to_string().starts_with("$argon2id$v=19$m=19456,t=2,p=1$"));
  assert!(
    Argon2::default()
      .verify_password(b"replacement-password", &generated)
      .is_ok()
  );
}

#[test]
fn auth_command_contract_accepts_cookie_issuance_only() {
  let command = json!({
    "action": "password_login",
    "email": "browser@example.invalid",
    "password": "password",
    "issue": { "type": "cookie" }
  });
  assert!(serde_json::from_value::<super::types::AuthSessionCommand>(command.clone()).is_ok());
  let mut native_command = command;
  native_command["issue"] = json!({ "type": "native" });
  assert!(serde_json::from_value::<super::types::AuthSessionCommand>(native_command).is_err());
  for action in ["exchange", "refresh", "revoke_refresh", "create_open_app_code", "complete_open_app"] {
    assert!(
      serde_json::from_value::<super::types::AuthSessionCommand>(json!({
        "action": action,
        "code": "legacy-code",
        "installationId": "legacy-installation",
        "platform": "ios",
        "refreshToken": "legacy-token",
        "userId": "user-id",
        "issue": { "type": "cookie" }
      }))
      .is_err()
    );
  }
}

#[tokio::test]
async fn browser_session_kernel_preserves_login_security_and_legacy_device_revocation() {
  let _guard = crate::runtime::migrations::DATABASE_TEST_LOCK.lock().await;
  let Some(pool) = pool().await else {
    return;
  };
  crate::runtime::migrations::migrate_runtime_tables(&pool).await.unwrap();
  let marker = uuid::Uuid::new_v4().simple().to_string();
  let user_id = create_user(&pool, &marker).await;
  let mut config = config(std::env::var("DATABASE_URL").unwrap());
  config.auth.oauth.providers.insert(
    "google".to_string(),
    OAuthProviderRuntimeConfig {
      client_id: "google-client-id".to_string(),
      client_secret: Arc::new(Zeroizing::new("google-client-secret".to_string())),
      args: Default::default(),
      issuer: None,
      allow_private_network: false,
      apple_private_key: None,
      apple_key_id: None,
      apple_team_id: None,
    },
  );
  config.auth.oauth.providers.insert(
    "apple".to_string(),
    OAuthProviderRuntimeConfig {
      client_id: "apple-client-id".to_string(),
      client_secret: Arc::new(Zeroizing::new("apple-client-secret".to_string())),
      args: Default::default(),
      issuer: None,
      allow_private_network: false,
      apple_private_key: None,
      apple_key_id: None,
      apple_team_id: None,
    },
  );
  let oidc_nonce = Arc::new(tokio::sync::Mutex::new(String::new()));
  let oidc_issuer = oidc_server(oidc_nonce.clone()).await;
  assert!(
    oauth_http::OAuthHttp::oidc(Some(&oidc_issuer))
      .get_json::<serde_json::Value>(&format!("{oidc_issuer}/redirect"), Some("sensitive-token"))
      .await
      .is_err()
  );
  config.auth.oauth.providers.insert(
    "oidc".to_string(),
    OAuthProviderRuntimeConfig {
      client_id: "oidc-client".to_string(),
      client_secret: Arc::new(Zeroizing::new("oidc-secret".to_string())),
      args: Default::default(),
      issuer: Some(oidc_issuer),
      allow_private_network: true,
      apple_private_key: None,
      apple_key_id: None,
      apple_team_id: None,
    },
  );
  keyring::initialize(&pool, &config).await.unwrap();
  sqlx::query("UPDATE users SET password=$2 WHERE id=$1")
    .bind(&user_id)
    .bind("$argon2id$v=19$m=19456,t=2,p=1$/JC3Ue87NEBXtjra7TY9TQ$oysAbNozbP/Z6kdbyPXYDRcZFr4WJlFEHhx+88QRjoc")
    .execute(&pool)
    .await
    .unwrap();
  assert!(
    login::password(
      &pool,
      &config,
      &format!("AUTH-{marker}@EXAMPLE.INVALID"),
      "wrong",
      SessionIssueInput::Cookie {
        session_id: None,
        client_version: None,
      },
    )
    .await
    .is_err()
  );
  let password_login = login::password(
    &pool,
    &config,
    &format!("AUTH-{marker}@EXAMPLE.INVALID"),
    "p4-password",
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: Some("password-client".to_string()),
    },
  )
  .await
  .unwrap();
  assert!(!password_login.session_id.is_empty());
  assert!(password_login.session_expires_at > chrono::Utc::now());
  assert_eq!(password_login.user.id, user_id);
  let password_result = serde_json::to_value(&password_login).unwrap();
  assert!(password_result["sessionId"].is_string());
  assert!(password_result["sessionExpiresAt"].is_string());
  assert!(password_result.get("exchangeCode").is_none());

  let magic_email = format!("magic-{marker}@example.invalid");
  let auth_source = mail::AuthRequestSource {
    trusted: true,
    ip: Some("203.0.113.77".to_string()),
    asn: None,
  };
  login::prepare_magic_link(
    &pool,
    &config,
    &magic_email,
    "https://app.affine.pro/magic-link?redirect_uri=https%3A%2F%2Fapp.affine.pro%2Fworkspace",
    Some("magic-nonce"),
    "AFFiNE Cloud",
    Some(&auth_source),
  )
  .await
  .unwrap();
  let (quota_decision, source_scope): (serde_json::Value, String) = sqlx::query_as(
    r#"SELECT d.quota_decision,c.scope_key FROM mail_deliveries d
       JOIN runtime_rolling_quota_counters c ON c.scope_key LIKE 'mail:source_prefix:%:class:auth'
       WHERE d.recipient_email=$1 ORDER BY c.updated_at DESC LIMIT 1"#,
  )
  .bind(&magic_email)
  .fetch_one(&pool)
  .await
  .unwrap();
  assert_eq!(quota_decision["allowed"], true);
  sqlx::query("UPDATE runtime_rolling_quota_counters SET count=50 WHERE scope_key=$1")
    .bind(&source_scope)
    .execute(&pool)
    .await
    .unwrap();
  let blocked_email = format!("blocked-{marker}@example.invalid");
  assert!(
    login::prepare_magic_link(
      &pool,
      &config,
      &blocked_email,
      "https://app.affine.pro/magic-link",
      None,
      "AFFiNE Cloud",
      Some(&auth_source),
    )
    .await
    .is_err()
  );
  let blocked_state: i64 = sqlx::query_scalar("SELECT count(*) FROM runtime_states WHERE purpose=$1 AND lookup_key=$2")
    .bind(login::MAGIC_PURPOSE)
    .bind(&blocked_email)
    .fetch_one(&pool)
    .await
    .unwrap();
  assert_eq!(blocked_state, 0);
  sqlx::query("DELETE FROM runtime_rolling_quota_counters WHERE scope_key=$1")
    .bind(source_scope)
    .execute(&pool)
    .await
    .unwrap();
  let magic_payload: serde_json::Value = sqlx::query_scalar(
    "SELECT payload FROM mail_deliveries WHERE dedupe_key LIKE 'auth:magic-link:%' AND recipient_email=$1 ORDER BY \
     created_at DESC LIMIT 1",
  )
  .bind(&magic_email)
  .fetch_one(&pool)
  .await
  .unwrap();
  let magic_otp = magic_payload["props"]["otp"].as_str().unwrap().to_string();
  assert!(
    login::complete_magic_link(
      &pool,
      &config,
      &magic_email,
      "000000",
      Some("magic-nonce"),
      SessionIssueInput::Cookie {
        session_id: None,
        client_version: None,
      },
    )
    .await
    .is_err()
  );
  config.auth.allow_signup = false;
  assert!(
    login::complete_magic_link(
      &pool,
      &config,
      &magic_email,
      &magic_otp,
      Some("magic-nonce"),
      SessionIssueInput::Cookie {
        session_id: None,
        client_version: None,
      },
    )
    .await
    .is_err()
  );
  config.auth.allow_signup = true;
  let magic_login = login::complete_magic_link(
    &pool,
    &config,
    &magic_email,
    &magic_otp,
    Some("magic-nonce"),
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: Some("magic-client".to_string()),
    },
  )
  .await
  .unwrap();
  assert_eq!(magic_login.created, Some(true));
  assert!(!magic_login.session_id.is_empty());
  assert!(magic_login.session_expires_at > chrono::Utc::now());
  assert!(
    login::complete_magic_link(
      &pool,
      &config,
      &magic_email,
      &magic_otp,
      Some("magic-nonce"),
      SessionIssueInput::Cookie {
        session_id: None,
        client_version: None,
      },
    )
    .await
    .is_err()
  );
  config.auth.allow_signup = false;
  config.auth.require_email_domain_verification = true;
  login::prepare_magic_link(
    &pool,
    &config,
    &magic_email,
    "https://app.affine.pro/magic-link",
    Some("existing-magic-nonce"),
    "AFFiNE Cloud",
    None,
  )
  .await
  .unwrap();
  let existing_magic_payload: serde_json::Value = sqlx::query_scalar(
    "SELECT payload FROM mail_deliveries WHERE dedupe_key LIKE 'auth:magic-link:%' AND recipient_email=$1 ORDER BY \
     created_at DESC LIMIT 1",
  )
  .bind(&magic_email)
  .fetch_one(&pool)
  .await
  .unwrap();
  let existing_magic_otp = existing_magic_payload["props"]["otp"].as_str().unwrap();
  let existing_magic_login = login::complete_magic_link(
    &pool,
    &config,
    &magic_email,
    existing_magic_otp,
    Some("existing-magic-nonce"),
    SessionIssueInput::Cookie {
      session_id: Some(magic_login.session_id.clone()),
      client_version: None,
    },
  )
  .await
  .unwrap();
  assert_eq!(existing_magic_login.created, Some(false));
  assert_eq!(existing_magic_login.session_id, magic_login.session_id);
  let preserved_client_version: Option<String> =
    sqlx::query_scalar("SELECT sign_in_client_version FROM user_sessions WHERE session_id=$1 AND user_id=$2")
      .bind(&magic_login.session_id)
      .bind(&magic_login.user.id)
      .fetch_one(&pool)
      .await
      .unwrap();
  assert_eq!(preserved_client_version.as_deref(), Some("magic-client"));
  let magic_session_count: i64 =
    sqlx::query_scalar("SELECT count(*) FROM user_sessions WHERE session_id=$1 AND user_id=$2")
      .bind(&magic_login.session_id)
      .bind(&magic_login.user.id)
      .fetch_one(&pool)
      .await
      .unwrap();
  assert_eq!(magic_session_count, 1);
  config.auth.allow_signup = true;
  config.auth.require_email_domain_verification = false;
  let revoked_device = create_legacy_device_session(&pool, &config, &user_id, &marker).await;
  let valid_device = principal::resolve(
    &pool,
    &config,
    PrincipalInput::AccessToken {
      token: revoked_device.access_token.clone(),
    },
  )
  .await
  .unwrap();
  assert_eq!(serde_json::to_value(valid_device).unwrap()["status"], "valid");
  assert!(!session::revoke(&pool, &revoked_device.id, Some("wrong-owner"), "sign_out").await.unwrap());
  assert!(session::revoke(&pool, &revoked_device.id, Some(&user_id), "sign_out").await.unwrap());
  let revoked_refresh: bool =
    sqlx::query_scalar("SELECT revoked_at IS NOT NULL FROM auth_refresh_tokens WHERE id=$1")
      .bind(&revoked_device.refresh_token_id)
      .fetch_one(&pool)
      .await
      .unwrap();
  assert!(revoked_refresh);
  let revoked_principal = principal::resolve(
    &pool,
    &config,
    PrincipalInput::AccessToken {
      token: revoked_device.access_token,
    },
  )
  .await
  .unwrap();
  assert_eq!(serde_json::to_value(revoked_principal).unwrap()["status"], "auth_session_revoked");
  let second_session = create_legacy_device_session(&pool, &config, &user_id, &format!("{marker}-second")).await;
  assert!(session::list(&pool, &user_id).await.unwrap().iter().any(|item| item.id == second_session.id));

  let before_keys = keyring::metadata(&pool, &config).await.unwrap();
  let before_keys = serde_json::to_value(&before_keys).unwrap();
  let old_key = before_keys
    .as_array()
    .unwrap()
    .iter()
    .find(|key| key["status"] == "active")
    .unwrap()["id"]
    .as_str()
    .unwrap()
    .to_string();
  keyring::rotate(&pool, &config, &user_id, &old_key).await.unwrap();
  let stored_after_rotation: serde_json::Value =
    sqlx::query_scalar("SELECT value FROM app_configs WHERE id='auth.session.signingKeys'")
      .fetch_one(&pool)
      .await
      .unwrap();
  let active = stored_after_rotation
    .as_array()
    .unwrap()
    .iter()
    .find(|key| key["status"] == "active")
    .unwrap()
    .as_object()
    .unwrap();
  assert!(!active.contains_key("retiredAt"));
  assert!(!active.contains_key("verifyUntil"));
  let old_access = &second_session.access_token;
  let old_principal = principal::resolve(
    &pool,
    &config,
    PrincipalInput::AccessToken {
      token: old_access.to_string(),
    },
  )
  .await
  .unwrap();
  assert_eq!(serde_json::to_value(old_principal).unwrap()["status"], "valid");
  let mut expiring_keys: serde_json::Value =
    sqlx::query_scalar("SELECT value FROM app_configs WHERE id='auth.session.signingKeys'")
      .fetch_one(&pool)
      .await
      .unwrap();
  let old = expiring_keys
    .as_array_mut()
    .unwrap()
    .iter_mut()
    .find(|key| key["id"] == old_key)
    .unwrap();
  let short_retired_at = chrono::Utc::now() - chrono::Duration::seconds(2);
  old["retiredAt"] = serde_json::Value::String(short_retired_at.to_rfc3339());
  old["verifyUntil"] = serde_json::Value::String((short_retired_at + chrono::Duration::seconds(1)).to_rfc3339());
  sqlx::query("UPDATE app_configs SET value=$1 WHERE id='auth.session.signingKeys'")
    .bind(&expiring_keys)
    .execute(&pool)
    .await
    .unwrap();
  assert!(keyring::metadata(&pool, &config).await.is_err());
  let old = expiring_keys
    .as_array_mut()
    .unwrap()
    .iter_mut()
    .find(|key| key["id"] == old_key)
    .unwrap();
  old["retiredAt"] = serde_json::Value::String(
    (chrono::Utc::now() - chrono::Duration::seconds(config.auth.access_token_ttl_seconds + 32)).to_rfc3339(),
  );
  old["verifyUntil"] = serde_json::Value::String((chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339());
  sqlx::query("UPDATE app_configs SET value=$1 WHERE id='auth.session.signingKeys'")
    .bind(expiring_keys)
    .execute(&pool)
    .await
    .unwrap();
  let after_delete = keyring::delete(&pool, &config, &user_id, &old_key).await.unwrap();
  assert!(
    !serde_json::to_value(after_delete)
      .unwrap()
      .as_array()
      .unwrap()
      .iter()
      .any(|key| key["id"] == old_key)
  );

  let second_user_id = create_user(&pool, &format!("{marker}-cookie")).await;
  let shared_login = issuance::issue_existing(
    &pool,
    &config,
    &user_id,
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: Some("browser-version".to_string()),
    },
  )
  .await
  .unwrap();
  let shared_session_id = shared_login.session_id;
  let second_login = issuance::issue_existing(
    &pool,
    &config,
    &second_user_id,
    SessionIssueInput::Cookie {
      session_id: Some(shared_session_id.clone()),
      client_version: None,
    },
  )
  .await
  .unwrap();
  assert_eq!(second_login.session_id, shared_session_id);
  assert_eq!(cookie::users(&pool, &shared_session_id).await.unwrap().len(), 2);
  let selected = principal::resolve(
    &pool,
    &config,
    PrincipalInput::Cookie {
      session_id: shared_session_id.clone(),
      user_id: Some(user_id.clone()),
      refresh_client_version: None,
      refresh: false,
    },
  )
  .await
  .unwrap();
  assert_eq!(serde_json::to_value(selected).unwrap()["principal"]["userId"], user_id);
  let fallback = principal::resolve(
    &pool,
    &config,
    PrincipalInput::Cookie {
      session_id: shared_session_id.clone(),
      user_id: Some("missing-user".to_string()),
      refresh_client_version: None,
      refresh: false,
    },
  )
  .await
  .unwrap();
  assert_eq!(
    serde_json::to_value(fallback).unwrap()["principal"]["userId"],
    second_user_id
  );
  sqlx::query("UPDATE user_sessions SET expires_at=NULL WHERE session_id=$1 AND user_id=$2")
    .bind(&shared_session_id)
    .bind(&second_user_id)
    .execute(&pool)
    .await
    .unwrap();
  let refreshed = principal::resolve(
    &pool,
    &config,
    PrincipalInput::Cookie {
      session_id: shared_session_id.clone(),
      user_id: Some(second_user_id.clone()),
      refresh_client_version: Some("browser-refreshed".to_string()),
      refresh: true,
    },
  )
  .await
  .unwrap();
  let refreshed = serde_json::to_value(refreshed).unwrap();
  assert_eq!(refreshed["status"], "valid");
  assert_eq!(refreshed["principal"]["refreshClientVersion"], "browser-refreshed");
  assert!(refreshed["refreshedExpiresAt"].is_string());
  assert_eq!(cookie::sign_out(&pool, &shared_session_id, Some(&second_user_id)).await.unwrap(), 1);
  let signed_in_users = cookie::users(&pool, &shared_session_id).await.unwrap();
  assert_eq!(signed_in_users.len(), 1);
  assert_eq!(signed_in_users[0].id, user_id);
  let signed_out_login = issuance::issue_existing(
    &pool,
    &config,
    &second_user_id,
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: None,
    },
  )
  .await
  .unwrap();
  assert_eq!(cookie::sign_out(&pool, &signed_out_login.session_id, None).await.unwrap(), 1);
  assert!(cookie::users(&pool, &signed_out_login.session_id).await.unwrap().is_empty());
  let mut rollback_tx = pool.begin().await.unwrap();
  session::lock_user(&mut rollback_tx, &second_user_id).await.unwrap();
  let now = session::decision_time(&mut rollback_tx).await.unwrap();
  let rollback_login = issuance::issue(
    &mut rollback_tx,
    &config,
    &second_user_id,
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: None,
    },
    now,
    None,
  )
  .await
  .unwrap();
  rollback_tx.rollback().await.unwrap();
  let rolled_back_cookie: i64 =
    sqlx::query_scalar("SELECT count(*) FROM multiple_users_sessions WHERE id=$1")
      .bind(&rollback_login.session_id)
      .fetch_one(&pool)
      .await
      .unwrap();
  assert_eq!(rolled_back_cookie, 0);
  let existing_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id=$1")
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
  assert!(
    security::set_user_email(
      &pool,
      &second_user_id,
      &existing_email.to_ascii_uppercase(),
      "security_action"
    )
    .await
    .is_err()
  );
  let unchanged_epoch: i32 = sqlx::query_scalar("SELECT auth_epoch FROM users WHERE id=$1")
    .bind(&second_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
  assert_eq!(unchanged_epoch, 0);
  let third_user_id = create_user(&pool, &format!("{marker}-email-race-a")).await;
  let fourth_user_id = create_user(&pool, &format!("{marker}-email-race-b")).await;
  let race_email = format!("race-{marker}@example.invalid");
  let uppercase_race_email = race_email.to_ascii_uppercase();
  let first_change = security::set_user_email(&pool, &third_user_id, &race_email, "security_action");
  let second_change = security::set_user_email(&pool, &fourth_user_id, &uppercase_race_email, "security_action");
  let (first_change, second_change) = tokio::join!(first_change, second_change);
  assert_ne!(first_change.is_ok(), second_change.is_ok());
  let duplicate_count: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE lower(email)=lower($1)")
    .bind(&race_email)
    .fetch_one(&pool)
    .await
    .unwrap();
  assert_eq!(duplicate_count, 1);
  let third = create_legacy_device_session(&pool, &config, &user_id, &format!("{marker}-third")).await;
  let revoked = security::revoke_user(&pool, &user_id, "security_action").await.unwrap();
  assert!(revoked >= 1);
  let epoch: i32 = sqlx::query_scalar("SELECT auth_epoch FROM users WHERE id=$1")
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
  assert_eq!(epoch, 1);
  let live_sessions: i64 = sqlx::query_scalar(
    "SELECT count(*) FROM auth_sessions a JOIN user_sessions u ON u.id=a.user_session_id WHERE u.user_id=$1",
  )
  .bind(&user_id)
  .fetch_one(&pool)
  .await
  .unwrap();
  assert_eq!(live_sessions, 0);
  let cookie_principal = principal::resolve(
    &pool,
    &config,
    PrincipalInput::Cookie {
      session_id: password_login.session_id,
      user_id: Some(user_id.clone()),
      refresh_client_version: None,
      refresh: false,
    },
  )
  .await
  .unwrap();
  assert_eq!(serde_json::to_value(cookie_principal).unwrap()["status"], "invalid");
  let removed_legacy_user_session: i64 = sqlx::query_scalar("SELECT count(*) FROM user_sessions WHERE id=$1")
    .bind(third.user_session_id)
    .fetch_one(&pool)
    .await
    .unwrap();
  assert_eq!(removed_legacy_user_session, 0);
  let remaining_refresh_tokens: i64 =
    sqlx::query_scalar("SELECT count(*) FROM auth_refresh_tokens WHERE auth_session_id=$1")
      .bind(&third.id)
      .fetch_one(&pool)
      .await
      .unwrap();
  assert_eq!(remaining_refresh_tokens, 0);

  assert!(
    oauth::preflight(
      &pool,
      &config,
      "Google",
      Some("https://evil.example/steal"),
      "web",
      "rejected-oauth-nonce",
      Some("0.27.5"),
      "https://app.affine.pro/oauth/callback",
      "https://app.affine.pro",
      &["https://app.affine.pro".to_string()],
      &[],
    )
    .await
    .is_err()
  );
  let oauth_preflight = oauth::preflight(
    &pool,
    &config,
    "Google",
    Some("https://app.affine.pro/redirect"),
    "web",
    "oauth-nonce",
    Some("0.27.5"),
    "https://app.affine.pro/oauth/callback",
    "https://app.affine.pro",
    &["https://app.affine.pro".to_string()],
    &[],
  )
  .await
  .unwrap();
  let authorization = url::Url::parse(&oauth_preflight.url).unwrap();
  assert_eq!(authorization.host_str(), Some("accounts.google.com"));
  assert_eq!(
    authorization
      .query_pairs()
      .find(|(key, _)| key == "client_id")
      .unwrap()
      .1,
    "google-client-id"
  );
  let state_parameter = authorization
    .query_pairs()
    .find(|(key, _)| key == "state")
    .unwrap()
    .1
    .into_owned();
  let state_token = serde_json::from_str::<serde_json::Value>(&state_parameter).unwrap()["state"]
    .as_str()
    .unwrap()
    .to_string();
  let state_hash = super::super::token_hash(&state_token);
  oauth::claim_state(&pool, &state_hash).await.unwrap();
  assert!(oauth::claim_state(&pool, &state_hash).await.is_err());

  assert!(
    oauth::preflight(
      &pool,
      &config,
      "Apple",
      None,
      "affine",
      "apple-nonce",
      None,
      "https://app.affine.pro/api/oauth/callback",
      "https://app.affine.pro",
      &["https://app.affine.pro".to_string()],
      &[],
    )
    .await
    .is_err()
  );

  let apple_browser_preflight = oauth::preflight(
    &pool,
    &config,
    "Apple",
    None,
    "web",
    "apple-browser-nonce",
    None,
    "https://example.invalid/api/oauth/callback",
    "https://example.invalid",
    &["https://example.invalid".to_string()],
    &[],
  )
  .await
  .unwrap();
  let apple_browser_state = url::Url::parse(&apple_browser_preflight.url)
    .unwrap()
    .query_pairs()
    .find(|(key, _)| key == "state")
    .unwrap()
    .1
    .into_owned();
  let apple_browser_envelope: serde_json::Value = serde_json::from_str(&apple_browser_state).unwrap();
  assert_eq!(apple_browser_envelope["client"], "web");
  let apple_state_hash = super::super::token_hash(apple_browser_envelope["state"].as_str().unwrap());
  sqlx::query("UPDATE runtime_states SET payload=jsonb_set(payload,'{client}',to_jsonb('affine'::text)) WHERE token_hash=$1")
    .bind(&apple_state_hash)
    .execute(&pool)
    .await
    .unwrap();
  assert!(
    oauth::callback(
      &pool,
      &config,
      "legacy-apple-code",
      &apple_browser_state,
      None,
      SessionIssueInput::Cookie {
        session_id: None,
        client_version: None,
      },
    )
    .await
    .is_err()
  );
  let legacy_oauth_consumed: bool =
    sqlx::query_scalar("SELECT consumed_at IS NOT NULL FROM runtime_states WHERE token_hash=$1")
      .bind(&apple_state_hash)
      .fetch_one(&pool)
      .await
      .unwrap();
  assert!(!legacy_oauth_consumed);

  let oidc_preflight = oauth::preflight(
    &pool,
    &config,
    "OIDC",
    None,
    "web",
    "oidc-client-nonce",
    Some("0.27.5"),
    "https://app.affine.pro/oauth/callback",
    "https://app.affine.pro",
    &["https://app.affine.pro".to_string()],
    &[],
  )
  .await
  .unwrap();
  let oidc_authorization = url::Url::parse(&oidc_preflight.url).unwrap();
  assert_eq!(
    oidc_authorization
      .query_pairs()
      .find(|(key, _)| key == "code_challenge_method")
      .unwrap()
      .1,
    "S256"
  );
  let oidc_state = oidc_authorization
    .query_pairs()
    .find(|(key, _)| key == "state")
    .unwrap()
    .1
    .into_owned();
  let oidc_state_token = serde_json::from_str::<serde_json::Value>(&oidc_state).unwrap()["state"]
    .as_str()
    .unwrap()
    .to_string();
  *oidc_nonce.lock().await = oidc_state_token;
  assert!(
    oauth::callback(
      &pool,
      &config,
      "oidc-code",
      &oidc_state,
      Some("wrong-nonce"),
      SessionIssueInput::Cookie {
        session_id: None,
        client_version: None,
      },
    )
    .await
    .is_err()
  );
  let oidc_login = oauth::callback(
    &pool,
    &config,
    "oidc-code",
    &oidc_state,
    Some("oidc-client-nonce"),
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: None,
    },
  )
  .await
  .unwrap();
  assert_eq!(
    serde_json::to_value(oidc_login).unwrap()["user"]["email"],
    "oidc@example.invalid"
  );
  assert!(
    oauth::callback(
      &pool,
      &config,
      "oidc-code",
      &oidc_state,
      Some("oidc-client-nonce"),
      SessionIssueInput::Cookie {
        session_id: None,
        client_version: None,
      },
    )
    .await
    .is_err()
  );

  let oauth_email = format!("oauth-{marker}@example.invalid");
  let github_subject = |id, login| {
    serde_json::from_value::<oauth_http::GitHubUser>(json!({
      "id": id,
      "login": login,
      "email": null,
      "name": null,
      "avatar_url": null
    }))
    .unwrap()
    .subject()
  };
  assert_eq!(github_subject(4242, "old-name"), github_subject(4242, "new-name"));
  assert_ne!(github_subject(4242, "reused-name"), github_subject(4243, "reused-name"));
  let oauth_state = oauth::OAuthState {
    provider: "google".to_string(),
    provider_label: "Google".to_string(),
    redirect_uri: None,
    client: "web".to_string(),
    client_nonce: "nonce".to_string(),
    client_version: Some("0.27.5".to_string()),
    callback_url: "https://app.affine.pro/oauth/callback".to_string(),
    pkce_verifier: None,
  };
  let oauth_namespace =
    oauth_http::provider_namespace("google", config.auth.oauth.providers.get("google").unwrap(), None);
  config.auth.allow_signup_for_oauth = false;
  let existing_oauth = oauth::bind_and_issue(
    &pool,
    &config,
    &oauth_state,
    &oauth_namespace,
    oauth_http::OAuthAccount {
      subject: format!("existing-subject-{marker}"),
      email: format!("auth-{marker}@example.invalid"),
      name: Some("Existing OAuth User".to_string()),
      avatar_url: None,
    },
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: None,
    },
  )
  .await
  .unwrap();
  assert_eq!(existing_oauth.user.id, user_id);
  assert_eq!(existing_oauth.created, Some(false));
  config.auth.allow_signup_for_oauth = true;
  let oauth_subject = format!("subject-{marker}");
  let account = oauth_http::OAuthAccount {
    subject: oauth_subject.clone(),
    email: oauth_email.clone(),
    name: Some("OAuth User".to_string()),
    avatar_url: Some("https://example.invalid/avatar".to_string()),
  };
  let first_oauth = oauth::bind_and_issue(
    &pool,
    &config,
    &oauth_state,
    &oauth_namespace,
    account.clone(),
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: Some("0.27.5".to_string()),
    },
  );
  let second_oauth = oauth::bind_and_issue(
    &pool,
    &config,
    &oauth_state,
    &oauth_namespace,
    account,
    SessionIssueInput::Cookie {
      session_id: None,
      client_version: None,
    },
  );
  let (first_oauth, second_oauth) = tokio::join!(first_oauth, second_oauth);
  let first_oauth = first_oauth.unwrap();
  let second_oauth = second_oauth.unwrap();
  assert_eq!(first_oauth.user.id, second_oauth.user.id);
  assert_eq!(
    [first_oauth.created, second_oauth.created]
      .into_iter()
      .filter(|created| *created == Some(true))
      .count(),
    1
  );
  let connected: (i64, i64) = sqlx::query_as(
    "SELECT count(*),count(*) FILTER (WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR scope IS NOT \
     NULL OR expires_at IS NOT NULL) FROM user_connected_accounts WHERE provider_namespace=$1 AND \
     provider_account_id=$2",
  )
  .bind(&oauth_namespace)
  .bind(&oauth_subject)
  .fetch_one(&pool)
  .await
  .unwrap();
  assert_eq!(connected, (1, 0));

  sqlx::query("UPDATE users SET email_verified=clock_timestamp() WHERE id=$1")
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();
  security_challenge::prepare(
    &pool,
    &config,
    security_challenge::SecurityChallengeKind::ChangePassword,
    &user_id,
    "https://app.affine.pro/change-password",
    None,
  )
  .await
  .unwrap();
  let password_mail: serde_json::Value = sqlx::query_scalar(
    "SELECT payload FROM mail_deliveries WHERE mail_name='ChangePassword' AND recipient_user_id=$1 ORDER BY \
     created_at DESC LIMIT 1",
  )
  .bind(&user_id)
  .fetch_one(&pool)
  .await
  .unwrap();
  let password_url = url::Url::parse(password_mail["props"]["url"].as_str().unwrap()).unwrap();
  let password_token = password_url
    .query_pairs()
    .find(|(key, _)| key == "token")
    .unwrap()
    .1
    .into_owned();
  security_challenge::complete_password(&pool, &user_id, &password_token, "replacement-password")
    .await
    .unwrap();
  assert!(
    security_challenge::complete_password(&pool, &user_id, &password_token, "replayed-password")
      .await
      .is_err()
  );
  let changed_password: (String, i32) = sqlx::query_as("SELECT password,auth_epoch FROM users WHERE id=$1")
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
  assert_eq!(changed_password.1, 2);
  assert!(
    Argon2::default()
      .verify_password(
        b"replacement-password",
        &PasswordHash::new(&changed_password.0).unwrap(),
      )
      .is_ok()
  );

  security_challenge::prepare(
    &pool,
    &config,
    security_challenge::SecurityChallengeKind::ChangePassword,
    &user_id,
    "https://app.affine.pro/change-password",
    None,
  )
  .await
  .unwrap();
  let rollback_mail: serde_json::Value = sqlx::query_scalar(
    "SELECT payload FROM mail_deliveries WHERE mail_name='ChangePassword' AND recipient_user_id=$1 ORDER BY \
     created_at DESC LIMIT 1",
  )
  .bind(&user_id)
  .fetch_one(&pool)
  .await
  .unwrap();
  let rollback_token = url::Url::parse(rollback_mail["props"]["url"].as_str().unwrap())
    .unwrap()
    .query_pairs()
    .find(|(key, _)| key == "token")
    .unwrap()
    .1
    .into_owned();
  sqlx::query("DROP TRIGGER IF EXISTS rfc12_auth_security_fault ON users")
    .execute(&pool)
    .await
    .unwrap();
  sqlx::query("DROP FUNCTION IF EXISTS rfc12_auth_security_fault()")
    .execute(&pool)
    .await
    .unwrap();
  sqlx::query(
    r#"CREATE FUNCTION rfc12_auth_security_fault() RETURNS trigger AS $$
       BEGIN
         RAISE EXCEPTION 'injected credential update failure';
       END
       $$ LANGUAGE plpgsql"#,
  )
  .execute(&pool)
  .await
  .unwrap();
  sqlx::query(
    "CREATE TRIGGER rfc12_auth_security_fault BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION \
     rfc12_auth_security_fault()",
  )
  .execute(&pool)
  .await
  .unwrap();
  assert!(
    security_challenge::complete_password(&pool, &user_id, &rollback_token, "rollback-password")
      .await
      .is_err()
  );
  let rollback_consumed: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
    "SELECT consumed_at FROM runtime_states WHERE purpose='auth_challenge:change_password' AND token_hash=$1",
  )
  .bind(super::super::token_hash(&rollback_token))
  .fetch_one(&pool)
  .await
  .unwrap();
  assert!(rollback_consumed.is_none());
  sqlx::query("DROP TRIGGER rfc12_auth_security_fault ON users")
    .execute(&pool)
    .await
    .unwrap();
  sqlx::query("DROP FUNCTION rfc12_auth_security_fault()")
    .execute(&pool)
    .await
    .unwrap();
  security_challenge::complete_password(&pool, &user_id, &rollback_token, "after-rollback-password")
    .await
    .unwrap();

  security_challenge::prepare(
    &pool,
    &config,
    security_challenge::SecurityChallengeKind::ChangeEmail,
    &user_id,
    "https://app.affine.pro/change-email",
    None,
  )
  .await
  .unwrap();
  let change_mail: serde_json::Value = sqlx::query_scalar(
    "SELECT payload FROM mail_deliveries WHERE mail_name='ChangeEmail' AND recipient_user_id=$1 ORDER BY created_at \
     DESC LIMIT 1",
  )
  .bind(&user_id)
  .fetch_one(&pool)
  .await
  .unwrap();
  let change_token = url::Url::parse(change_mail["props"]["url"].as_str().unwrap())
    .unwrap()
    .query_pairs()
    .find(|(key, _)| key == "token")
    .unwrap()
    .1
    .into_owned();
  let changed_email = format!("changed-{marker}@example.invalid");
  security_challenge::prepare_verify_change_email(
    &pool,
    &config,
    &user_id,
    &change_token,
    &changed_email,
    "https://app.affine.pro/verify-email",
    None,
  )
  .await
  .unwrap();
  let verify_mail: serde_json::Value = sqlx::query_scalar(
    "SELECT payload FROM mail_deliveries WHERE mail_name='VerifyChangeEmail' AND recipient_user_id=$1 ORDER BY \
     created_at DESC LIMIT 1",
  )
  .bind(&user_id)
  .fetch_one(&pool)
  .await
  .unwrap();
  let verify_token = url::Url::parse(verify_mail["props"]["url"].as_str().unwrap())
    .unwrap()
    .query_pairs()
    .find(|(key, _)| key == "token")
    .unwrap()
    .1
    .into_owned();
  security_challenge::complete_email(&pool, &config, &user_id, &verify_token, &changed_email)
    .await
    .unwrap();
  let changed: (String, i32, i64) = sqlx::query_as(
    "SELECT email,auth_epoch,(SELECT count(*) FROM mail_deliveries WHERE mail_name='EmailChanged' AND \
     recipient_user_id=$1) FROM users WHERE id=$1",
  )
  .bind(&user_id)
  .fetch_one(&pool)
  .await
  .unwrap();
  assert_eq!(changed, (changed_email, 4, 1));
  assert!(
    security::set_user_disabled(&pool, &user_id, true, "administrator_disabled")
      .await
      .unwrap()
  );
  assert!(
    !security::set_user_disabled(&pool, &user_id, false, "administrator_enabled")
      .await
      .unwrap()
  );
  let status: (bool, i32) = sqlx::query_as("SELECT disabled,auth_epoch FROM users WHERE id=$1")
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
  assert_eq!(status, (false, 6));
  sqlx::query("DELETE FROM users WHERE id=$1")
    .bind(first_oauth.user.id)
    .execute(&pool)
    .await
    .unwrap();
  sqlx::query("DELETE FROM users WHERE id=$1")
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();
  sqlx::query("DELETE FROM users WHERE id=$1")
    .bind(magic_login.user.id)
    .execute(&pool)
    .await
    .unwrap();
  sqlx::query("DELETE FROM users WHERE id=$1")
    .bind(&second_user_id)
    .execute(&pool)
    .await
    .unwrap();
  sqlx::query("DELETE FROM users WHERE email='oidc@example.invalid'")
    .execute(&pool)
    .await
    .unwrap();
}
