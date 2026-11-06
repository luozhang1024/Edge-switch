"""Read npm's published versions without running package code."""
import json
import re
import urllib.request


def published_versions(metadata, limit=60):
    versions = [version for version, info in metadata.get('versions', {}).items()
                if re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version)
                and not info.get('deprecated')]
    def order(version):
        main, _, pre = version.partition('-')
        return (*map(int, main.split('.')), not pre, pre)
    versions.sort(key=order, reverse=True)
    latest = metadata.get('dist-tags', {}).get('latest', '')
    # Put the publisher's recommended version first, including preview releases.
    if latest in versions:
        versions.remove(latest)
        versions.insert(0, latest)
    if not versions:
        raise ValueError('npm 未返回可安装的版本')
    return dict(latest=latest if latest in versions else versions[0], versions=versions[:limit])


def fetch_versions(proxy=False, port=7890):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler(
        {'https': 'http://127.0.0.1:' + str(port)} if proxy else {}))
    result = {}
    for tool, package in [('codex', '@openai%2Fcodex'), ('harness', '@deepseek-ai%2Fdsh')]:
        request = urllib.request.Request('https://registry.npmjs.org/' + package,
            headers={'Accept': 'application/vnd.npm.install-v1+json', 'User-Agent': 'EdgeSwitch/1.1.2'})
        with opener.open(request, timeout=25) as response:
            result[tool] = published_versions(json.load(response))
    return result
