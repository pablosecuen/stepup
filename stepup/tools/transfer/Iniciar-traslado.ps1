# Iniciador del ensayo del traslado (Windows): pide TUS credenciales UNA vez en un formulario (contraseña oculta, con opción de mostrarla) y ejecuta todo el circuito:
# verificar conexión e inicio de sesión → exportar origen y destino → cifrar con Windows DPAPI y comprobar la recuperación desde el disco → ensayo aislado → resultado breve.
#
# Las credenciales viven sólo en memoria: pasan al proceso de Node por su ENTRADA ESTÁNDAR (nunca por argumentos, variables de entorno ni archivos).
# No cambia ni restablece contraseñas, no cierra la sesión del teléfono, no migra ni importa nada en Production y no borra nada. Se lanza con Iniciar-traslado.cmd.
param([switch]$NoRun, [switch]$SinEnsayo, [ValidateSet('ensayo', 'traslado')] [string]$Modo = 'ensayo', [string]$AppDir = '', [string]$ExtraArgs = '')
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Find-EnvFile {
  $candidates = @()
  if ($env:TF_ENV_FILE) { $candidates += $env:TF_ENV_FILE }
  $candidates += (Join-Path $script:RepoRoot '.env.local')
  $candidates += (Join-Path $env:USERPROFILE 'OneDrive\Desktop\teachpagina\stepup\stepup\.env.local')
  foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}

function Find-Node {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'No se encontró Node.js en este equipo (node.exe).' }
  $version = (& $cmd.Source -p 'process.versions.node').Trim()
  if ([version]($version.Split('-')[0]) -lt [version]'22.6.0') { throw "Hace falta Node.js 22.6 o más nuevo (tenés $version)." }
  return $cmd.Source
}

# Ejecuta el circuito en Node. Las credenciales entran por la entrada estándar y se sueltan. Devuelve el resultado; los eventos se reportan por los bloques indicados.
function Invoke-Transfer {
  param(
    [Parameter(Mandatory)] [string]$Email,
    [Parameter(Mandatory)] [string]$Password,
    [Parameter(Mandatory)] [string]$OutDir,
    [Parameter(Mandatory)] [string]$EnvFile,
    [Parameter(Mandatory)] [string]$NodePath,
    [switch]$NoRehearsal,
    [string]$ScriptName = 'run-transfer.mjs',
    [string]$ExtraArguments = '',
    [scriptblock]$OnLine = { param($text) },
    [scriptblock]$OnAuthFail = { param($kind, $message) },
    [scriptblock]$OnAuthOk = { }
  )
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodePath
  $arguments = '"' + (Join-Path $script:RepoRoot ('tools\transfer\' + $ScriptName)) + '" "' + $OutDir + '"'
  if ($NoRehearsal) { $arguments += ' --sin-ensayo' }
  if ($ExtraArguments) { $arguments += ' ' + $ExtraArguments }
  $psi.Arguments = $arguments
  $psi.WorkingDirectory = $script:RepoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $psi.EnvironmentVariables['TF_ENV_FILE'] = $EnvFile
  # Con la consola en UTF-8 (chcp 65001) .NET antepone una marca BOM a la entrada del proceso hijo y el JSON llegaría alterado: se fija una codificación sin BOM (Node además la tolera).
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)

  $process = [System.Diagnostics.Process]::Start($psi)
  $errTask = $process.StandardError.ReadToEndAsync()
  $json = ConvertTo-Json -InputObject @{ email = $Email; password = $Password } -Compress
  $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json)
  $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $process.StandardInput.BaseStream.Flush()
  $process.StandardInput.BaseStream.Close()
  $json = $null
  [Array]::Clear($bytes, 0, $bytes.Length)

  $summary = New-Object System.Collections.Generic.List[string]
  $authFailed = $false
  while ($true) {
    $task = $process.StandardOutput.ReadLineAsync()
    while (-not $task.IsCompleted) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 40
    }
    $line = $task.Result
    if ($null -eq $line) { break }
    if ($line.StartsWith('@@AUTH_FAIL|')) {
      $parts = $line.Substring(12).Split([char[]]@('|'), 2)
      $authFailed = $true
      $null = & $OnAuthFail $parts[0] $parts[1]
    } elseif ($line -eq '@@AUTH_OK') {
      $null = & $OnAuthOk
    } elseif ($line.StartsWith('@@SUMMARY|')) {
      $summary.Add($line.Substring(10))
    } else {
      $null = & $OnLine $line
    }
  }
  $process.WaitForExit()
  $stderr = ''
  if ($errTask.Wait(2000)) { $stderr = $errTask.Result }
  return [pscustomobject]@{ ExitCode = $process.ExitCode; AuthFailed = $authFailed; Summary = $summary.ToArray(); StdErr = $stderr }
}

# Formulario de credenciales: devuelve un objeto con el formulario y el estado. `Submit` es la acción del botón «Continuar» (también la usan las pruebas).
function New-CredentialForm {
  param([string]$OutDir, [string]$EnvFile, [string]$NodePath, [switch]$NoRehearsal, [string]$Mode = 'ensayo', [string]$ExtraArguments = '')
  $form = New-Object System.Windows.Forms.Form
  $form.Text = if ($Mode -eq 'traslado') { 'TeacherFlow · Traslado a la web (una sola vez)' } else { 'TeacherFlow · Ensayo del traslado' }
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true
  $form.ClientSize = New-Object System.Drawing.Size(470, 390)
  $font = New-Object System.Drawing.Font('Segoe UI', 9.5)
  $form.Font = $font

  function Add-Control($control, $x, $y, $w, $h) {
    $control.Location = New-Object System.Drawing.Point($x, $y)
    $control.Size = New-Object System.Drawing.Size($w, $h)
    $form.Controls.Add($control)
    return $control
  }
  $intro = Add-Control (New-Object System.Windows.Forms.Label) 16 12 438 56
  $intro.Text = 'Ingresá los datos de TU cuenta de la web. Se usan una sola vez, sólo quedan en memoria y la contraseña no se guarda ni se muestra (salvo que lo pidas). No se cambia nada de la cuenta ni se cierra la sesión del teléfono.'
  $lblEmail = Add-Control (New-Object System.Windows.Forms.Label) 16 78 438 20
  $lblEmail.Text = 'Correo de la cuenta'
  $txtEmail = Add-Control (New-Object System.Windows.Forms.TextBox) 16 100 438 26
  $lblPass = Add-Control (New-Object System.Windows.Forms.Label) 16 136 438 20
  $lblPass.Text = 'Contraseña'
  $txtPass = Add-Control (New-Object System.Windows.Forms.TextBox) 16 158 438 26
  $txtPass.UseSystemPasswordChar = $true
  $chkShow = Add-Control (New-Object System.Windows.Forms.CheckBox) 16 190 300 24
  $chkShow.Text = 'Mostrar contraseña'
  $status = Add-Control (New-Object System.Windows.Forms.Label) 16 220 438 112
  $status.Text = ''
  $btnOk = Add-Control (New-Object System.Windows.Forms.Button) 262 346 96 30
  $btnOk.Text = 'Continuar'
  $btnCancel = Add-Control (New-Object System.Windows.Forms.Button) 366 346 88 30
  $btnCancel.Text = 'Cancelar'
  $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $form.AcceptButton = $btnOk
  $form.CancelButton = $btnCancel

  $state = [pscustomobject]@{ Form = $form; Email = $txtEmail; Password = $txtPass; Show = $chkShow; Status = $status; Ok = $btnOk; Result = $null; Busy = $false }
  $state | Add-Member -MemberType NoteProperty -Name Settings -Value @{ OutDir = $OutDir; EnvFile = $EnvFile; NodePath = $NodePath; NoRehearsal = [bool]$NoRehearsal; ScriptName = $(if ($Mode -eq 'traslado') { 'execute-transfer.mjs' } else { 'run-transfer.mjs' }); ExtraArguments = $ExtraArguments }

  $chkShow.Add_CheckedChanged({ $txtPass.UseSystemPasswordChar = -not $chkShow.Checked }.GetNewClosure())

  $state | Add-Member -MemberType ScriptMethod -Name Submit -Value {
    if ($this.Busy) { return }
    $email = $this.Email.Text.Trim()
    $password = $this.Password.Text
    if (-not $email -or -not $password) {
      $this.Status.ForeColor = [System.Drawing.Color]::FromArgb(160, 30, 30)
      $this.Status.Text = '✗ Completá el correo y la contraseña.'
      return
    }
    $this.Busy = $true
    $this.Ok.Enabled = $false
    $this.Status.ForeColor = [System.Drawing.Color]::FromArgb(40, 40, 40)
    $this.Status.Text = '… Verificando la conexión y el inicio de sesión.'
    $self = $this
    $settings = $this.Settings
    try {
      $result = Invoke-Transfer -Email $email -Password $password -OutDir $settings.OutDir -EnvFile $settings.EnvFile -NodePath $settings.NodePath -NoRehearsal:$settings.NoRehearsal -ScriptName $settings.ScriptName -ExtraArguments $settings.ExtraArguments `
        -OnLine ({ param($text) Write-Host $text }.GetNewClosure()) `
        -OnAuthFail ({
          param($kind, $message)
          $self.Status.ForeColor = [System.Drawing.Color]::FromArgb(160, 30, 30)
          $self.Status.Text = '✗ ' + $message
          if ($kind -eq 'credentials') { $self.Password.SelectAll(); $self.Password.Focus() }
        }.GetNewClosure()) `
        -OnAuthOk ({
          $self.Status.ForeColor = [System.Drawing.Color]::FromArgb(20, 110, 40)
          $self.Status.Text = '✓ Sesión iniciada. Seguí el avance en la ventana de comandos.'
          $self.Password.Text = ''
          $self.Email.Text = ''
          $self.Form.Hide()
        }.GetNewClosure())
      if (-not $result.AuthFailed) {
        $this.Result = $result
        $this.Form.DialogResult = [System.Windows.Forms.DialogResult]::OK
      }
    } catch {
      $this.Status.ForeColor = [System.Drawing.Color]::FromArgb(160, 30, 30)
      $this.Status.Text = '✗ No se pudo ejecutar el circuito: ' + $_.Exception.Message
    } finally {
      $password = $null
      $this.Busy = $false
      $this.Ok.Enabled = $true
    }
  }
  $btnOk.Add_Click({ $state.Submit() }.GetNewClosure())
  return $state
}

function Show-Summary {
  param($Result)
  Write-Host ''
  Write-Host '================ RESULTADO ================' -ForegroundColor Cyan
  foreach ($line in $Result.Summary) { Write-Host ('• ' + $line) }
  if ($Result.ExitCode -eq 0) {
    Write-Host '✓ Circuito completo: copias verificadas y ensayo sin diferencias.' -ForegroundColor Green
  } elseif ($Result.ExitCode -eq 20) {
    Write-Host '✗ El circuito se detuvo (ver arriba el motivo). Lo hecho hasta ahí está a salvo y se puede repetir.' -ForegroundColor Yellow
  } elseif ($Result.ExitCode -eq 30) {
    Write-Host '✗ El circuito terminó pero el traslado NO está completo (ver arriba).' -ForegroundColor Yellow
  } else {
    Write-Host ('✗ El circuito terminó con un error (código ' + $Result.ExitCode + ').') -ForegroundColor Red
    if ($Result.StdErr) { Write-Host ($Result.StdErr.Trim() -split "`n" | Select-Object -First 3) }
  }
  Write-Host '===========================================' -ForegroundColor Cyan
}

function Start-Launcher {
  $envFile = Find-EnvFile
  if (-not $envFile) { throw 'No encontré el archivo .env.local con la URL y la clave pública de Supabase. Definí TF_ENV_FILE con su ruta y volvé a abrir el iniciador.' }
  $nodePath = Find-Node
  $outDir = Join-Path $env:USERPROFILE 'TeacherFlow-copias-privadas'
  Write-Host 'TeacherFlow · Ensayo del traslado' -ForegroundColor Cyan
  Write-Host ('Carpeta de las copias: ' + $outDir)
  Write-Host 'Ingresá tus datos en la ventana del formulario…'
  $extra = $ExtraArgs
  if ($Modo -eq 'traslado') {
    $app = if ($AppDir) { $AppDir } elseif ($env:TF_APP_DIR) { $env:TF_APP_DIR } else { Join-Path $env:USERPROFILE 'Downloads\aca va tdo\TeacherFlow_NuevaClase\TeacherFlow' }
    if (-not (Test-Path -LiteralPath (Join-Path $app 'src\features\transfer\PhoneTransferEntry.tsx'))) { throw 'No encontré la carpeta de la app con el parche de traslado (src\features\transfer). Indicala con -AppDir o TF_APP_DIR.' }
    $extra = ('--app "' + $app + '" ' + $ExtraArgs).Trim()
    Write-Host ('App del teléfono: ' + $app)
  }
  $state = New-CredentialForm -OutDir $outDir -EnvFile $envFile -NodePath $nodePath -NoRehearsal:$SinEnsayo -Mode $Modo -ExtraArguments $extra
  $dialog = $state.Form.ShowDialog()
  if ($dialog -ne [System.Windows.Forms.DialogResult]::OK -or -not $state.Result) {
    Write-Host 'Cancelado: no se hizo nada.' -ForegroundColor Yellow
    return 1
  }
  Show-Summary -Result $state.Result
  $text = ($state.Result.Summary -join "`r`n`r`n")
  [void][System.Windows.Forms.MessageBox]::Show($text, 'TeacherFlow · Resultado del ensayo', 'OK', 'Information')
  return $state.Result.ExitCode
}

if (-not $NoRun) {
  try {
    $code = Start-Launcher
  } catch {
    Write-Host ('✗ ' + $_.Exception.Message) -ForegroundColor Red
    $code = 1
  }
  exit $code
}
