# Grants the Lambda *service* (not your IAM user/role) permission to pull
# from this repo. Without this, CreateFunction fails with:
#   AccessDeniedException: Lambda does not have permission to access the
#   ECR image. Check the ECR permissions.
# ECR repos don't implicitly trust other AWS services to read from them —
# that has to be an explicit resource policy on the repo itself.
#
# The condition's ARN is built from known variables (region, account id,
# function_name), not from aws_lambda_function.track_analyzer.arn — using
# the resource attribute here would create a circular dependency (the
# policy needing the function to exist, and the function needing the
# policy to exist first). Building the same ARN string from inputs we
# already have sidesteps that.
data "aws_iam_policy_document" "ecr_lambda_access" {
  statement {
    sid    = "LambdaECRImageRetrievalPolicy"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:sourceArn"
      values   = ["arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.function_name}"]
    }
  }
}

resource "aws_ecr_repository_policy" "track_analyzer" {
  repository = aws_ecr_repository.track_analyzer.name
  policy     = data.aws_iam_policy_document.ecr_lambda_access.json
}
