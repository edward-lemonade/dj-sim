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
      RESULTS_PREFIX               = var.results_prefix
      RESULTS_BUCKET               = var.results_bucket_name
      BACKEND_ANALYSIS_WEBHOOK_URL = var.backend_analysis_webhook_url
      BACKEND_WEBHOOK_API_KEY      = var.backend_webhook_api_key
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

resource "aws_iam_role" "recording_waveform" {
  name               = local.waveform_iam_role_name
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

data "aws_iam_policy_document" "recording_waveform_permissions" {
  statement {
    sid       = "ReadRecordings"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.bucket_name}/${var.recordings_prefix}*"]
  }

  statement {
    sid       = "WriteWaveforms"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${var.bucket_name}/${var.recordings_prefix}*"]
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

resource "aws_iam_role_policy" "recording_waveform" {
  name   = "${var.waveform_function_name}-permissions"
  role   = aws_iam_role.recording_waveform.id
  policy = data.aws_iam_policy_document.recording_waveform_permissions.json
}

resource "aws_lambda_function" "recording_waveform" {
  function_name = var.waveform_function_name
  role          = aws_iam_role.recording_waveform.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.track_analyzer.repository_url}:${var.image_tag}"

  image_config {
    command = ["recording_waveform.handler.handler"]
  }

  timeout     = 300
  memory_size = 2048

  ephemeral_storage {
    size = 1024
  }

  environment {
    variables = {
      RECORDINGS_PREFIX            = var.recordings_prefix
      BACKEND_WAVEFORM_WEBHOOK_URL = var.backend_waveform_webhook_url
      BACKEND_WEBHOOK_API_KEY      = var.backend_webhook_api_key
    }
  }

  depends_on = [
    aws_ecr_repository.track_analyzer,
    aws_ecr_repository_policy.track_analyzer,
    aws_iam_role_policy.recording_waveform,
  ]
}
