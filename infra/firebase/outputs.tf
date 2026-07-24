output "firestore_database" {
  value = google_firestore_database.default.name
}

output "storage_bucket" {
  value = google_storage_bucket.objects.name
}

output "kms_profile_key" {
  value = google_kms_crypto_key.profile_secrets.id
}

output "vps_runtime_service_account" {
  value = google_service_account.vps_runtime.email
}
