terraform {
  required_version = ">= 1.6.0"

  # Bootstrapped once before the first apply. Keeping state in this versioned
  # bucket makes subsequent Cloud Shell and GitHub Actions runs consistent.
  backend "gcs" {
    bucket = "drwretail-bm-tfstate"
    prefix = "firebase/production"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.compute_region
}

provider "google-beta" {
  project = var.project_id
  region  = var.compute_region
}
