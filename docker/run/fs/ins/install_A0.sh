#!/bin/bash

# git repository from parameter
if [ -z "$1" ]; then
    echo "Error: Git Repository parameter is empty. Please provide a valid git repository."
    exit 1
fi
BRANCH="$1"

# branch from parameter
if [ -z "$2" ]; then
    echo "Error: Branch parameter is empty. Please provide a valid branch name."
    exit 1
fi
BRANCH="$2"

# clone project repo branch
git clone -b "$BRANCH" "$GIT_REPOSITORY" "/git/agent-zero"

# setup python environment
. "/ins/setup_venv.sh" "$@"

# Preload A0
python /git/agent-zero/preload.py --dockerized=true