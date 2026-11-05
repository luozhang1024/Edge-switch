#define AppVersion "0.15.0"

[Setup]
AppId={{4E8B46D3-9164-4831-A164-38CB76378A9E}
AppName=Edge AI
AppVersion={#AppVersion}
AppPublisher=luozhang
LicenseFile=..\LICENSE
DefaultDirName={localappdata}\Programs\Edge AI
DefaultGroupName=Edge AI
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=EdgeAI-Setup-{#AppVersion}
SetupIconFile=..\image\EdgeAI.ico
UninstallDisplayIcon={app}\EdgeAI.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\dist\current\EdgeSSHAI-0.15.exe"; DestDir: "{app}"; DestName: "EdgeAI.exe"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; DestName: "README.txt"; Flags: ignoreversion

[Icons]
Name: "{group}\Edge AI"; Filename: "{app}\EdgeAI.exe"; AppUserModelID: "EdgeSSHAI.Workbench"
Name: "{group}\Uninstall Edge AI"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Edge AI"; Filename: "{app}\EdgeAI.exe"; Tasks: desktopicon; AppUserModelID: "EdgeSSHAI.Workbench"

[Run]
Filename: "{app}\EdgeAI.exe"; Description: "Launch Edge AI"; Flags: nowait postinstall skipifsilent
