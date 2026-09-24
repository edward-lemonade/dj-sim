#!/usr/bin/env bash
# Builds and pushes the Lambda image to the ECR repo Terraform creates.
# Loads AWS_REGION from .env if present, otherwise expects it in the environment.
set -euo pipefail

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

AWS_REGION="${AWS_REGION:?Set AWS_REGION in .env or the environment}"
REPO_NAME="${FUNCTION_NAME:-track-analyzer}"
IMAGE_TAG="${1:-latest}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build -t "$REPO_NAME:$IMAGE_TAG" .
docker tag "$REPO_NAME:$IMAGE_TAG" "$ECR_URI:$IMAGE_TAG"
docker push "$ECR_URI:$IMAGE_TAG"

echo ""
echo "Pushed $ECR_URI:$IMAGE_TAG"
echo "Now run: terraform apply -var image_tag=$IMAGE_TAG"