data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "track_analyzer" {
  name               = local.iam_role_name
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

data "aws_iam_policy_document" "permissions" {
  statement {
    sid       = "ReadSourceAudio"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.bucket_name}/*"]
  }

  statement {
    sid       = "WriteResults"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.results_bucket_name}/*"]
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

resource "aws_iam_role_policy" "track_analyzer" {
  name   = "${var.function_name}-permissions"
  role   = aws_iam_role.track_analyzer.id
  policy = data.aws_iam_policy_document.permissions.json
}
