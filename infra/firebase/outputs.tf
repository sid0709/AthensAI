output "api_ip_address" {
  description = "Create an A record for api_domain pointing to this address."
  value       = google_compute_global_address.api.address
}

output "api_service_uri" {
  value = google_cloud_run_v2_service.api.uri
}

output "ai_bff_service_uri" {
  value = google_cloud_run_v2_service.ai_bff.uri
}

output "relay_service_uri" {
  value = google_cloud_run_v2_service.relay.uri
}

output "storage_bucket" {
  value = google_storage_bucket.objects.name
}
