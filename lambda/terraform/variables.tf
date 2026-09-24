variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-west-2"
}

variable "bucket_name" {
  description = "Existing S3 bucket that holds uploaded tracks and triggers the Lambda"
  type        = string
}

variable "track_prefix" {
  description = "Key prefix that upload-triggered analysis should watch"
  type        = string
  default     = "tracks/"
}

variable "results_prefix" {
  description = "Key prefix (under bucket_name, or results_bucket_name if set) where result JSON is written"
  type        = string
  default     = "analysis"
}

variable "results_bucket_name" {
  description = "Optional separate bucket for results. Empty = write results into bucket_name."
  type        = string
  default     = ""
}

variable "function_name" {
  description = "Lambda function name and ECR repository name"
  type        = string
  default     = "track-analyzer"
}

variable "image_tag" {
  description = "Tag of the image already pushed to ECR by deploy.sh"
  type        = string
  default     = "latest"
}

variable "memory_size" {
  description = "MB. Also scales vCPU allocation — chroma/beat analysis is CPU-bound."
  type        = number
  default     = 3008
}

variable "timeout" {
  description = "Seconds"
  type        = number
  default     = 300
}

variable "ephemeral_storage_mb" {
  description = "MB of /tmp space for downloading the source audio file"
  type        = number
  default     = 2048
}

variable "backend_webhook_url" {
  description = "Optional: POST each result here in addition to writing it to S3"
  type        = string
  default     = ""
}

variable "backend_webhook_api_key" {
  description = "Optional bearer token sent with the webhook POST"
  type        = string
  default     = ""
  sensitive   = true
}

locals {
  results_bucket_name = var.results_bucket_name != "" ? var.results_bucket_name : var.bucket_name
}
