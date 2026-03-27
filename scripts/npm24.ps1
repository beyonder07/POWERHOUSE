param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$nodeDir = Join-Path $PSScriptRoot '..\tools\node-v24.14.1-win-x64'
$nodeExe = Join-Path $nodeDir 'node.exe'
$npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'

if (!(Test-Path $nodeExe)) {
  Write-Error "Portable Node runtime not found at $nodeExe"
  exit 1
}

& $nodeExe $npmCli @Args
exit $LASTEXITCODE
