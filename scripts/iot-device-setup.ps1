<#
.SYNOPSIS
  Makes the certificate for the simulated home hub and writes iot-pipeline/config.json,
  so iot-pipeline/simulator/sensor_simulator.py can publish to AWS IoT Core.

.DESCRIPTION
  Run once after `cdk deploy` (the stack creates the thing and the policy).
  The private key is written only to iot-pipeline/simulator/certs/, which is gitignored.
  Run with -Remove before `cdk destroy`: CloudFormation can't delete a policy that is
  still attached to a certificate.

.EXAMPLE
  ./scripts/iot-device-setup.ps1
  ./scripts/iot-device-setup.ps1 -Remove
#>
param(
  [string]$ThingName = "aegiscare-sim-hub",
  [string]$PolicyName = "AegisCareSimulatorPolicy",
  [switch]$Remove
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pipeline = Join-Path $root "iot-pipeline"
$certDir = Join-Path $pipeline "simulator\certs"
$arnFile = Join-Path $certDir "certificate-arn.txt"
$certPath = Join-Path $certDir "device.pem.crt"
$keyPath = Join-Path $certDir "device.private.key"
$caPath = Join-Path $certDir "AmazonRootCA1.pem"
$configPath = Join-Path $pipeline "config.json"

function Invoke-Aws {
  $out = & aws @args
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed (exit $LASTEXITCODE)" }
  $out
}

if ($Remove) {
  if (-not (Test-Path $arnFile)) { Write-Host "No certificate recorded in $arnFile; nothing to remove."; return }
  $arn = (Get-Content $arnFile -Raw).Trim()
  $id = $arn.Split("/")[-1]
  Invoke-Aws iot detach-policy --policy-name $PolicyName --target $arn | Out-Null
  Invoke-Aws iot detach-thing-principal --thing-name $ThingName --principal $arn | Out-Null
  Invoke-Aws iot update-certificate --certificate-id $id --new-status INACTIVE | Out-Null
  Invoke-Aws iot delete-certificate --certificate-id $id | Out-Null
  Remove-Item $arnFile
  Write-Host "Certificate $id deactivated and deleted in AWS."
  Write-Host "The local key files in $certDir are now useless; delete them when you like."
  return
}

if (Test-Path $arnFile) { throw "A certificate already exists ($arnFile). Run with -Remove first to replace it." }
New-Item -ItemType Directory -Force $certDir | Out-Null

$arn = Invoke-Aws iot create-keys-and-certificate --set-as-active `
  --certificate-pem-outfile $certPath --private-key-outfile $keyPath `
  --query certificateArn --output text
$arn = "$arn".Trim()
Set-Content -Path $arnFile -Value $arn -Encoding ascii
Write-Host "Created certificate $arn"

Invoke-Aws iot attach-policy --policy-name $PolicyName --target $arn | Out-Null
Invoke-Aws iot attach-thing-principal --thing-name $ThingName --principal $arn | Out-Null
Invoke-WebRequest -UseBasicParsing "https://www.amazontrust.com/repository/AmazonRootCA1.pem" -OutFile $caPath

$endpoint = "$(Invoke-Aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)".Trim()
$region = $env:AWS_REGION
if (-not $region) { $region = $env:AWS_DEFAULT_REGION }
if (-not $region) { $region = "$(aws configure get region)".Trim() }

$config = [ordered]@{
  aws_region   = $region
  iot_endpoint = $endpoint
  root_ca_path = $caPath
  cert_path    = $certPath
  key_path     = $keyPath
} | ConvertTo-Json
# No BOM: Python's json.load rejects one.
[IO.File]::WriteAllText($configPath, $config, (New-Object Text.UTF8Encoding $false))

Write-Host "Wrote $configPath"
Write-Host ""
Write-Host "Send a simulated fall for the demo senior:"
Write-Host "  cd iot-pipeline"
Write-Host "  python simulator/sensor_simulator.py --scenario fall --senior-id snr_demo_rosa"
