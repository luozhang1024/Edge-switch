import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from workbench.core import Board, Profile, open_vscode, vscode_connection_report
from workbench.remote_agent import vscode_server
from workbench.vscode_server import download_server

COMMIT = 'a' * 40


class ServerTests(unittest.TestCase):
    def archive(self, root, malicious=False):
        upload_id = 'b' * 32
        archive = root / (COMMIT + '-' + upload_id + '.tar.gz')
        root.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, 'w:gz') as tar:
            files = {'node': b'node', 'bin/code-server': b'code', 'out/server-main.js': b'js',
                     'product.json': json.dumps({'commit': COMMIT}).encode()}
            if malicious:
                files['../../escape'] = b'bad'
            for name, content in files.items():
                info = tarfile.TarInfo('server/' + name)
                info.size = len(content)
                tar.addfile(info, io.BytesIO(content))
        return dict(commit=COMMIT, install=True, upload_id=upload_id,
                    sha256=hashlib.sha256(archive.read_bytes()).hexdigest())

    @unittest.skipIf(__import__('os').name == 'nt', 'fcntl tested on Linux board')
    def test_private_install_and_reuse_do_not_touch_shared_server(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            payload = self.archive(root / 'vscode-server')
            with patch('workbench.remote_agent.scope', return_value=root), patch('workbench.remote_agent.command'):
                self.assertTrue(vscode_server(payload)['ready'])
                self.assertTrue(vscode_server(dict(commit=COMMIT))['ready'])

    @unittest.skipIf(__import__('os').name == 'nt', 'fcntl tested on Linux board')
    def test_archive_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            payload = self.archive(root / 'vscode-server', malicious=True)
            with patch('workbench.remote_agent.scope', return_value=root), patch('workbench.remote_agent.command'):
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    vscode_server(payload)
            self.assertFalse((root / 'vscode-server/bin' / COMMIT).exists())

    def test_verified_cache_works_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / (COMMIT + '-arm64.tar.gz')
            path.write_bytes(b'verified')
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            path.with_suffix('.json').write_text(json.dumps(dict(size=8, sha256=sha)))
            with patch('workbench.vscode_server.subprocess.Popen') as download:
                self.assertEqual(download_server(COMMIT, 'arm64', folder, True, 7890, lambda s: None), (path, sha))
            download.assert_not_called()

    def test_parallel_download_merges_and_verifies_official_hash(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            content = b'official-server'
            sha = hashlib.sha256(content).hexdigest()
            def metadata(args, **kwargs):
                Path(args[args.index('-D') + 1]).write_text('X-SHA256: ' + sha + '\nContent-Length: ' + str(len(content)))
                return subprocess.CompletedProcess(args, 0, b'https://cdn.example/server', b'')
            def chunk(args, **kwargs):
                Path(args[args.index('-o') + 1]).write_bytes(content)
                Path(args[args.index('-D') + 1]).write_text('Content-Range: bytes 0-%d/%d' % (len(content) - 1, len(content)))
                process = MagicMock(returncode=0)
                process.poll.return_value = 0
                return process
            with patch('workbench.vscode_server.shutil.which', return_value='curl'), \
                 patch('workbench.vscode_server.subprocess.run', side_effect=metadata), \
                 patch('workbench.vscode_server.subprocess.Popen', side_effect=chunk):
                archive, checksum = download_server(COMMIT, 'arm64', folder, True, 7890, lambda s: None)
            self.assertEqual(checksum, sha)
            self.assertEqual(archive.read_bytes(), content)

    def test_download_failure_keeps_completed_chunks_without_promoting_cache(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            content = b'x' * (1024 ** 2)
            sha = 'c' * 64
            def metadata(args, **kwargs):
                Path(args[args.index('-D') + 1]).write_text('X-SHA256: ' + sha + '\nContent-Length: ' + str(len(content) + 1))
                return subprocess.CompletedProcess(args, 0, b'https://cdn.example/server', b'')
            def chunk(args, **kwargs):
                path = Path(args[args.index('-o') + 1])
                success = args[args.index('--range') + 1].startswith('0-')
                path.write_bytes(content if success else b'')
                if success:
                    Path(args[args.index('-D') + 1]).write_text('Content-Range: bytes 0-1048575/1048577')
                process = MagicMock(returncode=0 if success else 28)
                process.poll.return_value = process.returncode
                return process
            with patch('workbench.vscode_server.shutil.which', return_value='curl'), \
                 patch('workbench.vscode_server.subprocess.run', side_effect=metadata), \
                 patch('workbench.vscode_server.subprocess.Popen', side_effect=chunk):
                with self.assertRaises(RuntimeError):
                    download_server(COMMIT, 'arm64', folder, True, 7890, lambda s: None)
            self.assertTrue(next(Path(folder).glob('*.parts/0')).exists())
            self.assertFalse(list(Path(folder).glob('*.tar.gz')))

    def test_timeout_resumes_inside_chunk_and_switches_route(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            content = b'123456'
            sha = hashlib.sha256(content).hexdigest()
            requests = []
            def metadata(args, **kwargs):
                Path(args[args.index('-D') + 1]).write_text('X-SHA256: ' + sha + '\nContent-Length: 6')
                return subprocess.CompletedProcess(args, 0, b'https://cdn.example/server', b'')
            def chunk(args, **kwargs):
                requests.append(args)
                first = len(requests) == 1
                Path(args[args.index('-o') + 1]).write_bytes(content[:2] if first else content[2:])
                Path(args[args.index('-D') + 1]).write_text('Content-Range: bytes %d-5/6' % (0 if first else 2))
                process = MagicMock(returncode=28 if first else 0)
                process.poll.return_value = process.returncode
                return process
            with patch('workbench.vscode_server.shutil.which', return_value='curl'), \
                 patch('workbench.vscode_server.subprocess.run', side_effect=metadata), \
                 patch('workbench.vscode_server.subprocess.Popen', side_effect=chunk):
                archive, _ = download_server(COMMIT, 'arm64', folder, True, 7890, lambda s: None)
            self.assertEqual(archive.read_bytes(), content)
            self.assertEqual(requests[1][requests[1].index('--range') + 1], '2-5')
            self.assertIn('--proxy', requests[0])
            self.assertNotIn('--proxy', requests[1])

    def test_window_opens_before_remote_extension_install(self):
        with tempfile.TemporaryDirectory() as folder:
            board = MagicMock(profile=Profile(protocol='responses'), scope='b' * 32)
            board.ssh.return_value = ['ssh.exe']
            board.call.side_effect = [dict(flock=True), dict(cli='/private/codex')]
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                return __import__('subprocess').CompletedProcess(args, 0, b'ms-vscode-remote.remote-ssh\n', b'')
            with patch('workbench.editor_runtime.editor_for', return_value=('Code.exe', 'cli.js', {}, COMMIT)), \
                 patch('workbench.vscode_server.prepare_server', return_value=dict(path='/private/server', ready=True)), \
                 patch('workbench.core.subprocess.run', side_effect=run):
                open_vscode(board, folder, api=dict(key='private-key'))
            window = next(i for i, args in enumerate(calls) if '--reuse-window' in args)
            extension = next(i for i, args in enumerate(calls) if 'openai.chatgpt' in args)
            self.assertLess(window, extension)
            settings = json.loads((Path(folder) / 'User/settings.json').read_text())
            self.assertEqual(settings['remote.SSH.serverInstallPath'], {'edge-' + 'b' * 32: '/private/server'})
            self.assertNotIn('private-key', json.dumps(settings))

    def test_download_failure_report_is_specific(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'logs/now/window1/exthost/output_logging_1/Remote - SSH.log'
            log.parent.mkdir(parents=True)
            log.write_text('Downloading VS Code server locally...\nLocalDownloadFailed (Failed to fetch)')
            self.assertIn('电脑下载', vscode_connection_report(folder)['message'])


if __name__ == '__main__':
    unittest.main()
