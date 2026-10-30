<#
.SYNOPSIS
  Vérifie les artefacts d'une release Relay : signatures Authenticode des installeurs
  Windows et présence des artefacts d'updater (.sig).

.EXAMPLE
  powershell -NoProfile -File scripts/verify-release.ps1
  powershell -NoProfile -File scripts/verify-release.ps1 -BundleDir src-tauri/target/release/bundle
#>
param(
  [string]$BundleDir = "src-tauri/target/release/bundle"
)

$ErrorActionPreference = "Stop"
$failures = 0

$installers = Get-ChildItem -Path $BundleDir -Recurse -Include *.exe, *.msi -File
if (-not $installers) {
  Write-Error "Aucun installeur trouvé dans $BundleDir (lancez d'abord pnpm app:build)."
}

foreach ($file in $installers) {
  $sig = Get-AuthenticodeSignature -FilePath $file.FullName
  $signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "(aucun)" }
  # « Valid » avec un certificat de confiance ; « UnknownError » avec un certificat auto-signé
  # (signature présente mais chaîne non approuvée) ; « NotSigned » = problème.
  $signed = $sig.Status -ne "NotSigned" -and $null -ne $sig.SignerCertificate
  $mark = if ($signed) { "OK " } else { "KO "; $failures++ }
  Write-Host ("{0} {1,-40} statut={2,-14} signataire={3}" -f $mark, $file.Name, $sig.Status, $signer)

  $sigFile = "$($file.FullName).sig"
  if (Test-Path $sigFile) {
    Write-Host ("    artefact updater : {0} ({1} octets)" -f (Split-Path $sigFile -Leaf), (Get-Item $sigFile).Length)
  }
}

if ($failures -gt 0) {
  Write-Error "$failures installeur(s) non signé(s)."
}
Write-Host "Tous les installeurs sont signés."
