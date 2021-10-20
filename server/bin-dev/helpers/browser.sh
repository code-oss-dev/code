#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
#

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	VSCODE_PATH=$(dirname $(dirname $(dirname $(dirname $(dirname $(realpath "$0"))))))
else
	VSCODE_PATH=$(dirname $(dirname $(dirname $(dirname $(dirname $(readlink -f $0))))))
fi

PROD_NAME="Code Server - Dev"
VERSION=""
COMMIT=""
EXEC_NAME=""
CLI_SCRIPT="$VSCODE_PATH/out/vs/server/cli.js"
node "$CLI_SCRIPT" "$PROD_NAME" "$VERSION" "$COMMIT" "$EXEC_NAME" "--openExternal" "$@"
