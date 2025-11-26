; Custom NSIS installer script for Notion Tasks Widget
; This creates a scheduled task to run the app at startup with admin rights (no UAC prompt)

!macro customInstall
  ; Create scheduled task to run at login with admin rights
  nsExec::ExecToLog 'schtasks /create /tn "Notion Tasks Widget" /tr "\"$INSTDIR\Notion Tasks Widget.exe\"" /sc onlogon /rl highest /f'
!macroend

!macro customUnInstall
  ; Remove the scheduled task on uninstall
  nsExec::ExecToLog 'schtasks /delete /tn "Notion Tasks Widget" /f'
!macroend

