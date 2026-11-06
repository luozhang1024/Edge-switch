"""Run Linux-only bootstrap isolation and archive validation checks over real SSH."""
import base64
from pathlib import Path
import shlex
import subprocess
from workbench.core import Board, Store


def main():
    source = Path('workbench/remote_agent.py').read_bytes()
    script = '''import base64,io,json,tarfile,tempfile,hashlib
from pathlib import Path
ns={'__name__':'edge_test'}
exec(base64.b64decode(SOURCE),ns)
commit='a'*40
upload='b'*32
with tempfile.TemporaryDirectory(prefix='edge-bootstrap-check-') as folder:
    root=Path(folder)/'owner'
    root.mkdir()
    ns['scope']=lambda p: root
    ns['command']=lambda *a,**k: 'node-test'
    agent=root/'.vscode-server'
    agent.mkdir()
    def archive(bad=False):
        path=agent/(commit+'-'+upload+'.tar.gz')
        with tarfile.open(str(path),'w:gz') as tar:
            files={'node':b'node','bin/code-server':b'code','out/server-main.js':b'js',
                   'product.json':json.dumps({'commit':commit}).encode()}
            if bad: files['../../escape']=b'bad'
            for name,data in files.items():
                member=tarfile.TarInfo('server/'+name); member.size=len(data)
                tar.addfile(member,io.BytesIO(data))
        return dict(commit=commit,install=True,upload_id=upload,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    bad=archive(True)
    try: ns['vscode_server'](bad)
    except ValueError: pass
    else: raise AssertionError('traversal accepted')
    payload=archive()
    wrong=dict(payload,sha256='0'*64)
    try: ns['vscode_server'](wrong)
    except RuntimeError: pass
    else: raise AssertionError('bad hash accepted')
    assert ns['vscode_server'](payload)['ready']
    assert ns['vscode_server'](dict(commit=commit))['ready']
    assert not (root/'escape').exists()
    server=root/'.vscode-server/bin'/commit
    (server/'vscode-remote-lock.owner').write_text('preserve')
    (root/'.vscode-server/auth.json').write_text('do-not-copy')
    colleague=Path(folder)/'colleague'
    ns['scope']=lambda p: colleague
    reused=ns['vscode_server'](dict(commit=commit))
    assert reused['ready'] and reused['reused']
    assert not (colleague/'.vscode-server/auth.json').exists()
    assert not (colleague/'.vscode-server/bin'/commit/'vscode-remote-lock.owner').exists()
    assert (server/'vscode-remote-lock.owner').read_text()=='preserve'
print(json.dumps(dict(private_install=True,ready_reuse=True,traversal_rejected=True,bad_hash_rejected=True,existing_board_server_reused_without_auth_or_locks=True)))
'''.replace('SOURCE', repr(base64.b64encode(source).decode()))
    board = Board(Store().profiles[0], 'a9664978d65439f990e5d1a862415002')
    result = subprocess.run([*board.ssh(), 'python3 -'], input=script.encode(), capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace'))
    print(result.stdout.decode())


if __name__ == '__main__':
    main()
