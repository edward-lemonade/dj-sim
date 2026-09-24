output "function_name" {
  value = aws_lambda_function.track_analyzer.function_name
}

output "function_arn" {
  value = aws_lambda_function.track_analyzer.arn
}

output "ecr_repository_url" {
  value = aws_ecr_repository.track_analyzer.repository_url
}
