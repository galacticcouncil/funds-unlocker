# Swarmpit Deployment Guide

This guide shows how to deploy the funds-unlocker bot to Docker Swarm using Swarmpit.

## Prerequisites

1. Docker image built and pushed to Docker Hub
2. Access to Swarmpit web UI
3. `account.json` file ready
4. Account password

## Step 1: Build and Push Docker Image

```bash
# Build the image (update with your Docker Hub username)
docker build -t YOUR_USERNAME/funds-unlocker:latest .

# Login to Docker Hub
docker login

# Push to Docker Hub
docker push YOUR_USERNAME/funds-unlocker:latest
```

## Step 2: Create Docker Secrets

You need to create two secrets **before** deploying the stack. You can do this via:

### Option A: Using Swarmpit UI

1. Go to **Secrets** in the left sidebar
2. Click **"New Secret"**
3. Create the first secret:
   - **Name**: `account_json`
   - **Data**: Paste the entire contents of your `account.json` file
   - Click **"Create"**
4. Create the second secret:
   - **Name**: `account_password`
   - **Data**: Your account password (e.g., `123456`)
   - Click **"Create"**

### Option B: Using Docker CLI (on Swarm manager node)

```bash
# Create account.json secret
docker secret create account_json ./account.json

# Create password secret
echo -n "123456" | docker secret create account_password -
```

## Step 3: Update docker-compose.yml

Open `docker-compose.yml` and update:

1. **Line 7**: Change `dmoka/funds-unlocker:latest` to your Docker Hub image
2. **Line 13**: Update `RPC_ENDPOINT` if needed (default: `wss://hydration.ibp.network`)

## Step 4: Deploy Stack in Swarmpit

1. Log into **Swarmpit** (usually at `http://your-swarm-ip:888`)
2. Click **"Stacks"** in the left sidebar
3. Click **"New Stack"** button
4. Enter stack name: `funds-unlocker`
5. **Paste the entire `docker-compose.yml` contents** into the editor
6. Click **"Deploy"**

## Step 5: Verify Deployment

1. Go to **Services** → **funds-unlocker_funds-unlocker**
2. Check the **Status** (should show 1/1 replicas running)
3. Click on the service and view **Logs**
4. You should see the bot running every 10 minutes

## How It Works

- **Secrets**: Docker Swarm mounts secrets at `/run/secrets/` inside the container
- **account_json**: Contains your account keystore (JSON format)
- **account_password**: Plain text password to unlock the account
- **Command override**: The `command` in docker-compose.yml reads these secrets and passes them to `bot-loop.sh`
- **Bot loop**: Runs `release-deposits.js` every 10 minutes automatically

## Troubleshooting

### Secret not found error
```
Error: secret not found: account_json
```
**Solution**: Create the secrets (Step 2) before deploying the stack

### Container keeps restarting
**Solution**: Check logs in Swarmpit. Common issues:
- Wrong RPC endpoint (connection timeout)
- Invalid account.json format
- Wrong password

### View logs
```bash
# Via CLI
docker service logs -f funds-unlocker_funds-unlocker

# Or use Swarmpit UI: Services → funds-unlocker → Logs
```

## Updating the Deployment

To update the bot:

1. Build and push new image with same tag
2. In Swarmpit: **Services** → **funds-unlocker** → **Update Service**
3. Or via CLI: `docker service update --image YOUR_USERNAME/funds-unlocker:latest funds-unlocker_funds-unlocker`

The `start-first` update strategy ensures zero downtime during updates.

## Security Notes

- **Secrets are encrypted** at rest in Docker Swarm
- Only containers with explicit access can read secrets
- Never commit `account.json` or passwords to git
- Use `.gitignore` to exclude sensitive files (already configured)
