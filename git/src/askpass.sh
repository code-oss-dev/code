#!/bin/sh
VSCODE_GIT_ASKPASS_PIPE=`mktemp`
ELECTRON_RUN_AS_NODE="1" VSCODE_GIT_ASKPASS_PIPE="$VSCODE_GIT_ASKPASS_PIPE" "$VSCODE_GIT_ASKPASS_NODE" "$VSCODE_GIT_ASKPASS_MAIN" $VSCODE_GIT_ASKPASS_EXTRA_ARGS $*
cat $VSCODE_GIT_ASKPASS_PIPE
rm $VSCODE_GIT_ASKPASS_PIPE
