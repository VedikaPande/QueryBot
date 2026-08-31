"""
Meta routes.

Serves the OpenAPI document and a browsable API reference.
"""
from pathlib import Path

from flask import Blueprint, Response, send_from_directory

from app.utils.rate_limit import limiter

meta_bp = Blueprint('meta', __name__, url_prefix='/api')

_STATIC_DIR = Path(__file__).resolve().parent.parent / 'static'


@meta_bp.route('/openapi.yaml', methods=['GET'])
@limiter.exempt
def openapi_spec():
    """The machine-readable API specification."""
    return send_from_directory(_STATIC_DIR, 'openapi.yaml', mimetype='application/yaml')


@meta_bp.route('/docs', methods=['GET'])
@limiter.exempt
def api_docs() -> Response:
    """
    Interactive API reference.

    Rendered by Scalar, loaded from a CDN. Kept out of the client bundle
    deliberately: this is a developer-facing page and should cost end users
    nothing.
    """
    html = """<!doctype html>
<html>
  <head>
    <title>QueryBot API reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0 }</style>
  </head>
  <body>
    <script id="api-reference" data-url="/api/openapi.yaml"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>"""
    return Response(html, mimetype='text/html')
