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

  LangString relayPacksTitle 1033 "Feature packs"
  LangString relayPacksTitle 1049 "Комплекты возможностей"
  LangString relayPacksSubtitle 1033 "Pick what ${PRODUCT_NAME} should switch on at first launch. Everything here can be turned on or off later in Settings."
  LangString relayPacksSubtitle 1049 "Выберите, что включить при первом запуске ${PRODUCT_NAME}. Всё это можно включить или выключить позже в настройках."
  LangString relayPackWebsocket 1033 "WebSocket"
  LangString relayPackWebsocket 1049 "WebSocket"
  LangString relayPackSse 1033 "Server-Sent Events"
  LangString relayPackSse 1049 "Server-Sent Events"
  LangString relayPackSocketio 1033 "Socket.IO"
  LangString relayPackSocketio 1049 "Socket.IO"
  LangString relayPackMqtt 1033 "MQTT"
  LangString relayPackMqtt 1049 "MQTT"
  LangString relayPackGrpc 1033 "gRPC"
  LangString relayPackGrpc 1049 "gRPC"
  LangString relayPackAi 1033 "AI assistant"
  LangString relayPackAi 1049 "AI-ассистент"
  LangString relayPackAuth 1033 "Advanced authorization (Digest, JWT, OAuth 1.0, AWS, NTLM…)"
  LangString relayPackAuth 1049 "Продвинутая авторизация (Digest, JWT, OAuth 1.0, AWS, NTLM…)"
  LangString relayPackLanguages 1033 "Extra interface languages (German, Spanish)"
  LangString relayPackLanguages 1049 "Дополнительные языки интерфейса (немецкий, испанский)"
  LangString relayPackPanes 1033 "Extra panes (up to 16 instead of 4)"
  LangString relayPackPanes 1049 "Дополнительные панели (до 16 вместо 4)"
  LangString relayPackBackup 1033 "Extra backup formats (SQLite, ZIP)"
  LangString relayPackBackup 1049 "Дополнительные форматы резервных копий (SQLite, ZIP)"
  LangString relayPackSnippets 1033 "Script snippets (ready-made tests for every HTTP method)"
  LangString relayPackSnippets 1049 "Сниппеты для скриптов (готовые тесты для каждого метода HTTP)"
  LangString relayPackThemes 1033 "Theme pack (Postman, Insomnia, Dracula, Nord and more)"
  LangString relayPackThemes 1049 "Пак тем оформления (Postman, Insomnia, Dracula, Nord и другие)"
  LangString relayPackCodegen 1033 "More code-generation languages (Node, Go, Java, C#, PHP and others)"
  LangString relayPackCodegen 1049 "Больше языков генерации кода (Node, Go, Java, C#, PHP и другие)"
!endif

!ifdef BUILD_UNINSTALLER
  LangString relayRemoveDataQuestion 1033 "Also delete ${PRODUCT_NAME} data (collections, environments, history, settings and saved keys) from$\r$\n$APPDATA\${PRODUCT_NAME}?$\r$\n$\r$\nChoose No to keep it for a future installation."
  LangString relayRemoveDataQuestion 1049 "Удалить также данные ${PRODUCT_NAME} (коллекции, окружения, историю, настройки и сохранённые ключи) из$\r$\n$APPDATA\${PRODUCT_NAME}?$\r$\n$\r$\nВыберите «Нет», чтобы сохранить их для следующей установки."
!endif

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    ; Picking "for all users" makes NSIS relaunch itself elevated, and the fresh
    ; instance runs .onInit again — which is why the language was asked twice.
    ; MUI skips its language dialog when this registry value is set, so the
    ; outer instance stores the answer (customInit) and the elevated one reads
    ; it. electron-builder never inserts MUI_LANGDLL_SAVELANGUAGE, so nothing
    ; else writes this value and preInit clears it for every new install.
    !define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
    !define MUI_LANGDLL_REGISTRY_KEY "${INSTALL_REGISTRY_KEY}"
    !define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

    Var relayShortcutDefaultsSet
    Var relayDesktopShortcut
    Var relayStartMenuShortcut
    Var relayDesktopCheckbox
    Var relayStartMenuCheckbox

    ; One checkbox per feature pack; $relayPacks collects the chosen ids.
    Var relayPackWebsocketBox
    Var relayPackSseBox
    Var relayPackSocketioBox
    Var relayPackMqttBox
    Var relayPackGrpcBox
    Var relayPackAiBox
    Var relayPackAuthBox
    Var relayPackLanguagesBox
    Var relayPackPanesBox
    Var relayPackBackupBox
    Var relayPackSnippetsBox
    Var relayPackThemesBox
    Var relayPackCodegenBox
    Var relayPacks
    Var relayPacksChosen

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

    ; Every pack ships on disk; this page only decides which ones are ENABLED on
    ; first launch. Nothing is pre-checked — the base app is HTTP only.
    Function relayPacksPageCreate
      ${if} ${isUpdated}
        Abort
      ${endif}

      !insertmacro MUI_HEADER_TEXT "$(relayPacksTitle)" "$(relayPacksSubtitle)"

      nsDialogs::Create 1018
      Pop $0
      ${if} $0 == error
        Abort
      ${endif}

      ${NSD_CreateCheckbox} 0 0u 100% 10u "$(relayPackWebsocket)"
      Pop $relayPackWebsocketBox
      ${NSD_CreateCheckbox} 0 10u 100% 10u "$(relayPackSse)"
      Pop $relayPackSseBox
      ${NSD_CreateCheckbox} 0 20u 100% 10u "$(relayPackSocketio)"
      Pop $relayPackSocketioBox
      ${NSD_CreateCheckbox} 0 30u 100% 10u "$(relayPackMqtt)"
      Pop $relayPackMqttBox
      ${NSD_CreateCheckbox} 0 40u 100% 10u "$(relayPackGrpc)"
      Pop $relayPackGrpcBox
      ${NSD_CreateCheckbox} 0 50u 100% 10u "$(relayPackAi)"
      Pop $relayPackAiBox
      ${NSD_CreateCheckbox} 0 60u 100% 10u "$(relayPackAuth)"
      Pop $relayPackAuthBox
      ${NSD_CreateCheckbox} 0 70u 100% 10u "$(relayPackLanguages)"
      Pop $relayPackLanguagesBox
      ${NSD_CreateCheckbox} 0 80u 100% 10u "$(relayPackPanes)"
      Pop $relayPackPanesBox
      ${NSD_CreateCheckbox} 0 90u 100% 10u "$(relayPackBackup)"
      Pop $relayPackBackupBox
      ${NSD_CreateCheckbox} 0 100u 100% 10u "$(relayPackSnippets)"
      Pop $relayPackSnippetsBox
      ${NSD_CreateCheckbox} 0 110u 100% 10u "$(relayPackThemes)"
      Pop $relayPackThemesBox
      ${NSD_CreateCheckbox} 0 120u 100% 10u "$(relayPackCodegen)"
      Pop $relayPackCodegenBox

      nsDialogs::Show
    FunctionEnd

    ; Append `id` (on the stack) to $relayPacks when its checkbox is ticked.
    Function relayCollectPack
      Exch $1 ; id
      Exch
      Exch $2 ; checkbox handle
      ${NSD_GetState} $2 $0
      ${if} $0 == ${BST_CHECKED}
        ${if} $relayPacks == ""
          StrCpy $relayPacks "$\"$1$\""
        ${else}
          StrCpy $relayPacks "$relayPacks,$\"$1$\""
        ${endif}
      ${endif}
      Pop $2
      Pop $1
    FunctionEnd

    ; NSIS cannot define a macro inside a macro, so the per-pack calls are
    ; spelled out (checkbox handle, then id, then the collector).
    Function relayPacksPageLeave
      StrCpy $relayPacks ""
      Push $relayPackWebsocketBox
      Push "websocket"
      Call relayCollectPack
      Push $relayPackSseBox
      Push "sse"
      Call relayCollectPack
      Push $relayPackSocketioBox
      Push "socketio"
      Call relayCollectPack
      Push $relayPackMqttBox
      Push "mqtt"
      Call relayCollectPack
      Push $relayPackGrpcBox
      Push "grpc"
      Call relayCollectPack
      Push $relayPackAiBox
      Push "ai-assistant"
      Call relayCollectPack
      Push $relayPackAuthBox
      Push "advanced-auth"
      Call relayCollectPack
      Push $relayPackLanguagesBox
      Push "extra-languages"
      Call relayCollectPack
      Push $relayPackPanesBox
      Push "extra-panes"
      Call relayCollectPack
      Push $relayPackBackupBox
      Push "backup-formats"
      Call relayCollectPack
      Push $relayPackSnippetsBox
      Push "script-snippets"
      Call relayCollectPack
      Push $relayPackThemesBox
      Push "theme-pack"
      Call relayCollectPack
      Push $relayPackCodegenBox
      Push "codegen-languages"
      Call relayCollectPack
      StrCpy $relayPacksChosen "1"
    FunctionEnd
  !endif
!macroend

; Runs at the very top of .onInit, BEFORE MUI shows the language dialog.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ; Only the elevated child may inherit a language: whoever starts the
    ; installer is always asked, including on a reinstall.
    ${IfNot} ${UAC_IsInnerInstance}
      DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" "Installer Language"
    ${EndIf}
  !endif
!macroend

!macro customInit
  ; Hand the chosen language to the elevated instance that "for all users"
  ; spawns later, so it does not ask again. Written here because the elevation
  ; happens on the install-mode page, which comes after .onInit.
  ${IfNot} ${UAC_IsInnerInstance}
    WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "Installer Language" "$LANGUAGE"
  ${EndIf}

  ; Silent installs never show the pages, so resolve defaults up front.
  ${if} ${Silent}
    Call relayInitShortcutDefaults
  ${endif}
!macroend

!macro customPageAfterChangeDir
  Page custom relayShortcutsPageCreate relayShortcutsPageLeave
  Page custom relayPacksPageCreate relayPacksPageLeave
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

  ; Hand the app the two decisions taken here: the installer language becomes
  ; the UI language, and the ticked packs are switched on at first launch.
  ; The app reads this file once per install (see src/main/features/install.ts).
  ${if} $LANGUAGE == 1049
    StrCpy $0 "ru"
  ${else}
    StrCpy $0 "en"
  ${endif}
  ; On a silent or update install no page is shown; `chosen` stays "0" and the
  ; app keeps whatever it is already configured with instead of being reset.
  ${ifNot} $relayPacksChosen == "1"
    StrCpy $relayPacks ""
    StrCpy $relayPacksChosen "0"
  ${endif}
  ClearErrors
  FileOpen $1 "$INSTDIR\install-config.json" w
  ${ifNot} ${Errors}
    ; The app tells installs apart by this file's modification time, so no id
    ; needs to be generated here.
    FileWrite $1 '{"version":"${VERSION}","chosen":"$relayPacksChosen","locale":"$0","packs":[$relayPacks]}'
    FileClose $1
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

  Delete "$INSTDIR\install-config.json"
  DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" "Installer Language"

  ; A real uninstall (not an upgrade) offers to remove the user's data as well.
  ; Silent uninstalls keep it: losing collections and keys must never be the
  ; unattended default.
  ${ifNot} ${isUpdated}
    ; $APPDATA follows the shell context, and a per-machine uninstall runs with
    ; it set to "all users" — pointing at ProgramData, which holds none of our
    ; data. Electron always writes under the user's Roaming folder, so ask
    ; about that one. (This is why the question never appeared after an
    ; install "for all users".)
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    ${if} ${FileExists} "$APPDATA\${PRODUCT_NAME}\*.*"
      MessageBox MB_YESNO|MB_ICONQUESTION "$(relayRemoveDataQuestion)" /SD IDNO IDNO relayKeepData
        RMDir /r "$APPDATA\${PRODUCT_NAME}"
      relayKeepData:
    ${endif}
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endIf}
!macroend
