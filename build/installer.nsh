; Soterios Custom NSIS Installer Include
; Modern, branded installer with Soterios theme

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"

; ============================================================
; Branding & Colors
; ============================================================
!define SOTERIOS_BLUE       0x0969da
!define SOTERIOS_DARK_BLUE  0x0858c4
!define SOTERIOS_BG         0x15202b
!define SOTERIOS_TEXT       0xf2f5f8
!define SOTERIOS_MUTED      0xaab4bf
!define SOTERIOS_BORDER     0x2a3a4a
!define SOTERIOS_OK         0x3fb950
!define SOTERIOS_WARN       0xb54708
!define SOTERIOS_DANGER     0xf85149

; ============================================================
; Modern UI Configuration
; ============================================================
!define MUI_WELCOMEFINISHPAGE_BITMAP "build\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "build\welcome.bmp"

!define MUI_WELCOMEPAGE_TITLE "Welcome to Soterios Setup"
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_WELCOMEPAGE_TEXT "This will install Soterios ${PRODUCT_VERSION} on your computer.\n\nSoterios is a local-first desktop suite for system maintenance, monitoring, and basic security checks.\n\nClick Next to continue."

!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TEXT "Soterios has been successfully installed.\n\nClick Finish to launch Soterios."
!define MUI_FINISHPAGE_RUN "Launch Soterios"
!define MUI_FINISHPAGE_RUN_NOTCHECKED "Don't launch Soterios"

!define MUI_UNFINISHPAGE_TITLE "Uninstallation Complete"
!define MUI_UNFINISHPAGE_TITLE_3LINES
!define MUI_UNFINISHPAGE_TEXT "Soterios has been removed from your computer."

!define MUI_WELCOMEPAGE_SHOW_LICENSE "build/LICENSE.txt"

; Custom font and colors for modern look
!define MUI_CUSTOMFUNCTION_GUIINIT onGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.onGuiInit

; ============================================================
; Installer Pages
; ============================================================
Page custom onWelcomePageCreate onWelcomePageLeave
Page license
Page directory
Page instfiles
Page custom onFinishPageCreate onFinishPageLeave

UninstPage welcome
UninstPage instfiles
UninstPage finish

; ============================================================
; Variables
; ============================================================
Var StartMenuFolder
Var DesktopShortcut
Var AutoLaunch
Var InstallMode
Var PreviousVersion
Var IsUpgrade

; ============================================================
; GUI Initialization - Modern Styling
; ============================================================
Function onGuiInit
  ; Set modern fonts
  !insertmacro MUI_SETFONT "Segoe UI" 9

  ; Custom colors for modern dark theme
  SetCtlColors $R0 $R1 $R2 $R3
  System::Call 'user32::SetSysColors(i 1, i *r0, i *r1) i.r2'
FunctionEnd

Function un.onGuiInit
  !insertmacro MUI_SETFONT "Segoe UI" 9
FunctionEnd

; ============================================================
; Welcome Page - Custom with Soterios branding
; ============================================================
Var WelcomePageHwnd
Var WelcomeBanner
Var WelcomeTitle
Var WelcomeText
Var WelcomeVersion

Function onWelcomePageCreate
  nsDialogs::Create 1018
  Pop $WelcomePageHwnd

  ; Banner area with gradient
  ${NSD_CreateBitmap} 0 0 100% 120 ""
  Pop $WelcomeBanner
  ${NSD_SetImage} $WelcomeBanner "$INSTDIR\build\welcome-banner.bmp"

  ; Title
  ${NSD_CreateLabel} 24 140 100% 24 "Soterios"
  Pop $WelcomeTitle
  SetCtlColors $WelcomeTitle 0xFFFFFF 0x15202B
  SendMessage $WelcomeTitle ${WM_SETFONT} ${__FONT__16_BOLD} 1

  ; Version
  ${NSD_CreateLabel} 24 168 100% 20 "Version ${PRODUCT_VERSION}"
  Pop $WelcomeVersion
  SetCtlColors $WelcomeVersion ${SOTERIOS_MUTED} 0x15202B

  ; Description
  ${NSD_CreateLabel} 24 200 100% 80 "Local-first desktop suite for system maintenance, monitoring, and basic security checks.\n\nSoterios runs entirely on your machine — no cloud, no tracking, no subscriptions."
  Pop $WelcomeText
  SetCtlColors $WelcomeText ${SOTERIOS_MUTED} 0x15202B

  nsDialogs::Show
FunctionEnd

Function onWelcomePageLeave
  ; Check if this is an upgrade
  ReadRegStr $PreviousVersion HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion"
  StrCmp $PreviousVersion "" 0 +2
  StrCpy $IsUpgrade 1
FunctionEnd

; ============================================================
; Directory Page - Custom styling
; ============================================================
Function onDirectoryPageCreate
  ; Style the directory page
  SetCtlColors $1 0xFFFFFF 0x15202B
  SetCtlColors $2 0xFFFFFF 0x15202B
FunctionEnd

; ============================================================
; Install Page - Progress with custom styling
; ============================================================
Function onInstFilesPageCreate
  ; Style progress bar
  SendMessage $R0 ${PBM_SETBARCOLOR} 0 ${SOTERIOS_BLUE}
  SendMessage $R0 ${PBM_SETBKCOLOR} 0 ${SOTERIOS_BG}
FunctionEnd

; ============================================================
; Finish Page - Custom with launch option
; ============================================================
Var FinishPageHwnd
Var FinishBanner
Var FinishTitle
Var FinishText
Var LaunchCheckbox

Function onFinishPageCreate
  nsDialogs::Create 1018
  Pop $FinishPageHwnd

  ${NSD_CreateBitmap} 0 0 100% 120 ""
  Pop $FinishBanner
  ${NSD_SetImage} $FinishBanner "$INSTDIR\build\finish-banner.bmp"

  ${NSD_CreateLabel} 24 140 100% 24 "Soterios Installed Successfully"
  Pop $FinishTitle
  SetCtlColors $FinishTitle 0xFFFFFF 0x15202B
  SendMessage $FinishTitle ${WM_SETFONT} ${__FONT__16_BOLD} 1

  ${NSD_CreateLabel} 24 170 100% 60 "Soterios has been installed on your computer.\nYou can now manage system maintenance, monitor security, and run scans."
  Pop $FinishText
  SetCtlColors $FinishText ${SOTERIOS_MUTED} 0x15202B

  ${NSD_CreateCheckbox} 24 250 100% 24 "Launch Soterios now"
  Pop $LaunchCheckbox
  ${NSD_Check} $LaunchCheckbox

  nsDialogs::Show
FunctionEnd

Function onFinishPageLeave
  ${NSD_GetState} $LaunchCheckbox $AutoLaunch
FunctionEnd

; ============================================================
; Section Definitions
; ============================================================
Section "Main Application" SecMain
  SectionIn RO

  ; Set installation directory
  SetOutPath $INSTDIR

  ; Main executable and resources
  File /r "dist\win-unpacked\*"

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Registry entries for Add/Remove Programs
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName" "${PRODUCT_NAME} ${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "Publisher" "Chris Rivera"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "URLInfoAbout" "https://github.com/chrisriv10/Soterios"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" "\"$INSTDIR\uninstall.exe\""
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoRepair" 1

  ; App Paths for command line access
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\soterios.exe" "" "$INSTDIR\soterios.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\soterios.exe" "Path" "$INSTDIR"

SectionEnd

Section "Start Menu Shortcut" SecStartMenu
  CreateDirectory "$SMPROGRAMS\Soterios"
  CreateShortCut "$SMPROGRAMS\Soterios\Soterios.lnk" "$INSTDIR\soterios.exe" "" "$INSTDIR\soterios.exe" 0
  CreateShortCut "$SMPROGRAMS\Soterios\Uninstall.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0
  CreateShortCut "$SMPROGRAMS\Soterios\GitHub Repository.lnk" "https://github.com/chrisriv10/Soterios" "" "" 0
SectionEnd

Section "Desktop Shortcut" SecDesktop
  CreateShortCut "$DESKTOP\Soterios.lnk" "$INSTDIR\soterios.exe" "" "$INSTDIR\soterios.exe" 0
SectionEnd

Section "Auto Launch" SecAutoLaunch
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Soterios" "\"$INSTDIR\soterios.exe\" --minimized"
SectionEnd

; ============================================================
; Uninstaller
; ============================================================
Function un.onInit
  ; Check if running as admin for proper cleanup
  UserInfo::GetAccountType
  Pop $0
  StrCmp $0 "Admin" 0 +2
  StrCpy $IsAdmin 1
FunctionEnd

Section Uninstall
  ; Remove registry entries
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\soterios.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Soterios"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\Soterios\*.lnk"
  RMDir "$SMPROGRAMS\Soterios"
  Delete "$DESKTOP\Soterios.lnk"

  ; Remove files
  RMDir /r "$INSTDIR"

  ; Remove empty uninstall key if we created it
  DeleteRegKey /ifempty HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
SectionEnd

; ============================================================
; Custom Banner Images (place in build/ folder)
; ============================================================
; welcome.bmp - 500x314px - Welcome page header
; welcome-banner.bmp - 500x120px - Custom welcome page
; finish-banner.bmp - 500x120px - Finish page header

; ============================================================
; Modern Progress Bar Styling
; ============================================================
!macro MUI_CUSTOMFUNCTION_GUIINIT onGuiInit
  ; Already defined above
!macroend