; Custom NSIS hooks for the assisted installer (included by electron-builder).
; electron-builder builds with -WX, so every function and variable here must be
; referenced in the build (installer or uninstaller) that defines it.

!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh

  LangString relayShortcutsTitle 1033 "Shortcuts"
  LangString relayShortcutsTitle 1049 "Ярлыки"
  LangString relayShortcutsSubtitle 1033 "Choose where to create shortcuts for ${PRODUCT_NAME}."
  LangString relayShortcutsSubtitle 1049 "Выберите, где создать ярлыки ${PRODUCT_NAME}."
  LangString relayDesktopShortcutLabel 1033 "Create a desktop shortcut"
  LangString relayDesktopShortcutLabel 1049 "Создать ярлык на рабочем столе"
  LangString relayStartMenuShortcutLabel 1033 "Create a Start menu shortcut"
  LangString relayStartMenuShortcutLabel 1049 "Создать ярлык в меню «Пуск»"
!endif

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Var relayShortcutDefaultsSet
    Var relayDesktopShortcut
    Var relayStartMenuShortcut
    Var relayDesktopCheckbox
    Var relayStartMenuCheckbox

    ; Must run before the old version is uninstalled: afterwards its registry
    ; keys are gone and existing shortcuts can no longer be told apart.
    Function relayInitShortcutDefaults
      ${if} $relayShortcutDefaultsSet == "1"
        Return
      ${endif}
      StrCpy $relayShortcutDefaultsSet "1"
      StrCpy $relayDesktopShortcut "1"
      StrCpy $relayStartMenuShortcut "1"

      ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${if} $R0 != ""
        ; Reinstall/upgrade: preserve whatever the user kept last time.
        ${ifNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
          StrCpy $relayDesktopShortcut "0"
        ${endif}
        ${ifNot} ${FileExists} "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
          StrCpy $relayStartMenuShortcut "0"
        ${endif}
      ${endif}

      ${if} ${isNoDesktopShortcut}
        StrCpy $relayDesktopShortcut "0"
      ${endif}
    FunctionEnd

    Function relayShortcutsPageCreate
      ; The install mode page has already set the shell context by now.
      Call relayInitShortcutDefaults
      ${if} ${isUpdated}
        Abort
      ${endif}

      !insertmacro MUI_HEADER_TEXT "$(relayShortcutsTitle)" "$(relayShortcutsSubtitle)"

      nsDialogs::Create 1018
      Pop $0
      ${if} $0 == error
        Abort
      ${endif}

      ${NSD_CreateCheckbox} 0 0 100% 12u "$(relayDesktopShortcutLabel)"
      Pop $relayDesktopCheckbox
      ${if} $relayDesktopShortcut == "1"
        ${NSD_Check} $relayDesktopCheckbox
      ${endif}

      ${NSD_CreateCheckbox} 0 20u 100% 12u "$(relayStartMenuShortcutLabel)"
      Pop $relayStartMenuCheckbox
      ${if} $relayStartMenuShortcut == "1"
        ${NSD_Check} $relayStartMenuCheckbox
      ${endif}

      nsDialogs::Show
    FunctionEnd

    Function relayShortcutsPageLeave
      ${NSD_GetState} $relayDesktopCheckbox $0
      ${if} $0 == ${BST_CHECKED}
        StrCpy $relayDesktopShortcut "1"
      ${else}
        StrCpy $relayDesktopShortcut "0"
      ${endif}

      ${NSD_GetState} $relayStartMenuCheckbox $0
      ${if} $0 == ${BST_CHECKED}
        StrCpy $relayStartMenuShortcut "1"
      ${else}
        StrCpy $relayStartMenuShortcut "0"
      ${endif}
    FunctionEnd
  !endif
!macroend

!macro customInit
  ; Silent installs never show the page, so resolve defaults up front.
  ${if} ${Silent}
    Call relayInitShortcutDefaults
  ${endif}
!macroend

!macro customPageAfterChangeDir
  Page custom relayShortcutsPageCreate relayShortcutsPageLeave
!macroend

; Shortcut creation is disabled in electron-builder.yml, so the stock
; install/uninstall sections skip it entirely and these hooks own it.
!macro customInstall
  !ifdef MENU_FILENAME
    CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
  !endif

  ${if} $relayStartMenuShortcut == "1"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    StrCpy $launchLink "$newStartMenuLink"
  ${else}
    WinShell::UninstShortcut "$newStartMenuLink"
    Delete "$newStartMenuLink"
  ${endif}

  ${if} $relayDesktopShortcut == "1"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${else}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
  ${endif}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; An upgrade runs the old uninstaller with --keep-shortcuts; the new
  ; installer then applies the user's current choice.
  ${ifNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
    WinShell::UninstShortcut "$oldStartMenuLink"
    Delete "$oldStartMenuLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endIf}
!macroend
