#define AppVersion "1.0.1"

[Setup]
AppId={{4E8B46D3-9164-4831-A164-38CB76378A9E}
AppName=Edge Switch
AppVersion={#AppVersion}
AppPublisher=luozhang
LicenseFile=..\LICENSE
DefaultDirName={localappdata}\Programs\Edge Switch
DefaultGroupName=Edge Switch
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=EdgeSwitch-Setup-{#AppVersion}
SetupIconFile=..\image\EdgeAI.ico
UninstallDisplayIcon={app}\EdgeSwitch.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#AppVersion}
AppCopyright=Copyright (C) 2026 luozhang
AppPublisherURL=https://github.com/luozhang52/Edge-switch
AppSupportURL=https://github.com/luozhang52/Edge-switch/issues
AppUpdatesURL=https://github.com/luozhang52/Edge-switch/releases

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\dist\current\EdgeSwitch-1.0.1.exe"; DestDir: "{app}"; DestName: "EdgeSwitch.exe"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; DestName: "README.txt"; Flags: ignoreversion
Source: "..\README.en.md"; DestDir: "{app}"; DestName: "README.en.txt"; Flags: ignoreversion

[Icons]
Name: "{group}\Edge Switch"; Filename: "{app}\EdgeSwitch.exe"; AppUserModelID: "EdgeSSHAI.Workbench"
Name: "{group}\Uninstall Edge Switch"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Edge Switch"; Filename: "{app}\EdgeSwitch.exe"; Tasks: desktopicon; AppUserModelID: "EdgeSSHAI.Workbench"

[Run]
Filename: "{app}\EdgeSwitch.exe"; Description: "Launch Edge Switch"; Flags: nowait postinstall skipifsilent
