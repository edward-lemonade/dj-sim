resource "aws_lambda_function" "track_analyzer" {
  function_name = var.function_name
  role          = aws_iam_role.track_analyzer.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.track_analyzer.repository_url}:${var.image_tag}"

  timeout     = var.timeout
  memory_size = var.memory_size

  ephemeral_storage {
    size = var.ephemeral_storage_mb
  }

  environment {
    variables = {
      RESULTS_PREFIX          = var.results_prefix
      RESULTS_BUCKET          = var.results_bucket_name
      BACKEND_WEBHOOK_URL     = var.backend_webhook_url
      BACKEND_WEBHOOK_API_KEY = var.backend_webhook_api_key
      # librosa pulls in numba for JIT-compiled DSP functions. numba's
      # @jit(cache=True) tries to write its compiled-function cache next
      # to the source file in site-packages, which is read-only in
      # Lambda — fails with "cannot cache function ...: no locator
      # available" the first time librosa.load() triggers the lazy
      # import. /tmp is the one writable directory Lambda provides.
      NUMBA_CACHE_DIR = "/tmp"
    }
  }

  # The image must already exist at image_uri before this can apply — see
  # README "bootstrap order". Terraform provisions AWS resources; it doesn't
  # build/push the container image itself. Also waits on the ECR repo
  # policy (ecr_policy.tf) — without it, Lambda itself (not just your
  # deploying user) lacks permission to pull the image.
  depends_on = [aws_ecr_repository.track_analyzer, aws_ecr_repository_policy.track_analyzer]
}
