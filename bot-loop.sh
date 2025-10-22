#!/bin/sh

# Simple loop that runs the bot every 10 minutes
# This runs inside the Docker container

while true; do
    echo "=================================================="
    echo "Starting bot run at $(date)"
    echo "=================================================="

    node release-deposits.js "$@"

    echo "=================================================="
    echo "Bot finished at $(date)"
    echo "Sleeping for 10 minutes..."
    echo "=================================================="
    echo ""

    sleep 600  # 600 seconds = 10 minutes
done
