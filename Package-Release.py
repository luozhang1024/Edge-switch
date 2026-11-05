"""Assemble reviewable local release assets; never publish or create Git tags."""
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

from workbench.release import VERSION

ROOT = Path(__file__).resolve().parent


def main():
    if not re.fullmatch(r'\d+\.\d+\.\d+', VERSION):
        raise ValueError('A three-part release version is required')
    output = ROOT / 'dist/release' / ('v' + VERSION)
    output.mkdir(parents=True, exist_ok=True)
    executable = ROOT / ('dist/current/EdgeSwitch-' + VERSION + '.exe')
    setup = ROOT / ('dist/installer/EdgeSwitch-Setup-' + VERSION + '.exe')
    if not executable.is_file() or not setup.is_file():
        raise FileNotFoundError('Build the executable and installer first')
    shutil.copy2(setup, output / setup.name)
    portable = output / ('EdgeSwitch-' + VERSION + '-Windows-x64.zip')
    with zipfile.ZipFile(portable, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(executable, 'EdgeSwitch.exe')
        for name in ('README.md', 'README.en.md', 'LICENSE'):
            archive.write(ROOT / name, name)
        # Keep relative documentation and asset links usable after extraction.
        for folder in ('docs', 'image'):
            for path in sorted((ROOT / folder).rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(ROOT).as_posix())
    source = output / ('EdgeSwitch-' + VERSION + '-source.zip')
    files = subprocess.check_output(
        ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT
    ).decode('utf-8').split('\0')
    allowed_roots = {'workbench', 'installer', 'image', 'docs'}
    prefix = 'EdgeSwitch-' + VERSION + '/'
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(set(files)):
            if not name:
                continue
            path = Path(name)
            if len(path.parts) > 1 and path.parts[0] not in allowed_roots:
                raise ValueError('Review unexpected source directory: ' + name)
            if path.name.lower() in ('profiles.json', 'auth.json', '.env') or path.suffix in ('.key', '.pem'):
                raise ValueError('Credential-like file found in source inputs: ' + name)
            target = ROOT / path
            if target.is_file():
                archive.write(target, prefix + path.as_posix())
    assets = [output / setup.name, portable, source]
    checksums = []
    for path in assets:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        checksums.append(digest + '  ' + path.name)
        print(path.name, path.stat().st_size)
    (output / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='ascii')
    print('Ready for review:', output)


if __name__ == '__main__':
    main()
