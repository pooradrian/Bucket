#!/usr/bin/env bash
set -euo pipefail

LLAMA_TAG="${LLAMA_TAG:-v0.7.0}"
RUNTIME_VERSION="${RUNTIME_VERSION:-1}"
NDK_VERSION="27.0.12077973"
LIBS=(libggml-base.so libggml-cpu.so libggml.so libllama.so)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist/embedding-runtime/v$RUNTIME_VERSION"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/bucket-embedding-runtime"
SRC="$CACHE/llama.cpp-$LLAMA_TAG"
BUILD="$CACHE/build-$LLAMA_TAG"

resolve_ndk() {
  if [[ -n "${ANDROID_NDK_HOME:-}" ]]; then echo "$ANDROID_NDK_HOME"; return; fi
  if [[ -n "${ANDROID_NDK_ROOT:-}" ]]; then echo "$ANDROID_NDK_ROOT"; return; fi
  local sdk=""
  if [[ -f "$ROOT/android/local.properties" ]]; then
    sdk="$(sed -n 's/^sdk\.dir=//p' "$ROOT/android/local.properties" | tr -d '\r')"
  fi
  if [[ -z "$sdk" && -n "${ANDROID_HOME:-}" ]]; then sdk="$ANDROID_HOME"; fi
  if [[ -z "$sdk" ]]; then sdk="$HOME/Android/Sdk"; fi
  echo "$sdk/ndk/$NDK_VERSION"
}

NDK="$(resolve_ndk)"
TOOLCHAIN="$NDK/build/cmake/android.toolchain.cmake"
STRIP="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip"
READELF="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"

if [[ ! -f "$TOOLCHAIN" ]]; then
  echo "NDK toolchain not found at $TOOLCHAIN" >&2
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  mkdir -p "$CACHE"
  git clone --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp.git "$SRC"
fi

build_abi() {
  local abi="$1"
  shift
  local dir="$BUILD/$abi"
  cmake -S "$SRC" -B "$dir" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
    -DANDROID_ABI="$abi" \
    -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_SHARED_LINKER_FLAGS="-Wl,-z,max-page-size=16384" \
    -DLLAMA_BUILD_COMMON=OFF \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_TOOLS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=OFF \
    -DLLAMA_BUILD_APP=OFF \
    -DLLAMA_CURL=OFF \
    -DGGML_OPENMP=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_BACKEND_DL=OFF \
    -DGGML_CCACHE=OFF \
    "$@"
  cmake --build "$dir" --target llama --parallel
}

package_abi() {
  local abi="$1"
  local dir="$BUILD/$abi/bin"
  mkdir -p "$OUT/$abi" "$OUT/upload"
  for lib in "${LIBS[@]}"; do
    cp "$dir/$lib" "$OUT/$abi/$lib"
    "$STRIP" --strip-unneeded "$OUT/$abi/$lib"
    headers="$("$READELF" -l "$OUT/$abi/$lib")"
    if ! grep -q 'LOAD.*0x4000$' <<<"$headers"; then
      echo "$abi/$lib is not 16 KB page aligned" >&2
      exit 1
    fi
    cp "$OUT/$abi/$lib" "$OUT/upload/$abi-$lib"
  done
}

build_abi arm64-v8a
build_abi armeabi-v7a -DGGML_LLAMAFILE=OFF

package_abi arm64-v8a
package_abi armeabi-v7a

node - "$OUT" "$LLAMA_TAG" "$RUNTIME_VERSION" <<'END'
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const [out, llamaTag, version] = process.argv.slice(2)
const manifest = { version: Number(version), llamaTag, generated: new Date().toISOString(), abis: {} }
for (const abi of fs.readdirSync(out)) {
  const dir = path.join(out, abi)
  if (!fs.statSync(dir).isDirectory() || abi === 'upload') continue
  manifest.abis[abi] = fs.readdirSync(dir).sort().map(name => {
    const bytes = fs.readFileSync(path.join(dir, name))
    return { name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
  })
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
END

echo "runtime v$RUNTIME_VERSION ($LLAMA_TAG) written to $OUT"
du -sh "$OUT"/arm64-v8a "$OUT"/armeabi-v7a
