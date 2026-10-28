output "function_name" {
  value = aws_lambda_function.track_analyzer.function_name
}

output "function_arn" {
  value = aws_lambda_function.track_analyzer.arn
}

output "waveform_function_name" {
  value = aws_lambda_function.recording_waveform.function_name
}

output "waveform_function_arn" {
  value = aws_lambda_function.recording_waveform.arn
}

output "ecr_repository_url" {
  value = aws_ecr_repository.track_analyzer.repository_url
}
