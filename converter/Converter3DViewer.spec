# -*- mode: python ; coding: utf-8 -*-
import glob
import os

# OCP(OpenCascade)は単一の.pydがOCP.TopTools等の疑似サブモジュールを
# 実行時に動的登録する特殊な構造のため、PyInstallerの静的解析では
# 依存関係を検出できない。site-packages直下の.pyd/.dllを明示的に含める
SITE_PACKAGES = os.path.join(os.path.dirname(os.path.abspath(SPEC)), '.venv', 'Lib', 'site-packages')
extra_binaries = [(f, '.') for f in glob.glob(os.path.join(SITE_PACKAGES, '*.pyd'))]
extra_binaries += [(f, '.') for f in glob.glob(os.path.join(SITE_PACKAGES, '*.dll'))]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=extra_binaries,
    datas=[],
    hiddenimports=['OCP'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Converter3DViewer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Converter3DViewer',
)
