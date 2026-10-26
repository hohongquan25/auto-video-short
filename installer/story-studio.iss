; Bộ cài Story Studio cho khách. Không chạy file này trực tiếp: `pnpm build:retail` dựng thư mục
; ứng dụng rồi gọi Inno Setup với AppVersion, SourceDir, OutputDir và Language (file ngôn ngữ).
; Cài cho riêng người dùng đang đăng nhập (không cần quyền quản trị) vào %LOCALAPPDATA%\Programs.
; Dữ liệu của khách (%LOCALAPPDATA%\Story Studio) không nằm trong thư mục cài, nên cập nhật hay gỡ
; bản cài đều giữ nguyên video, thư viện và khoá bản quyền.

#define AppName "Story Studio"

[Setup]
AppId={{8F6C2B1E-6C1E-4C55-9A35-5D3C1B1F7A10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=StoryStudio-Setup-{#AppVersion}
SetupIconFile={#SourceDir}\story-studio.ico
UninstallDisplayIcon={app}\story-studio.ico
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4

[Languages]
Name: "main"; MessagesFile: "{#Language}"

[Tasks]
Name: "desktopicon"; Description: "Tạo biểu tượng Story Studio trên màn hình Desktop"

[InstallDelete]
; Bản cũ có thể còn thư viện Python hay file giao diện mà bản mới không dùng nữa.
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\dist"
Type: filesandordirs; Name: "{app}\python"

[UninstallDelete]
; Khi chạy, Python tạo thêm thư mục __pycache__ cạnh các module, bộ gỡ cài không tự biết để xoá.
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\python"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\Story Studio.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\story-studio.ico"; Flags: runminimized
Name: "{autoprograms}\Hướng dẫn sử dụng {#AppName}"; Filename: "{app}\HUONG-DAN.txt"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Story Studio.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\story-studio.ico"; Flags: runminimized; Tasks: desktopicon

[Run]
Filename: "{app}\HUONG-DAN.txt"; Description: "Xem hướng dẫn sử dụng"; Flags: postinstall shellexec skipifsilent unchecked
Filename: "{app}\Story Studio.cmd"; WorkingDir: "{app}"; Description: "Mở Story Studio"; Flags: postinstall shellexec nowait runminimized skipifsilent

[Code]
{ Story Studio đang chạy giữ khoá các file trong thư mục cài: tắt nó trước khi cập nhật hoặc gỡ. }
procedure StopRunningCopy();
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.Path -like ''' + ExpandConstant('{app}') + '\*'' } | Stop-Process -Force"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningCopy();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningCopy();
  Result := True;
end;
