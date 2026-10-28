# Track analyzer and recording waveform Lambdas

Container-image Lambdas that share one image and ECR repository:

- `track-analyzer` computes a single BPM, beat-grid offset, and key for a
  track. It supports the existing S3 upload and manual invocation paths.
- `recording-waveform` generates a versioned, fixed-size waveform sidecar for
  MP3 recordings under `recordings/`. It is invoked by S3 and may also be
  invoked directly for backfill.

## Layout

```
track_analyzer/                  # track analysis Lambda package
  __init__.py
  handler.py
recording_waveform/              # recording peak generation Lambda package
  __init__.py
  handler.py
scripts/
  backfill_waveforms.py          # rate-limited backfill for old recordings
Dockerfile / requirements.txt    # container image
build_and_push.sh                # builds & pushes the image to ECR
.env.example                     # copy to .env — region, bucket, function name
terraform/
  versions.tf                    # provider + AWS account lookup
  variables.tf                   # all inputs, incl. bucket_name
  ecr.tf                         # image repository
  ecr_policy.tf                  # grants the Lambda *service* (not your IAM user) pull access
  iam.tf / lambda.tf             # separate execution roles and functions
  s3.tf                          # permissions + combined bucket notifications
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

## Backfill existing recordings

After deploying the waveform Lambda and configuring the backend waveform
webhook, the script can first list MP3s missing sidecars without changing
anything:

```bash
python scripts/backfill_waveforms.py \
  --bucket YOUR_BUCKET \
  --function recording-waveform
```

Run the backfill explicitly with `--execute`. It invokes one object at a time,
skips recordings with an existing `.waveform.json` sidecar, and waits one
second between jobs by default:

```bash
python scripts/backfill_waveforms.py \
  --bucket YOUR_BUCKET \
  --function recording-waveform \
  --execute
```

If a sidecar was written but its backend state callback failed, reprocess
existing sidecars to replay the callback:

```bash
python scripts/backfill_waveforms.py \
  --bucket YOUR_BUCKET \
  --function recording-waveform \
  --execute \
  --force
```

Use the Lambda function's deployed name if it differs from the default. The
AWS identity running the script needs permission to list and inspect objects
under the recordings prefix and synchronously invoke that Lambda.

## Backend webhook URLs

Both callback URLs point to the backend's internal webhook routes and use the
same `BACKEND_WEBHOOK_API_KEY` bearer secret when configured:

- `BACKEND_ANALYSIS_WEBHOOK_URL`: `{backend-origin}/internal/tracks/analysis`
- `BACKEND_WAVEFORM_WEBHOOK_URL`: `{backend-origin}/internal/recordings/waveform`

For example, if the deployed backend is reachable at
`https://api.example.com`, set:

```hcl
backend_analysis_webhook_url = "https://api.example.com/internal/tracks/analysis"
backend_waveform_webhook_url = "https://api.example.com/internal/recordings/waveform"
backend_webhook_api_key      = "the-same-value-as-backend-BACKEND_WEBHOOK_API_KEY"
```

The backend reads `BACKEND_WEBHOOK_API_KEY` from its environment (see
`backend/.env.example`). Set the same secret in Terraform if either URL is enabled so the Lambdas send
the expected `Authorization: Bearer ...` header. The URLs are optional:
without them, the backend polls S3 for the analysis results and waveform
sidecars, so the shared key alone does not require public webhook URLs. Keep
the secret out of committed files.

An AWS Lambda cannot reach a backend at `localhost` on your development
machine. To send callbacks to a locally running backend, start the backend on
port 8080 and expose that port through an HTTPS tunnel, then use the tunnel's
public origin with the same route paths. For example, with Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:8080
```

Use the HTTPS URL printed by the tunnel, such as
`https://random-name.trycloudflare.com/internal/recordings/waveform`, as the
waveform URL. Set the analysis URL similarly if track analysis callbacks
should also reach the local backend. Keep the tunnel running while testing;
its URL may change when restarted. Do not use a public tunnel for sensitive
production traffic.

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
- `LAMBDA_RECORDINGS_PREFIX` (optional; defaults to `recordings/`)
- `LAMBDA_RESULTS_PREFIX` (optional; defaults to `analysis`)
- `LAMBDA_RESULTS_BUCKET_NAME` (optional; defaults to the track bucket)
- `LAMBDA_FUNCTION_NAME` (optional; defaults to `track-analyzer`)
- `LAMBDA_WAVEFORM_FUNCTION_NAME` (optional; defaults to `recording-waveform`)
- `LAMBDA_IAM_ROLE_NAME` (optional; defaults to `track-analyzer-prod-role`)
- `LAMBDA_WAVEFORM_IAM_ROLE_NAME` (optional; defaults to `recording-waveform-prod-role`)
- `BACKEND_ANALYSIS_WEBHOOK_URL` (optional; `{backend-origin}/internal/tracks/analysis`)
- `BACKEND_WAVEFORM_WEBHOOK_URL` (optional; `{backend-origin}/internal/recordings/waveform`)

The Terraform state backend is fixed to `us-west-1` in `terraform/backend.tf`,
so the credentials also need access to that region's state bucket.
Pull-request plans use a temporary image tag; the image is built and pushed
only by the `main` deployment job. IAM role names are account-wide, so
production uses its own role name to coexist with the development role even
though both deployments use `track-analyzer` as the Lambda function name.

`build_and_push.sh` builds both handlers into one image with
`--provenance=false --sbom=false`. Terraform selects the handler using each
function's `image_config.command`. Without those flags, current Docker/BuildKit attaches attestation manifests on push,
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
        "key": "tracks/YOUR_USER_ID/song-UUID.mp3",
        "trackId": "abc123",  # optional, echoed back in the result
    }).encode(),
)
result = json.loads(response["Payload"].read())
print(result)
# {"bpm": 128.03, "grid_offset_sec": 0.0464, "key": "A minor", ...}
```

Use `InvocationType="Event"` if the backend shouldn't block — then read the
result back from
`s3://YOUR_BUCKET/analysis/tracks/YOUR_USER_ID/song-UUID.mp3.json` (or via
`backend_analysis_webhook_url` in tfvars), same as the S3-triggered path does. The
Lambda treats the source key as opaque, so user-scoped track keys require no
Lambda environment-variable or notification-filter changes.

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