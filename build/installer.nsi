; Soterios Custom NSIS Installer Script
; Modern, branded installer with Soterios theme

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"

; ============================================================
; Product Definition
; ============================================================
Name "Soterios"
OutFile "Soterios-Setup-${PRODUCT_VERSION}.exe"
InstallDir "$PROGRAMFILES64\Soterios"
InstallDirRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios" "InstallLocation"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show

!define PRODUCT_NAME "Soterios"
!define PRODUCT_VERSION "1.2.1"
!define PRODUCT_PUBLISHER "Christopher Rivera"

; ============================================================
; Modern UI Configuration
; ============================================================
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninst.ico"

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

!define MUI_CUSTOMFUNCTION_GUIINIT onGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.onGuiInit

; ============================================================
; Installer Pages
; ============================================================
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
  !insertmacro MUI_SETFONT "Segoe UI" 9
FunctionEnd

Function un.onGuiInit
  !insertmacro MUI_SETFONT "Segoe UI" 9
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

  SetOutPath $INSTDIR

  File /r "dist\win-unpacked\*"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios" "DisplayName" "Soterios ${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios" "Publisher" "Chris Rivera"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios" "URLInfoAbout" "https://github.com/chrisriv10/Soterios"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios" "UninstallString" "\"$INSTDIR\uninstall.exe\""
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios" "NoRepair" 1

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\soterios.exe" "" "$INSTDIR\soterios.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\soterios.exe" "Path" "$INSTDIR"
SectionEnd

Section "Start Menu Shortcuts" SecStartMenu
  CreateDirectory "$SMPROGRAMS\Soterios"
  CreateShortCut "$SMPROGRAMS\Soterios\Soterios.lnk" "$INSTDIR\soterios.exe" "" "$INSTDIR\soterios.exe" 0
  CreateShortCut "$SMPROGRAMS\Soterios\Uninstall.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0
  CreateShortCut "$SMPROGRAMS\Soterios\GitHub Repository.lnk" "https://github.com/chrisriv10/Soterios" "" "" 0
SectionEnd

Section "Desktop Shortcut" SecDesktop
  CreateShortCut "$DESKTOP\Soterios.lnk" "$INSTDIR\soterios.exe" "" "$INSTDIR\soterios.exe" 0
SectionEnd

Section "Auto Launch at Startup" SecAutoLaunch
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Soterios" "\"$INSTDIR\soterios.exe\" --minimized"
SectionEnd

Section Uninstall
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\soterios.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Soterios"

  Delete "$SMPROGRAMS\Soterios\*.lnk"
  RMDir "$SMPROGRAMS\Soterios"
  Delete "$DESKTOP\Soterios.lnk"

  RMDir /r "$INSTDIR"

  DeleteRegKey /ifempty HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Soterios"
SectionEnd