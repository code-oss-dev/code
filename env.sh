#!/usr/bin/env bash
export npm_config_disturl=https://atom.io/download/electron
export npm_config_target=$(node -p "require('./package.json').electronVersion")
export npm_config_runtime=electron
export npm_config_cache="$HOME/.npm-electron"
mkdir -p "$npm_config_cache"