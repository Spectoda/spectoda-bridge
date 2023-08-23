rm -rf build/lib
rm -rf build/wasm
rm -rf build/*.js

mkdir -p build/lib
mkdir -p build/wasm
mkdir -p build/assets

rsync -av --exclude='*.ts' --exclude='*.txt' --exclude='*.tsx' ./src/ ./build/
rsync -av ./assets/ ./build/assets/

echo "Compiling Typescript to Javascript..."

npx tsc