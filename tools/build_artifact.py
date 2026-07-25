"""app/ 의 정적 웹앱을 단일 HTML 파일로 번들한다 (Artifact 공유용).

- 4개 JS 모듈을 import/export 없이 이어 붙여 하나의 <script> 로 만든다.
- 포켓몬 스프라이트 55장은 128px 로 축소해 base64 data URI 로 인라인한다.
- 서비스워커/매니페스트 등 설치형 PWA 요소는 뺀다 (단일 페이지 공유가 목적이므로).
"""
import base64
import glob
import io
import os
import re

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
OUT = os.path.join(ROOT, 'dist')
os.makedirs(OUT, exist_ok=True)


def read(name):
    with open(os.path.join(APP, name), encoding='utf-8') as f:
        return f.read()


def strip_module_syntax(src):
    # import {...} from '...';  (여러 줄도 포함)
    src = re.sub(r'import\s*\{[\s\S]*?\}\s*from\s*[\'"][^\'"]+[\'"];?\s*\n?', '', src)
    # export { a, b, c };  (재수출 목록)
    src = re.sub(r'^export\s*\{[^}]*\}\s*;?\s*$', '', src, flags=re.MULTILINE)
    # export const/function/async function/class/let → 앞의 export 만 제거
    src = re.sub(r'^export\s+', '', src, flags=re.MULTILINE)
    return src


def build_sprite_map():
    entries = []
    total = 0
    for path in sorted(glob.glob(os.path.join(APP, 'assets', 'sprites', '*.png'))):
        dex = os.path.splitext(os.path.basename(path))[0]
        im = Image.open(path).convert('RGBA')
        im.thumbnail((128, 128), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format='PNG', optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode('ascii')
        total += len(b64)
        entries.append(f'{dex}:"data:image/png;base64,{b64}"')
    print(f'스프라이트 {len(entries)}장, base64 총 {total // 1024} KB')
    return 'const SPRITES={' + ','.join(entries) + '};\nconst spriteUrl=(dex)=>SPRITES[dex]||"";'


def inline_image_sources(html):
    """단일 HTML에서도 로비의 영웅 이미지가 보이도록 작업폴더 PNG를 삽입한다."""
    def replace(match):
        dex = match.group(1)
        path = os.path.join(APP, 'assets', 'sprites', f'{dex}.png')
        with open(path, 'rb') as f:
            encoded = base64.b64encode(f.read()).decode('ascii')
        return f'src="data:image/png;base64,{encoded}"'

    return re.sub(r'src="assets/sprites/(7|1|4)\.png"', replace, html)


def main():
    data_js = read('js/data.js')
    data_js = re.sub(r'export const spriteUrl = .*?;\s*\n?', '', data_js)
    data_js = strip_module_syntax(data_js)

    engine_js = strip_module_syntax(read('js/engine.js'))
    ai_js = strip_module_syntax(read('js/ai.js'))

    app_js = read('js/app.js')
    app_js = re.sub(
        r"// ── PWA .*?\nif \('serviceWorker' in navigator\) \{[\s\S]*?\}\n",
        '', app_js,
    )
    app_js = strip_module_syntax(app_js)

    sprites_js = build_sprite_map()

    script = '\n'.join([
        '"use strict";',
        data_js, sprites_js, engine_js, ai_js, app_js,
    ])

    html = read('index.html')
    # 외부 리소스 링크 제거 (단일 파일이므로 불필요)
    html = re.sub(r'\s*<link rel="manifest"[^>]*>\n?', '\n', html)
    html = re.sub(r'\s*<link rel="icon"[^>]*>\n?', '\n', html)
    html = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*>\n?', '\n', html)
    html = re.sub(r'\s*<link rel="stylesheet" href="style\.css">\n?', '\n', html)
    html = re.sub(
        r'<script type="module" src="js/app\.js"></script>',
        f'<script>\n{script}\n</script>',
        html,
    )
    html = inline_image_sources(html)
    css = read('style.css')
    html = html.replace('</head>', f'<style>\n{css}\n</style>\n</head>')

    for name in ('poke-splendor.html', 'index.html'):
        out_path = os.path.join(OUT, name)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'완성: {out_path}  ({os.path.getsize(out_path) // 1024} KB)')


if __name__ == '__main__':
    main()
