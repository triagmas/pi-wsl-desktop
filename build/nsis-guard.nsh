; Pi WSL Desktop — minimal NSIS security guard (M4 R01 security closure,
; owner-approved variant B, Issue #16).
;
; Wired as build.nsis.include, this file is compiled into the preamble and
; only DEFINES three electron-builder hook macros — it does not replace the
; standard lifecycle templates:
;   customInit     — .onInit AFTER initMultiUser (installer.nsi), i.e. with
;                    the final $INSTDIR (a trailing /D= override included)
;                    and BEFORE any file is extracted. Refuses to install
;                    into an existing directory that does not provably belong
;                    to a previous installation of this app.
;   customInstall  — install section after extraction: writes the ownership
;                    marker into $INSTDIR on every install/upgrade.
;   customUnInstall— uninstaller BEFORE any deletion: quits without touching
;                    anything when the marker is missing (fail-safe).
;
; Instruction set intentionally limited: FindFirst/FindNext, FileExists,
; FileOpen/FileWrite (marker only), MessageBox, Abort/Quit. No process
; execution, no registry access, no deletion — enforced by
; tests/unit/nsisGuardContract.test.ts.
!ifndef PI_DESKTOP_NSIS_GUARD
!define PI_DESKTOP_NSIS_GUARD

; Ownership marker file written into $INSTDIR by customInstall.
!define INSTALL_MARKER ".pi-desktop-install-marker"

!macro customInit
  ; $INSTDIR is final here (initMultiUser already applied /D=).
  IfFileExists "$INSTDIR\${INSTALL_MARKER}" guard_dir_allowed 0
  ; Marker missing: allow only a non-existent directory. For an existing
  ; directory require it to be completely empty (".", ".." entries only) —
  ; an existing non-empty folder is foreign (e.g. a /D= override) and is
  ; rejected before any file operation.
  ClearErrors
  FindFirst $R9 $R8 "$INSTDIR\*"
  IfErrors guard_dir_allowed
  guard_init_entry:
    StrLen $R7 $R8
    IntCmp $R7 1 guard_init_next 0 0            ; "." → skip
    IntCmp $R7 2 0 guard_init_foreign 0
    StrCmp $R8 ".." guard_init_next guard_init_foreign
  guard_init_next:
    ClearErrors
    FindNext $R9 $R8
    IfErrors guard_init_empty
    Goto guard_init_entry
  guard_init_empty:
    FindClose $R9
    Goto guard_dir_allowed
  guard_init_foreign:
    FindClose $R9
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Pi WSL Desktop refuses to install into a non-empty folder that is not a previous Pi WSL Desktop installation.$\r$\n$\r$\nFolder: $INSTDIR"
    ${EndIf}
    Abort "install directory rejected (not empty, no install marker): $INSTDIR"
  guard_dir_allowed:
!macroend

!macro customInstall
  ; Runs after the application files are extracted (installSection.nsh) —
  ; recording ownership so a later uninstall can prove it.
  ClearErrors
  FileOpen $R6 "$INSTDIR\${INSTALL_MARKER}" w
  IfErrors guard_marker_skip
  FileWrite $R6 "${APP_ID} ${VERSION}"
  FileClose $R6
  guard_marker_skip:
!macroend

!macro customUnInstall
  ; Runs before the default deletion path (uninstaller.nsh). Without the
  ; marker the directory cannot be proven to belong to this app (tampered,
  ; partially removed or foreign state) — quit BEFORE anything is deleted.
  ${IfNot} ${FileExists} "$INSTDIR\${INSTALL_MARKER}"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Pi WSL Desktop uninstall refused: the install folder has no ownership marker, so nothing will be deleted.$\r$\n$\r$\nFolder: $INSTDIR"
    ${EndIf}
    Quit
  ${EndIf}
!macroend

!endif
