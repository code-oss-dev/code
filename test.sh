#!/bin/bash
set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

cd $ROOT

if [[ "$OSTYPE" == "darwin"* ]]; then
	NAME=`node -p "require('./product.json').nameLong"`
	CODE="./.build/electron/$NAME.app/Contents/MacOS/Electron"
else
	NAME=`node -p "require('./product.json').applicationName"`
	CODE=".build/electron/$NAME"
fi

# Node modules
test -d node_modules || ./scripts/npm.sh install

# Get electron
test -f "$CODE" || ./node_modules/.bin/gulp electron

# Build
test -d out || ./node_modules/.bin/gulp compile

# Unit Tests
export VSCODE_DEV=1
if [[ "$OSTYPE" == "darwin"* ]]; then
	cd $ROOT ; ulimit -n 4096 ; ATOM_SHELL_INTERNAL_RUN_AS_NODE=1 \
		"$CODE" \
		node_modules/mocha/bin/_mocha "$@"
else
	cd $ROOT ; ATOM_SHELL_INTERNAL_RUN_AS_NODE=1 \
		"$CODE" \
		node_modules/mocha/bin/_mocha "$@"
fi
