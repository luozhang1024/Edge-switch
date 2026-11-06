"""Persistent SSH stdio adapter; remote Python only, no local Python runtime."""
import contextlib
import io
import json
import sys


def serve(namespace):
    transport_in, transport_out = sys.stdin, sys.stdout
    for line in transport_in:
        request = None
        try:
            request = json.loads(line)
            payload = request['payload']
            output = io.StringIO()
            previous = sys.stdin
            try:
                sys.stdin = io.StringIO(json.dumps(payload))
                with contextlib.redirect_stdout(output):
                    namespace['main']()
            finally:
                sys.stdin = previous
            result = json.loads(output.getvalue())
            response = {'id': request['id'], 'result': result}
        except Exception as exc:
            response = {'id': request.get('id') if isinstance(request, dict) else None,
                        'error': str(exc)}
        transport_out.write(json.dumps(response, ensure_ascii=False) + '\n')
        transport_out.flush()
