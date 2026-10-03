#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
STAGING_DIR="backend/static_staging"
PROD_DIR="backend/static"
HEALTH_URL="http://localhost:8000"
HEALTH_TIMEOUT=5
LOCKFILE="/tmp/jobcopilot_deploy.lock"
OFFLINE_MODE="${OFFLINE_MODE:-false}"
DRY_RUN="${DRY_RUN:-false}"

for arg in "$@"; do
    if [ "$arg" == "--dry-run" ]; then
        DRY_RUN=true
    fi
done

# --- Concurrency lock ---
if ! mkdir "$LOCKFILE" 2>/dev/null; then
    echo "FATAL: Deployment already in progress ($LOCKFILE exists)."
    exit 1
fi

# --- Timestamped names ---
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="backend/static_backup_${TIMESTAMP}"
FAILED_DIR="backend/static_failed_${TIMESTAMP}"

# --- State for cleanup ---
ROLLBACK_NEEDED=0

cleanup() {
    local exit_code=$?
    if [ $ROLLBACK_NEEDED -eq 1 ]; then
        ROLLBACK_NEEDED=0
        echo "ERROR or interruption detected. Rolling back..."
        # Move failed new build out of the way
        if [ -d "$PROD_DIR" ]; then
            if ! mv "$PROD_DIR" "$FAILED_DIR" 2>/dev/null; then
                echo "FATAL: Failed to move broken $PROD_DIR to $FAILED_DIR"
                echo "Manual recovery required:"
                echo "  1. rm -rf $PROD_DIR"
                echo "  2. mv $BACKUP_DIR $PROD_DIR"
                rm -rf "$LOCKFILE"
                exit 1
            fi
            echo "  Failed build preserved at $FAILED_DIR"
        fi
        # Restore original only if PROD_DIR is gone
        if [ ! -d "$PROD_DIR" ] && [ -d "$BACKUP_DIR" ]; then
            mv "$BACKUP_DIR" "$PROD_DIR" 2>/dev/null || echo "  Failed to restore BACKUP"
            echo "  Original UI restored from $BACKUP_DIR"
        else
            echo "  WARNING: No backup found at $BACKUP_DIR or PROD_DIR still exists."
        fi
    fi
    rm -rf "$LOCKFILE"
    exit $exit_code
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# --- 1. Path validation ---
if [ ! -f "backend/server.py" ]; then
    echo "FATAL: Must run from project root (backend/server.py not found)."
    exit 1
fi

# --- 2. Validate staging directory ---
if [ ! -d "$STAGING_DIR" ]; then
    echo "FATAL: $STAGING_DIR does not exist. Run 'npm run build' in frontend/ first."
    exit 1
fi
if [ ! -f "$STAGING_DIR/index.html" ]; then
    echo "FATAL: $STAGING_DIR/index.html missing."
    exit 1
fi


if [ -z "${STAGING_MANIFEST:-}" ]; then
    echo "FATAL: STAGING_MANIFEST environment variable must be set."
    exit 1
fi
if [ ! -f "$STAGING_MANIFEST" ]; then
    echo "FATAL: Manifest file $STAGING_MANIFEST not found."
    exit 1
fi
ABS_MANIFEST="$(cd "$(dirname "$STAGING_MANIFEST")" && pwd)/$(basename "$STAGING_MANIFEST")"

echo "Verifying staging directory against manifest..."
if ! (cd "$STAGING_DIR" && shasum -c "$ABS_MANIFEST" >/dev/null 2>&1); then
    echo "FATAL: Staging directory contents do not match $STAGING_MANIFEST."
    exit 1
fi
ACTUAL_FILES=$(cd "$STAGING_DIR" && find . -type f | sed 's|^./||' | sort)
EXPECTED_FILES=$(awk '{print $2}' "$ABS_MANIFEST" | sed 's|^./||' | sort)
if [ "$ACTUAL_FILES" != "$EXPECTED_FILES" ]; then
    echo "FATAL: Staging directory file list differs from manifest (extra or missing files)."
    exit 1
fi
echo "  Manifest match: OK"

# --- 3. Validate every JS/CSS asset referenced in index.html ---
echo "Validating referenced assets locally..."
MISSING_ASSETS=0
ASSETS_FOUND=0
for asset in $(grep -oE '(src|href)="/assets/[^"]+' "$STAGING_DIR/index.html" | sed 's/^[^"]*"//'); do
    ASSETS_FOUND=$((ASSETS_FOUND + 1))
    local_path="${STAGING_DIR}${asset}"
    if [ ! -f "$local_path" ]; then
        echo "  MISSING: $asset"
        MISSING_ASSETS=1
    else
        echo "  OK: $asset"
    fi
done
if [ $ASSETS_FOUND -eq 0 ]; then
    echo "FATAL: No assets referenced in index.html. Invalid build."
    exit 1
fi
if [ $MISSING_ASSETS -eq 1 ]; then
    echo "FATAL: Referenced assets are missing from staging build."
    exit 1
fi

# --- 4. Reject backup/failed collisions ---
if [ -d "$BACKUP_DIR" ]; then
    echo "FATAL: Backup directory $BACKUP_DIR already exists."
    exit 1
fi
if [ -d "$FAILED_DIR" ]; then
    echo "FATAL: Failed directory $FAILED_DIR already exists."
    exit 1
fi

# --- 5. Pre-deployment health check (fail closed) ---
if [ "$OFFLINE_MODE" != "true" ]; then
    echo "Checking server availability..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m "$HEALTH_TIMEOUT" "$HEALTH_URL/api/stats" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" != "200" ]; then
        echo "FATAL: Health endpoint $HEALTH_URL/api/stats returned HTTP $HTTP_CODE."
        echo "       Server must be running before deployment."
        echo "       Set OFFLINE_MODE=true to override (requires explicit approval)."
        exit 1
    fi
    echo "  Pre-deploy health: HTTP $HTTP_CODE OK"
else
    echo "WARNING: OFFLINE_MODE=true. Skipping pre-deploy health check."
fi

if [ "$DRY_RUN" == "true" ]; then
    echo ""
    echo "=== DRY RUN SUCCESS ==="
    echo "All pre-deployment validations passed."
    echo "Would have backed up to $BACKUP_DIR"
    echo "Would have moved $STAGING_DIR to $PROD_DIR"
    exit 0
fi

# --- 6. Backup production ---
echo "Backing up $PROD_DIR to $BACKUP_DIR..."
if [ -d "$PROD_DIR" ]; then
    mv "$PROD_DIR" "$BACKUP_DIR"
else
    echo "  No existing $PROD_DIR to back up."
fi

# --- 7. Deploy (arm rollback BEFORE this move) ---
ROLLBACK_NEEDED=1
echo "Moving $STAGING_DIR to $PROD_DIR..."
mv "$STAGING_DIR" "$PROD_DIR"

# --- 8. Post-deployment validation ---
echo "Running post-deployment validation..."

# 8a. File-level check
if ! grep -q 'id="root"' "$PROD_DIR/index.html"; then
    echo "FATAL: Deployed index.html missing root div."
    exit 1
fi
echo "  File check: OK"

# 8b. HTTP health checks (fail closed)
if [ "$OFFLINE_MODE" != "true" ]; then
    echo "  Waiting 2s for server to pick up new files..."
    sleep 2

    # Check API health
    API_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m "$HEALTH_TIMEOUT" "$HEALTH_URL/api/stats" 2>/dev/null || echo "000")
    if [ "$API_CODE" != "200" ]; then
        echo "FATAL: Post-deploy API check returned HTTP $API_CODE."
        exit 1
    fi
    echo "  API health: HTTP $API_CODE OK"

    # Check that new HTML is served
    SERVED_HTML=$(curl -s -m "$HEALTH_TIMEOUT" "$HEALTH_URL/" 2>/dev/null || echo "")
    if ! echo "$SERVED_HTML" | grep -q 'id="root"'; then
        echo "FATAL: Server not serving new index.html (missing root div)."
        exit 1
    fi
    echo "  Served HTML: OK"
    
    # Check that served HTML assets are reachable via HTTP
    for asset in $(echo "$SERVED_HTML" | grep -oE '(src|href)="/assets/[^"]+' | sed 's/^[^"]*"//'); do
        ASSET_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m "$HEALTH_TIMEOUT" "$HEALTH_URL$asset" 2>/dev/null || echo "000")
        if [ "$ASSET_CODE" != "200" ]; then
            echo "FATAL: Deployed asset $asset returned HTTP $ASSET_CODE via served route."
            exit 1
        fi
        echo "  Served Asset HTTP 200: $asset"
    done
fi

# --- 9. Success ---
ROLLBACK_NEEDED=0
echo ""
echo "Deployment successful."
echo "  Production: $PROD_DIR"
echo "  Backup:     $BACKUP_DIR"
