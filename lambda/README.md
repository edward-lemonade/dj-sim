# track-analyzer Lambda

Container-image Lambda that computes a single BPM, beat-grid offset, and key
for a track. Callable two ways against the same code path:

1. **S3 upload trigger** — fires automatically on `ObjectCreated`.
2. **Manual invoke** — your backend calls it directly via `lambda:Invoke`
   with `{"bucket": "...", "key": "..."}`.

## Layout

```
handler.py                       # Lambda code
Dockerfile / requirements.txt    # container image
build_and_push.sh                # builds & pushes the image to ECR
.env.example                     # copy to .env — region, bucket, function name
terraform/
  versions.tf                    # provider + AWS account lookup
  variables.tf                   # all inputs, incl. bucket_name
  ecr.tf                         # image repository
  ecr_policy.tf                  # grants the Lambda *service* (not your IAM user) pull access
  iam.tf                         # execution role, least-privilege policy
  lambda.tf                      # the function itself
  s3.tf                          # permission + bucket notification (trigger)
  outputs.tf
  terraform.tfvars.example       # copy to terraform.tfvars — NOT committed
```

`bucket_name` and everything else environment-specific live in
`terraform.tfvars` / `.env`, both gitignored — only the `.example` files are
committed.

## Permissions for whoever runs `terraform apply`

The deploying IAM user needs its own permissions — separate from, and
broader than, the execution role in `iam.tf` (that one governs what the
*running Lambda* can touch at invoke time; this governs what *you* can
provision). `terraform-deploy-policy.json` at the repo root covers the
IAM-role and S3 pieces, scoped tightly since unrestricted `iam:PassRole` or
`s3:*` are real privilege-escalation / blast-radius risks. For ECR and
Lambda and CloudWatch Logs — where broad access isn't a privilege-escalation
vector — attach the AWS managed policies instead of hand-maintaining more
custom JSON:

```bash
aws iam attach-user-policy --user-name YOUR_USER \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess
aws iam attach-user-policy --user-name YOUR_USER \
  --policy-arn arn:aws:iam::aws:policy/AWSLambda_FullAccess
aws iam attach-user-policy --user-name YOUR_USER \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess

aws iam create-policy --policy-name terraform-deploy \
  --policy-document file://terraform-deploy-policy.json
aws iam attach-user-policy --user-name YOUR_USER \
  --policy-arn arn:aws:iam::ACCOUNT_ID:policy/terraform-deploy
```

Note: `AWSLambda_FullAccess` bundles its own `iam:PassRole` (any role, but
only to `lambda.amazonaws.com`). Since IAM permissions are additive across
attached policies, this makes `terraform-deploy-policy.json`'s
role-scoped `PassRole` statement non-restrictive once both are attached —
the user can pass any role to Lambda, not just `track-analyzer-role`. Skip
`AWSLambda_FullAccess` and use a function-scoped `lambda:*` statement in
the custom policy instead if that distinction matters to you.

## Bootstrap order

Terraform provisions AWS resources; it doesn't build the container image.
The Lambda resource needs an image to already exist at its `image_uri`, and
the ECR repo needs to exist before you can push to it — so it's a two-pass
apply the first time:

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars   # fill in your values
cp .env.example .env                                                # fill in your values

cd terraform
terraform init
terraform apply -target=aws_ecr_repository.track_analyzer   # create just the repo

cd ..
./build_and_push.sh latest

cd terraform
terraform apply                                              # everything else
```

Every subsequent deploy (new image, same infra) is just:

```bash
./build_and_push.sh v2
terraform apply -var image_tag=v2
```

## GitHub Actions deployment

The `Deploy track analyzer Lambda` workflow runs `terraform plan` for pull
requests that change `lambda/`. After changes reach `main`, it creates the ECR
repository if needed, builds and pushes a commit-tagged image, then plans and
applies the remaining infrastructure. The workflow uses the separate
`lambda/prod/terraform.tfstate` key so it does not refresh or alter the
development deployment tracked at the default backend key. Configure the
GitHub AWS credentials with access to that state bucket and lock file, ECR,
Lambda, and the resources managed by this Terraform configuration.

Configure these GitHub repository secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `BACKEND_WEBHOOK_API_KEY` (optional; should match the backend setting)

Configure these GitHub repository variables:

- `AWS_REGION` (Lambda/ECR deployment region; defaults to `us-west-2`)
- `LAMBDA_BUCKET_NAME` (required)
- `LAMBDA_TRACK_PREFIX` (optional; defaults to `tracks/`)
- `LAMBDA_RESULTS_PREFIX` (optional; defaults to `analysis`)
- `LAMBDA_RESULTS_BUCKET_NAME` (optional; defaults to the track bucket)
- `LAMBDA_FUNCTION_NAME` (optional; defaults to `track-analyzer`)
- `LAMBDA_IAM_ROLE_NAME` (optional; defaults to `track-analyzer-prod-role`)
- `BACKEND_WEBHOOK_URL` (optional)

The Terraform state backend is fixed to `us-west-1` in `terraform/backend.tf`,
so the credentials also need access to that region's state bucket.
Pull-request plans use a temporary image tag; the image is built and pushed
only by the `main` deployment job. IAM role names are account-wide, so
production uses its own role name to coexist with the development role even
though both deployments use `track-analyzer` as the Lambda function name.

`build_and_push.sh` builds with `--provenance=false --sbom=false`. Without
those, current Docker/BuildKit attaches attestation manifests on push,
which turns the image into a multi-manifest OCI index that Lambda's
`CreateFunction` can't resolve — it fails with "the image manifest, config
or layer media type ... is not supported." Don't drop those flags if you
ever hand-roll a build command outside the script.

## Manual invoke from your backend

```python
import boto3, json

lambda_client = boto3.client("lambda")

response = lambda_client.invoke(
    FunctionName="track-analyzer",
    InvocationType="RequestResponse",  # synchronous — waits for the result
    Payload=json.dumps({
        "bucket": "YOUR_BUCKET",
        "key": "tracks/song.mp3",
        "trackId": "abc123",  # optional, echoed back in the result
    }).encode(),
)
result = json.loads(response["Payload"].read())
print(result)
# {"bpm": 128.03, "grid_offset_sec": 0.0464, "key": "A minor", ...}
```

Use `InvocationType="Event"` if the backend shouldn't block — then read the
result back from `s3://YOUR_BUCKET/analysis/tracks/song.mp3.json` (or via
`backend_webhook_url` in tfvars), same as the S3-triggered path does.

## Notes

- Memory (3008 MB) and timeout (300s) are set generously for chroma/beat
  analysis on full-length tracks — tune down once you've measured real
  timings for your file sizes.
- `s3.tf` assumes `bucket_name` already exists (managed elsewhere, or
  created by another stack) and only attaches a notification to it. Say so
  if you'd rather Terraform own the bucket too.
- S3 only allows one suffix filter per notification block, so there's one
  `lambda_function` block per extension in `s3.tf` — add more for formats
  beyond mp3/wav.