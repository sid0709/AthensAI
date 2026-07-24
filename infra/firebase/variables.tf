variable "project_id" {
  description = "Firebase / Google Cloud project ID."
  type        = string
  default     = "drwretail-bm"
}

variable "compute_region" {
  description = "Region for Cloud Run, Tasks, Scheduler, and Memorystore."
  type        = string
  default     = "us-east4"
}

variable "firestore_location" {
  description = "Immutable Firestore Native database location."
  type        = string
  default     = "nam7"
}

variable "api_domain" {
  description = "DNS name routed to the Cloud Run load balancer, for example api.example.com."
  type        = string
}

variable "storage_bucket" {
  description = "US multi-region object bucket used for migrated GridFS and uploads."
  type        = string
  default     = "drwretail-bm-migrated"
}

variable "image_tag" {
  description = "Immutable image tag, normally the Git commit SHA."
  type        = string
}

variable "bootstrap_images" {
  description = "Use Google's public hello image for the first Terraform apply, before the private images exist. Set false immediately after the first Cloud Build."
  type        = bool
  default     = true
}

variable "frontend_origin" {
  description = "Exact Firebase Hosting/custom-domain origin allowed by the APIs."
  type        = string
}

variable "extension_origins" {
  description = "Exact chrome-extension origins allowed to use resumable Cloud Storage uploads. Partial wildcards are not supported."
  type        = list(string)
  default     = ["*"]
}

variable "min_api_instances" {
  type    = number
  default = 1
}

variable "firestore_writes_enabled" {
  description = "Cutover guard. Keep false through final import and verification; set true only after sign-off."
  type        = bool
  default     = false
}

variable "algolia_jobs_index" {
  type    = string
  default = "athens_jobs"
}

variable "billing_account_id" {
  description = "Billing account resource ID. Leave empty to skip budget creation."
  type        = string
  default     = ""
}

variable "project_number" {
  description = "Numeric Google Cloud project number, used by budget filters."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 500
}
