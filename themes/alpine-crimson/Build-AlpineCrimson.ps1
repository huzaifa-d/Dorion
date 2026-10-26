param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$cssPath = Join-Path $PSScriptRoot 'alpine-crimson.css'
$imagePath = Join-Path $PSScriptRoot 'wallpaper.jpg'

foreach ($inputPath in @($cssPath, $imagePath)) {
    if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
        throw "Required theme input is missing: $inputPath"
    }
}

$fullOutput = [System.IO.Path]::GetFullPath($OutputPath)
if ($fullOutput -eq $cssPath -or $fullOutput -eq $imagePath) {
    throw 'The output path must not overwrite a theme source file.'
}

$image = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($imagePath))
$css = [System.IO.File]::ReadAllText($cssPath)
$backgroundRule = ":root { --alpine-background: url('data:image/jpeg;base64,$image'); }"
$package = $css + [Environment]::NewLine + $backgroundRule + [Environment]::NewLine
$outputDirectory = [System.IO.Path]::GetDirectoryName($fullOutput)
$null = New-Item -ItemType Directory -Path $outputDirectory -Force
[System.IO.File]::WriteAllText(
    $fullOutput,
    $package,
    [System.Text.UTF8Encoding]::new($false)
)
Write-Output "Packaged Alpine Crimson: $fullOutput"
