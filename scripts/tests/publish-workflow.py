"""Run the workflow's actual verifier and publish shell against an isolated local Git remote."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile
import yaml

root = Path(__file__).resolve().parents[2]
workflow = yaml.load((root / '.github/workflows/publish-test.yml').read_text(), Loader=yaml.BaseLoader)
steps = workflow['jobs']['publish']['steps']
verify = next(step['run'] for step in steps if step.get('shell') == 'python')
publish = next(step['run'] for step in steps if step.get('working-directory') == 'publisher')
source = 'a' * 40

def run(args, cwd, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    return result.stdout.strip()

def fixture(folder, number):
    folder.mkdir(parents=True)
    content = b'console.log("frontend")'
    manifest = dict(schema=1, channel='test', buildId=f'test-workflow-{number}', version=f'0.1.3-test.{number}',
                    sourceCommit=source, sourceDirty=False, createdAt='2026-10-25T00:00:00.000Z',
                    files=[dict(path='assets/index.js', size=len(content), sha256=hashlib.sha256(content).hexdigest())])
    archive = folder / 'swipyrss.zip'
    with zipfile.ZipFile(archive, 'w') as z:
        z.writestr('build-manifest.json', json.dumps(manifest))
        z.writestr('assets/index.js', content)
    latest = {k: v for k, v in manifest.items() if k != 'files'}
    latest['package'] = dict(file='swipyrss.zip', size=archive.stat().st_size, sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
    (folder / 'latest.json').write_text(json.dumps(latest))

with tempfile.TemporaryDirectory(prefix='swipyrss-publish-') as temp:
    temp = Path(temp)
    remote = temp / 'remote.git'
    run(['git', 'init', '--bare', str(remote)], temp)
    seed = temp / 'seed'
    run(['git', 'init', '-b', 'dev', str(seed)], temp)
    run(['git', 'config', 'user.name', 'Local fixture'], seed)
    run(['git', 'config', 'user.email', 'fixture@example.invalid'], seed)
    (seed / 'README.md').write_text('Source branch must survive publication.')
    run(['git', 'add', 'README.md'], seed)
    run(['git', 'commit', '-m', 'source'], seed)
    run(['git', 'remote', 'add', 'origin', str(remote)], seed)
    run(['git', 'push', 'origin', 'dev'], seed)
    original_dev = run(['git', 'rev-parse', 'dev'], seed)
    env = {**os.environ, 'SOURCE_COMMIT': source}
    commits = []
    for number in (1, 2):
        job = temp / f'job-{number}'
        job.mkdir()
        publisher = job / 'publisher'
        run(['git', 'clone', '--branch', 'dev', str(remote), str(publisher)], job)
        fixture(job / 'frontend-artifact', number)
        run(['python3', '-c', verify], job, env)
        run(['bash', '-c', publish], publisher, env)
        commit = run(['git', 'rev-parse', 'dist-test'], remote)
        assert len(run(['git', 'rev-list', '--parents', '-n', '1', commit], remote).split()) == 1
        assert run(['git', 'rev-list', '--count', commit], remote) == '1'
        assert run(['git', 'ls-tree', '--name-only', commit], remote).splitlines() == ['latest.json', 'swipyrss.zip']
        assert run(['git', 'rev-parse', 'dev'], remote) == original_dev
        commits.append(commit)
    assert commits[0] != commits[1]
    # A corrupted artifact fails before the publish step and leaves the old remote untouched.
    archive = job / 'frontend-artifact/swipyrss.zip'
    archive.write_bytes(archive.read_bytes() + b'corrupted')
    result = subprocess.run(['python3', '-c', verify], cwd=job, env=env, capture_output=True)
    assert result.returncode != 0
    assert run(['git', 'rev-parse', 'dist-test'], remote) == commits[-1]
print('PASS workflow verifier, two orphan publications, unchanged dev history, and corrupt-artifact rejection')
