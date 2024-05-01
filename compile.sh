#!/bin/bash

EMSDK_DIR = "/emsdk"

source "/var/www/rrolf/game/emsdk/emsdk_env.sh"

cd "/var/www/rrolf/game/Client/build"
cmake .. -DDEBUG_BUILD=0 -DCMAKE_C_FLAGS="-DNDEBUG" -DWASM_BUILD=1 && make -j`nproc` 

if [ $? -eq 0 ]; then
  echo "Build successful!"
else
  echo "Build failed. See error messages above."
fi