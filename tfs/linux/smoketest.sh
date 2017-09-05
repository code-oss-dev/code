#!/bin/bash
set -e

. ./build/tfs/common/node.sh
. ./scripts/env.sh
. ./build/tfs/common/common.sh

export ARCH="$1"
export VSCODE_MIXIN_PASSWORD="$2"
VSO_PAT="$3"

echo "machine monacotools.visualstudio.com password $VSO_PAT" > ~/.netrc

step "Install dependencies" \
	npm install --arch=$ARCH --unsafe-perm

step "Mix in repository from vscode-distro" \
	npm run gulp -- mixin

step "Get Electron" \
	npm run gulp -- "electron-$ARCH"

step "Install distro dependencies" \
	node build/tfs/common/installDistro.js --arch=$ARCH

step "Build minified" \
	npm run gulp -- "vscode-linux-$ARCH-min"

function configureEnvironment {
	id -u testuser &>/dev/null || (useradd -m testuser; chpasswd <<< testuser:testpassword)
	sudo -i -u testuser git config --global user.name "VS Code Agent"
	sudo -i -u testuser git config --global user.email "monacotools@microsoft.com"
	chown -R testuser $AGENT_BUILDDIRECTORY
}

step "Configure environment" configureEnvironment

step "Run smoke test" \
	sudo -u testuser npm run smoketest -- --build "$AGENT_BUILDDIRECTORY/VSCode-linux-ia32/code-insiders"

