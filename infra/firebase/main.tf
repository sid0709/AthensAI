locals {
  services = toset([
    "billingbudgets.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "storage.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each           = local.services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Import the existing default database before the first apply if it was
# originally created in the Firebase console.
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

# The VPS runs every application process. Its key is created manually after
# this identity exists and is never stored in Terraform state or GitHub.
resource "google_service_account" "vps_runtime" {
  account_id   = "athens-vps-runtime"
  display_name = "Athens VPS data runtime"
}

resource "google_project_iam_member" "vps_runtime_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.vps_runtime.email}"
}

resource "google_project_iam_member" "vps_runtime_service_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.vps_runtime.email}"
}

resource "google_storage_bucket_iam_member" "vps_runtime_objects" {
  bucket = google_storage_bucket.objects.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.vps_runtime.email}"
}

resource "google_kms_crypto_key_iam_member" "vps_runtime_profile_secrets" {
  crypto_key_id = google_kms_crypto_key.profile_secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.vps_runtime.email}"
}

resource "google_project_iam_audit_config" "all" {
  project = var.project_id
  service = "allServices"
  audit_log_config { log_type = "ADMIN_READ" }
  audit_log_config { log_type = "DATA_READ" }
  audit_log_config { log_type = "DATA_WRITE" }
}

resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id == "" || var.project_number == "" ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "Athens Firebase data monthly budget"
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
