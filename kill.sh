#!/bin/bash

kill_servers() {
    echo "Stopping master server..."
    pkill -f "node main.js"

    echo "Stopping game server..."
    pkill -f "./rrolf-server"
}

kill_servers
