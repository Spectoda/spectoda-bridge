rm -rf build/lib
rm -rf build/wasm
rm -rf build/*.js

mkdir -p build/lib
mkdir -p build/wasm

rsync -av --exclude='*.ts' --exclude='*.txt' --exclude='*.tsx' ./src/ ./build/


npx tsc