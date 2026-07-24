locals {
  services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "compute.googleapis.com",
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "identitytoolkit.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "storage.googleapis.com",
    "vpcaccess.googleapis.com",
  ])

  images = {
    api    = var.bootstrap_images ? "us-docker.pkg.dev/cloudrun/container/hello" : "${var.compute_region}-docker.pkg.dev/${var.project_id}/athens/athens-api:${var.image_tag}"
    ai_bff = var.bootstrap_images ? "us-docker.pkg.dev/cloudrun/container/hello" : "${var.compute_region}-docker.pkg.dev/${var.project_id}/athens/ai-bff:${var.image_tag}"
    relay  = var.bootstrap_images ? "us-docker.pkg.dev/cloudrun/container/hello" : "${var.compute_region}-docker.pkg.dev/${var.project_id}/athens/avalon-relay:${var.image_tag}"
  }
}

resource "google_project_service" "required" {
  for_each           = local.services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "athens" {
  location      = var.compute_region
  repository_id = "athens"
  format        = "DOCKER"
  depends_on    = [google_project_service.required]
}

# The existing (default) database must be imported before the first apply if it
# was already created in the Firebase console.
resource "google_firestore_database" "default" {
  project                           = var.project_id
  name                              = "(default)"
  location_id                       = var.firestore_location
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "PESSIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "ABANDON"
  depends_on                        = [google_project_service.required]
}

resource "google_firestore_field" "upload_sessions_ttl" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "upload_sessions"
  field      = "expiresAt"

  ttl_config {}
}

resource "google_firestore_field" "search_outbox_ttl" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "search_outbox"
  field      = "expiresAt"

  ttl_config {}
}

resource "google_firestore_backup_schedule" "daily" {
  project   = var.project_id
  database  = google_firestore_database.default.name
  retention = "1209600s"
  daily_recurrence {}
}

resource "google_firestore_backup_schedule" "weekly" {
  project   = var.project_id
  database  = google_firestore_database.default.name
  retention = "8467200s"
  weekly_recurrence {
    day = "SUNDAY"
  }
}

resource "google_storage_bucket" "objects" {
  name                        = var.storage_bucket
  location                    = "US"
  uniform_bucket_level_access = true
  force_destroy               = false
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 1209600
  }

  cors {
    origin          = concat([var.frontend_origin], var.extension_origins)
    method          = ["PUT", "POST", "GET", "HEAD"]
    response_header = ["Content-Type", "Range", "X-Goog-Upload-Status"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 10
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_compute_network" "athens" {
  name                    = "athens-serverless"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "serverless" {
  name                     = "athens-${var.compute_region}"
  ip_cidr_range            = "10.42.0.0/24"
  region                   = var.compute_region
  network                  = google_compute_network.athens.id
  private_ip_google_access = true
}

resource "google_vpc_access_connector" "serverless" {
  provider      = google-beta
  name          = "athens-run"
  region        = var.compute_region
  network       = google_compute_network.athens.name
  ip_cidr_range = "10.42.1.0/28"
  min_instances = 2
  max_instances = 3
}

resource "google_redis_instance" "cache" {
  name               = "athens-cache"
  tier               = "STANDARD_HA"
  memory_size_gb     = 1
  region             = var.compute_region
  redis_version      = "REDIS_7_2"
  authorized_network = google_compute_network.athens.id
  connect_mode       = "DIRECT_PEERING"
  depends_on         = [google_project_service.required]
}

resource "google_cloud_tasks_queue" "queues" {
  for_each = {
    job-analysis  = 8
    match-scores  = 4
    search-outbox = 2
  }
  name     = each.key
  location = var.compute_region
  rate_limits {
    max_concurrent_dispatches = each.value
    max_dispatches_per_second = each.value * 2
  }
  retry_config {
    max_attempts  = 10
    min_backoff   = "5s"
    max_backoff   = "600s"
    max_doublings = 5
  }
  depends_on = [google_project_service.required]
}

resource "google_kms_key_ring" "athens" {
  name       = "athens"
  location   = var.compute_region
  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key" "profile_secrets" {
  name            = "profile-secrets"
  key_ring        = google_kms_key_ring.athens.id
  rotation_period = "7776000s"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret" "runtime" {
  for_each = toset([
    "algolia-admin-key",
    "algolia-app-id",
    "openai-api-key",
    "deepseek-api-key",
  ])
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_service_account" "runtime" {
  for_each     = toset(["api", "ai-bff", "avalon-relay", "worker"])
  account_id   = "athens-${each.value}"
  display_name = "Athens ${each.value} runtime"
}

resource "google_service_account" "deployer" {
  account_id   = "athens-deployer"
  display_name = "Athens Cloud Build deployer"
}

# The deployer identity is bootstrapped manually so GitHub Actions can use
# Workload Identity Federation before Terraform is first applied. Import it on
# the initial apply, then keep it managed by this configuration.
import {
  to = google_service_account.deployer
  id = "projects/${var.project_id}/serviceAccounts/athens-deployer@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "deployer_roles" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/cloudbuild.builds.builder",
    "roles/datastore.indexAdmin",
    "roles/firebase.viewer",
    "roles/firebasehosting.admin",
    "roles/firebaserules.admin",
    "roles/logging.logWriter",
    "roles/run.admin",
    "roles/serviceusage.serviceUsageConsumer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_can_use_runtime" {
  for_each           = google_service_account.runtime
  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "runtime_datastore" {
  for_each = google_service_account.runtime
  project  = var.project_id
  role     = "roles/datastore.user"
  member   = "serviceAccount:${each.value.email}"
}

resource "google_project_iam_member" "runtime_logging" {
  for_each = google_service_account.runtime
  project  = var.project_id
  role     = "roles/logging.logWriter"
  member   = "serviceAccount:${each.value.email}"
}

resource "google_storage_bucket_iam_member" "runtime_objects" {
  for_each = {
    api    = google_service_account.runtime["api"]
    worker = google_service_account.runtime["worker"]
  }
  bucket = google_storage_bucket.objects.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${each.value.email}"
}

resource "google_project_iam_member" "api_auth" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_project_iam_member" "runtime_auth_viewer" {
  for_each = {
    ai_bff       = google_service_account.runtime["ai-bff"]
    avalon_relay = google_service_account.runtime["avalon-relay"]
  }
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${each.value.email}"
}

resource "google_project_iam_member" "api_tasks" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_service_account_iam_member" "api_can_mint_worker_tokens" {
  service_account_id = google_service_account.runtime["worker"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_service_account_iam_member" "api_can_sign_storage_urls" {
  service_account_id = google_service_account.runtime["api"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_project_service_identity" "oidc_agents" {
  provider = google-beta
  for_each = toset(["cloudtasks.googleapis.com", "cloudscheduler.googleapis.com"])
  project  = var.project_id
  service  = each.value
}

resource "google_service_account_iam_member" "oidc_agents_can_mint_worker_tokens" {
  for_each           = google_project_service_identity.oidc_agents
  service_account_id = google_service_account.runtime["worker"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${each.value.email}"
}

resource "google_kms_crypto_key_iam_member" "api_kms" {
  crypto_key_id = google_kms_crypto_key.profile_secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_kms_crypto_key_iam_member" "worker_kms" {
  crypto_key_id = google_kms_crypto_key.profile_secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.runtime["worker"].email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_secrets" {
  for_each = {
    for pair in setproduct(keys(google_service_account.runtime), keys(google_secret_manager_secret.runtime)) :
    "${pair[0]}:${pair[1]}" => { service = pair[0], secret = pair[1] }
    if contains(["api", "ai-bff", "worker"], pair[0])
  }
  secret_id = google_secret_manager_secret.runtime[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.service].email}"
}

resource "google_cloud_run_v2_service" "ai_bff" {
  name                = "ai-bff"
  location            = var.compute_region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = true

  template {
    service_account                  = google_service_account.runtime["ai-bff"].email
    timeout                          = "900s"
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 1
      max_instance_count = 20
    }
    containers {
      image = local.images.ai_bff
      ports {
        container_port = 8080
      }
      resources {
        limits = { cpu = "2", memory = "4Gi" }
      }
      env {
        name  = "DATABASE_BACKEND"
        value = "firestore"
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "FIREBASE_AUTH_REQUIRED"
        value = "true"
      }
      env {
        name  = "CORS_ORIGIN"
        value = var.frontend_origin
      }
      env {
        name  = "ALLOWED_SERVICE_ACCOUNTS"
        value = google_service_account.runtime["api"].email
      }
      env {
        name  = "SERVICE_AUTH_AUDIENCE"
        value = "https://${var.api_domain}"
      }
      dynamic "env" {
        for_each = var.bootstrap_images ? [] : [1]
        content {
          name = "OPENAI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["openai-api-key"].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.bootstrap_images ? [] : [1]
        content {
          name = "DEEPSEEK_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["deepseek-api-key"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_artifact_registry_repository.athens]
}

resource "google_cloud_run_v2_service" "api" {
  name                = "athens-api"
  location            = var.compute_region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = true

  template {
    service_account                  = google_service_account.runtime["api"].email
    timeout                          = "3600s"
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = var.min_api_instances
      max_instance_count = 20
    }
    vpc_access {
      connector = google_vpc_access_connector.serverless.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = local.images.api
      ports {
        container_port = 8080
      }
      resources {
        limits            = { cpu = "4", memory = "16Gi" }
        cpu_idle          = false
        startup_cpu_boost = true
      }
      env {
        name  = "DATABASE_BACKEND"
        value = "firestore"
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "FIREBASE_STORAGE_BUCKET"
        value = google_storage_bucket.objects.name
      }
      env {
        name  = "FIREBASE_AUTH_REQUIRED"
        value = "true"
      }
      env {
        name  = "FIRESTORE_WRITES_ENABLED"
        value = tostring(var.firestore_writes_enabled)
      }
      env {
        name  = "CORS_ORIGIN"
        value = join(",", concat([var.frontend_origin], var.extension_origins))
      }
      env {
        name  = "SOCKET_CORS_ORIGINS"
        value = join(",", concat([var.frontend_origin], var.extension_origins))
      }
      env {
        name  = "UPLOAD_CORS_ORIGIN"
        value = "*"
      }
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
      }
      env {
        name  = "AI_BFF_URL"
        value = "https://${var.api_domain}/ai-bff"
      }
      env {
        name  = "AI_BFF_AUDIENCE"
        value = "https://${var.api_domain}"
      }
      env {
        name  = "SERVICE_AUTH_REQUIRED"
        value = "true"
      }
      env {
        name  = "BACKGROUND_WORKERS_MODE"
        value = "tasks"
      }
      env {
        name  = "CLOUD_TASKS_LOCATION"
        value = var.compute_region
      }
      env {
        name  = "TASK_SERVICE_ACCOUNT_EMAIL"
        value = google_service_account.runtime["worker"].email
      }
      env {
        name  = "ALLOWED_TASK_SERVICE_ACCOUNTS"
        value = google_service_account.runtime["worker"].email
      }
      env {
        name  = "ATHENS_INTERNAL_URL"
        value = "https://${var.api_domain}"
      }
      env {
        name  = "KMS_KEY_NAME"
        value = google_kms_crypto_key.profile_secrets.id
      }
      env {
        name  = "ALGOLIA_JOBS_INDEX"
        value = var.algolia_jobs_index
      }
      dynamic "env" {
        for_each = var.bootstrap_images ? [] : [
          ["OPENAI_API_KEY", "openai-api-key"],
          ["DEEPSEEK_API_KEY", "deepseek-api-key"],
          ["ALGOLIA_ADMIN_API_KEY", "algolia-admin-key"],
          ["ALGOLIA_APP_ID", "algolia-app-id"],
        ]
        content {
          name = env.value[0]
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime[env.value[1]].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "startup_probe" {
        for_each = var.bootstrap_images ? [] : [1]
        content {
          http_get { path = "/healthz" }
          initial_delay_seconds = 10
          timeout_seconds       = 5
          period_seconds        = 10
          failure_threshold     = 24
        }
      }
      dynamic "liveness_probe" {
        for_each = var.bootstrap_images ? [] : [1]
        content {
          http_get { path = "/healthz" }
          timeout_seconds = 5
          period_seconds  = 30
        }
      }
    }
  }
  depends_on = [google_artifact_registry_repository.athens]
}

resource "google_cloud_run_v2_service" "relay" {
  name                = "avalon-relay"
  location            = var.compute_region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = true

  template {
    service_account                  = google_service_account.runtime["avalon-relay"].email
    timeout                          = "3600s"
    max_instance_request_concurrency = 1000
    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }
    vpc_access {
      connector = google_vpc_access_connector.serverless.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = local.images.relay
      ports {
        container_port = 8080
      }
      resources {
        limits   = { cpu = "1", memory = "1Gi" }
        cpu_idle = false
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "FIREBASE_AUTH_REQUIRED"
        value = "true"
      }
      env {
        name  = "CORS_ORIGIN"
        value = join(",", concat([var.frontend_origin], var.extension_origins))
      }
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
      }
    }
  }
  depends_on = [google_artifact_registry_repository.athens]
}

resource "google_cloud_run_v2_job" "maintenance" {
  for_each = {
    search-rebuild        = "search-rebuild"
    job-analysis-backfill = "job-analysis-backfill"
    match-score-backfill  = "match-score-backfill"
  }
  name                = "athens-${each.key}"
  location            = var.compute_region
  deletion_protection = true

  template {
    template {
      service_account = google_service_account.runtime["worker"].email
      timeout         = "3600s"
      max_retries     = 1
      vpc_access {
        connector = google_vpc_access_connector.serverless.id
        egress    = "PRIVATE_RANGES_ONLY"
      }
      containers {
        image   = local.images.api
        command = ["node"]
        args    = ["src/scripts/cloudRunJob.js"]
        resources {
          limits = { cpu = "4", memory = "8Gi" }
        }
        env {
          name  = "CLOUD_JOB_KIND"
          value = each.value
        }
        env {
          name  = "DATABASE_BACKEND"
          value = "firestore"
        }
        env {
          name  = "FIREBASE_PROJECT_ID"
          value = var.project_id
        }
        env {
          name  = "FIREBASE_STORAGE_BUCKET"
          value = google_storage_bucket.objects.name
        }
        env {
          name  = "FIRESTORE_WRITES_ENABLED"
          value = tostring(var.firestore_writes_enabled)
        }
        env {
          name  = "REDIS_URL"
          value = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
        }
        env {
          name  = "ALGOLIA_JOBS_INDEX"
          value = var.algolia_jobs_index
        }
        env {
          name  = "KMS_KEY_NAME"
          value = google_kms_crypto_key.profile_secrets.id
        }
        dynamic "env" {
          for_each = var.bootstrap_images ? [] : [
            ["OPENAI_API_KEY", "openai-api-key"],
            ["DEEPSEEK_API_KEY", "deepseek-api-key"],
            ["ALGOLIA_ADMIN_API_KEY", "algolia-admin-key"],
            ["ALGOLIA_APP_ID", "algolia-app-id"],
          ]
          content {
            name = env.value[0]
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.runtime[env.value[1]].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }
  depends_on = [google_artifact_registry_repository.athens]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = {
    api    = google_cloud_run_v2_service.api.name
    ai_bff = google_cloud_run_v2_service.ai_bff.name
    relay  = google_cloud_run_v2_service.relay.name
  }
  project  = var.project_id
  location = var.compute_region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_compute_region_network_endpoint_group" "serverless" {
  for_each = {
    api    = google_cloud_run_v2_service.api.name
    ai_bff = google_cloud_run_v2_service.ai_bff.name
    relay  = google_cloud_run_v2_service.relay.name
  }
  name                  = "athens-${replace(each.key, "_", "-")}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.compute_region
  cloud_run {
    service = each.value
  }
}

resource "google_compute_backend_service" "serverless" {
  for_each    = google_compute_region_network_endpoint_group.serverless
  name        = "athens-${replace(each.key, "_", "-")}-backend"
  protocol    = "HTTP"
  timeout_sec = each.key == "ai_bff" ? 900 : 3600
  backend {
    group = each.value.id
  }
}

resource "google_compute_url_map" "api" {
  name            = "athens-api"
  default_service = google_compute_backend_service.serverless["api"].id
  host_rule {
    hosts        = [var.api_domain]
    path_matcher = "services"
  }
  path_matcher {
    name            = "services"
    default_service = google_compute_backend_service.serverless["api"].id
    path_rule {
      paths   = ["/ai-bff", "/ai-bff/*"]
      service = google_compute_backend_service.serverless["ai_bff"].id
    }
    path_rule {
      paths   = ["/avalon", "/avalon/*"]
      service = google_compute_backend_service.serverless["relay"].id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "api" {
  name = "athens-api"
  managed {
    domains = [var.api_domain]
  }
}

resource "google_compute_target_https_proxy" "api" {
  name             = "athens-api"
  url_map          = google_compute_url_map.api.id
  ssl_certificates = [google_compute_managed_ssl_certificate.api.id]
}

resource "google_compute_global_address" "api" {
  name = "athens-api"
}

resource "google_compute_global_forwarding_rule" "api" {
  name       = "athens-api-https"
  target     = google_compute_target_https_proxy.api.id
  port_range = "443"
  ip_address = google_compute_global_address.api.address
}

resource "google_cloud_scheduler_job" "worker_sweeps" {
  for_each = {
    job-analysis  = "/internal/tasks/job-analysis"
    match-scores  = "/internal/tasks/match-scores"
    search-outbox = "/internal/tasks/search-outbox"
  }
  name      = "athens-${each.key}-sweep"
  region    = var.compute_region
  schedule  = each.key == "search-outbox" ? "* * * * *" : "*/5 * * * *"
  time_zone = "Etc/UTC"
  http_target {
    uri         = "https://${var.api_domain}${each.value}"
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")
    oidc_token {
      service_account_email = google_service_account.runtime["worker"].email
      audience              = "https://${var.api_domain}"
    }
  }
}

resource "google_project_iam_audit_config" "all" {
  project = var.project_id
  service = "allServices"
  audit_log_config { log_type = "ADMIN_READ" }
  audit_log_config { log_type = "DATA_READ" }
  audit_log_config { log_type = "DATA_WRITE" }
}

resource "google_monitoring_uptime_check_config" "api" {
  display_name = "Athens API readiness"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path         = "/readyz"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.api_domain
      project_id = var.project_id
    }
  }
}

resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id == "" || var.project_number == "" ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "Athens Firebase monthly budget"
  budget_filter {
    projects = ["projects/${var.project_number}"]
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.9 }
  threshold_rules { threshold_percent = 1.0 }
}
