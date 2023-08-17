rm -rf build/lib
rm -rf build/wasm
rm -rf build/*.js

mkdir -p build/lib
mkdir -p build/wasm

rsync -av --exclude='*.ts' --exclude='*.txt' --exclude='*.tsx' ./src/ ./build/
cp -r ./assets/ ./build/

echo "Compiling Typescript to Javascript..."

npx tsc