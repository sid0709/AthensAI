variable "project_id" {
  description = "Firebase / Google Cloud project ID."
  type        = string
  default     = "drwretail-bm"
}

variable "compute_region" {
  description = "KMS key-ring region; VPS compute remains outside Google Cloud."
  type        = string
  default     = "us-east4"
}

variable "firestore_location" {
  description = "Immutable Firestore Native database location."
  type        = string
  default     = "nam7"
}

variable "storage_bucket" {
  description = "US multi-region bucket for migrated GridFS and application objects."
  type        = string
  default     = "drwretail-bm-migrated"
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
