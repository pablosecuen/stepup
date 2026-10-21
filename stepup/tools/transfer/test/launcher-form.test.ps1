# Prueba del iniciador (formulario + circuito) con datos FICTICIOS y un Supabase de mentira local. No muestra la ventana: ejercita la misma accion del boton «Continuar».
# Variables de la prueba (sin secretos reales): TF_ENV_FILE, TF_TEST_OUT, TF_TEST_EMAIL, TF_TEST_PASSWORD; TF_TEST_FULL=1 incluye el ensayo aislado con Postgres local.
param()
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\Iniciar-traslado.ps1') -NoRun

$failures = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Write-Output "PASS: $name" } else { $script:failures++; Write-Output "FAIL: $name $detail" }
}

$out = $env:TF_TEST_OUT
$full = ($env:TF_TEST_FULL -eq '1')
$node = Find-Node
$state = New-CredentialForm -OutDir $out -EnvFile $env:TF_ENV_FILE -NodePath $node -NoRehearsal:(-not $full)

Check 'la contrasena arranca oculta' ($state.Password.UseSystemPasswordChar -eq $true)
$state.Show.Checked = $true
Check 'la opcion mostrar la contrasena la revela' ($state.Password.UseSystemPasswordChar -eq $false)
$state.Show.Checked = $false
Check 'y se vuelve a ocultar' ($state.Password.UseSystemPasswordChar -eq $true)

$state.Submit()
Check 'sin datos no se ejecuta nada' ($state.Status.Text -like '*Complet*' -and -not $state.Result -and -not (Test-Path -LiteralPath $out))

$state.Email.Text = $env:TF_TEST_EMAIL
$state.Password.Text = 'clave-equivocada-123'
$state.Submit()
Check 'credenciales rechazadas: mensaje claro y el formulario sigue abierto para corregir' ($state.Status.Text -like '*RECHAZ*' -and -not $state.Result -and -not $state.Busy -and $state.Ok.Enabled) $state.Status.Text
Check 'no se creo ninguna carpeta con credenciales rechazadas' (-not (Test-Path -LiteralPath $out))
Check 'el mensaje no repite ni el correo ni la contrasena' (-not ($state.Status.Text.Contains($env:TF_TEST_EMAIL) -or $state.Status.Text.Contains('clave-equivocada-123')))

$state.Password.Text = $env:TF_TEST_PASSWORD
$state.Submit()
Check 'con las credenciales correctas el circuito termina bien' ($state.Result -and $state.Result.ExitCode -eq 0) ("codigo " + $(if ($state.Result) { $state.Result.ExitCode } else { 'sin resultado' }) + ' ' + $state.Status.Text)
Check 'la contrasena y el correo se borran del formulario' ($state.Password.Text -eq '' -and $state.Email.Text -eq '')
Check 'el formulario se cierra con OK' ($state.Form.DialogResult -eq [System.Windows.Forms.DialogResult]::OK)
if ($state.Result) {
  $joined = $state.Result.Summary -join "`n"
  Check 'resumen: copias verificadas' ($joined -like '*COPIAS VERIFICADAS (2)*')
  Check 'resumen: DPAPI aclarado' ($joined -like '*Windows DPAPI*ESTE usuario de Windows*')
  Check 'resumen: Production intacto' ($joined -like '*Production no se modific*')
  if ($full) { Check 'resumen: sin defectos del traslado' ($joined -like '*DEFECTOS DEL TRASLADO: ninguno*'); Check 'resumen: el balance cierra' ($joined -like '*(CIERRA)*') }
  Check 'el resumen no contiene credenciales' (-not ($joined.Contains($env:TF_TEST_PASSWORD) -or $joined.Contains($env:TF_TEST_EMAIL)))
  Write-Output '--- RESUMEN ---'
  $state.Result.Summary | ForEach-Object { Write-Output $_ }
}
$files = @(Get-ChildItem -LiteralPath $out -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
Check 'se crearon las copias DPAPI de origen y destino' (@($files | Where-Object { $_ -like 'origen-dpapi-*.tfdp' }).Count -eq 1 -and @($files | Where-Object { $_ -like 'destino-dpapi-*.tfdp' }).Count -eq 1) ($files -join ', ')
if ($failures -gt 0) { Write-Output "RESULTADO: $failures fallas"; exit 1 }
Write-Output 'RESULTADO: todo bien'
exit 0
