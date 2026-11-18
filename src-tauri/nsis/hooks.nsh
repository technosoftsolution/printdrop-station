; PrintDrop NSIS Installer & Uninstaller Hooks
; 1. Pre-Install / Pre-Uninstall: Terminate lingering child processes (cloudflared.exe, SumatraPDF.exe)
;    so Windows never throws "Error opening file for writing" during upgrades or reinstalls.
; 2. Post-Uninstall: Automatically notifies the Supabase Cloud Registry when PrintDrop is uninstalled
;    so the Admin Portal marks the machine as Uninstalled (decrementing active count)
;    while preserving the station's license & payment history for future reinstalls.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM cloudflared.exe /T'
  nsExec::Exec 'taskkill /F /IM SumatraPDF.exe /T'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM cloudflared.exe /T'
  nsExec::Exec 'taskkill /F /IM SumatraPDF.exe /T'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$$p='HKCU:\Software\PrintDrop'; $$h=(Get-ItemProperty -Path $$p -Name Hwid -EA SilentlyContinue).Hwid; $$u=(Get-ItemProperty -Path $$p -Name SupabaseUrl -EA SilentlyContinue).SupabaseUrl; $$k=(Get-ItemProperty -Path $$p -Name SupabaseKey -EA SilentlyContinue).SupabaseKey; if($$h -and $$u -and $$k){ $$b=@{is_installed=$$false;uninstalled_at=(Get-Date).ToUniversalTime().ToString('o');removal_reason='Self-Uninstalled via Windows'}|ConvertTo-Json -Compress; $$hd=@{apikey=$$k;Authorization='Bearer '+$$k;'Content-Type'='application/json'}; try{ Invoke-RestMethod -Uri ($$u+'/rest/v1/licenses?hwid=eq.'+$$h) -Method Patch -Headers $$hd -Body $$b -TimeoutSec 3 | Out-Null }catch{} }"`
!macroend
