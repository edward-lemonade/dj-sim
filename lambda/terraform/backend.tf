terraform {
  backend "s3" {
    bucket       = "lemonade-dj-sim-terraform-state"
    key          = "lambda/terraform.tfstate"
    region       = "us-west-1"
    use_lockfile = true
    encrypt      = true
  }
}
