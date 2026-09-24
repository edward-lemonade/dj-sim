data "aws_s3_bucket" "source" {
  bucket = var.bucket_name
}

resource "aws_lambda_permission" "allow_s3" {
  statement_id   = "AllowS3Invoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.track_analyzer.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = data.aws_s3_bucket.source.arn
  source_account = data.aws_caller_identity.current.account_id
}

# One block per file extension you accept — S3 only allows a single suffix
# filter per lambda_function block. Add more blocks for other formats.
resource "aws_s3_bucket_notification" "track_upload" {
  bucket = data.aws_s3_bucket.source.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.track_analyzer.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = var.track_prefix
    filter_suffix       = ".mp3"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.track_analyzer.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = var.track_prefix
    filter_suffix       = ".wav"
  }

  depends_on = [aws_lambda_permission.allow_s3]
}
