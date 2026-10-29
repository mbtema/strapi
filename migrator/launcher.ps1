# Этап 3 Bitrix -> Strapi. Запуск с рабочего стола Windows.
# По умолчанию dry-run. Для записи: -Apply -Confirm 959725
param(
    [switch]$Apply,
    [string]$Confirm
)

$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$importer = Join-Path $desktop 'importer.mjs'
$csv = Join-Path $desktop 'migration-matched.csv'
$tempImporter = Join-Path $desktop 'importer.download.mjs'
$rawUrl = 'https://raw.githubusercontent.com/mbtema/strapi/main/migrator/importer.mjs'

if (-not (Test-Path -LiteralPath $csv -PathType Leaf)) {
    throw "Положи migration-matched.csv на рабочий стол: $csv"
}
if (-not (Test-Path -LiteralPath $importer -PathType Leaf)) {
    throw "Положи importer.mjs со встроенными JWT/Cookie на рабочий стол: $importer"
}
if ($Apply -and $Confirm -notmatch '^\d+$') {
    throw 'Для записи требуются -Apply -Confirm <BitrixID>'
}

# Берём JWT/Cookie из уже настроенного локального importer.mjs.
# Это единственное место хранения авторизации; отдельные файлы не нужны.
$localCode = [System.IO.File]::ReadAllText($importer)
function Get-LocalJsonString([string]$key) {
    $regex = '(?m)^\s*' + [regex]::Escape($key) + '\s*:\s*("(?:\\.|[^"\\])*")\s*,?\s*$'
    $found = [regex]::Match($localCode, $regex)
    if (-not $found.Success) {
        throw "Не найден $key в importer.mjs. Используй готовую локальную версию со встроенными JWT/Cookie."
    }
    $json = $found.Groups[1].Value
    $value = ConvertFrom-Json -InputObject $json
    if ([string]::IsNullOrWhiteSpace($value) -or $value -like '__LOCAL_*') {
        throw "В importer.mjs не заполнен $key"
    }
    return $json
}
$jwt = Get-LocalJsonString 'strapiJwt'
$cookie = Get-LocalJsonString 'bitrixCookie'

Push-Location $desktop
try {
    # На каждом запуске берём актуальную версию кода из GitHub,
    # сохраняя встроенные JWT/Cookie из рабочего файла пользователя.
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $rawUrl -UseBasicParsing -OutFile $tempImporter
        $code = [System.IO.File]::ReadAllText($tempImporter)
        if (-not $code.Contains('"__LOCAL_STRAPI_JWT__"') -or
            -not $code.Contains('"__LOCAL_BITRIX_COOKIE__"')) {
            throw 'В GitHub изменился формат авторизации importer.mjs; остановлено без изменений'
        }
        $code = $code.Replace('"__LOCAL_STRAPI_JWT__"', $jwt)
        $code = $code.Replace('"__LOCAL_BITRIX_COOKIE__"', $cookie)
        [System.IO.File]::WriteAllText(
            $tempImporter, $code, (New-Object System.Text.UTF8Encoding($false))
        )
        & node --check $tempImporter
        if ($LASTEXITCODE -ne 0) {
            throw 'Проверка синтаксиса importer.mjs не прошла'
        }
        Move-Item -LiteralPath $tempImporter -Destination $importer -Force
        Write-Host '[Launcher] importer.mjs обновлён из GitHub; авторизация сохранена локально'
    }
    finally {
        if (Test-Path -LiteralPath $tempImporter) {
            Remove-Item -LiteralPath $tempImporter -Force
        }
    }

    if (-not (Test-Path -LiteralPath (Join-Path $desktop 'node_modules\cheerio\package.json'))) {
        Write-Host '[Launcher] Устанавливаю cheerio...'
        $env:NODE_OPTIONS = '--use-system-ca'
        & npm.cmd install cheerio --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) {
            throw 'Не удалось установить cheerio'
        }
    }

    $nodeArgs = @('--use-system-ca', $importer)
    if ($Apply) {
        $nodeArgs += '--apply'
        $nodeArgs += "--confirm=$Confirm"
        Write-Host "[Launcher] APPLY для Bitrix ID $Confirm"
    }
    else {
        Write-Host '[Launcher] DRY-RUN'
    }

    & node @nodeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Importer завершился с кодом $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
