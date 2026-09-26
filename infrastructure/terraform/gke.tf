# Regional GKE Autopilot cluster with private nodes. Autopilot enables
# Workload Identity, shielded nodes and node auto-upgrade by default; the
# Secret Manager add-on mounts secrets as files (no Kubernetes Secret with
# credential material, no service-account JSON keys).

resource "google_container_cluster" "erp" {
  provider = google

  name     = "${local.name}-gke"
  location = var.region

  enable_autopilot    = true
  deletion_protection = var.gke_deletion_protection

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.gke.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = var.master_ipv4_cidr
  }

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.control_plane_authorized_networks
      content {
        cidr_block   = cidr_blocks.value.cidr
        display_name = cidr_blocks.value.name
      }
    }
  }

  cluster_autoscaling {
    auto_provisioning_defaults {
      service_account = google_service_account.nodes.email
      oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    }
  }

  release_channel {
    channel = var.gke_release_channel
  }

  secret_manager_config {
    enabled = true
  }

  # Autopilot runs Dataplane V2, which enforces Kubernetes NetworkPolicy.
  datapath_provider = "ADVANCED_DATAPATH"

  maintenance_policy {
    recurring_window {
      start_time = "2026-01-04T20:30:00Z" # Sunday 02:00 IST
      end_time   = "2026-01-05T00:30:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SU"
    }
  }

  depends_on = [google_project_service.apis]
}
