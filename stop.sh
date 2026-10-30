#!/bin/bash

# Stop the backend and frontend dev servers (leaves MongoDB running)
set -e

echo "Stopping backend (port 3011)..."
lsof -ti :3011 | xargs kill 2>/dev/null && echo "Backend stopped." || echo "Backend not running."

echo "Stopping frontend (port 3010)..."
lsof -ti :3010 | xargs kill 2>/dev/null && echo "Frontend stopped." || echo "Frontend not running."

echo "Done. (MongoDB container left running)"
