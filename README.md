# funds-unlocker
Bot and helper scripts for unlocking reserved funds triggered by reaching mint limit.

This bot automatically releases deposits for reserves with id 'depositc' by calling `circuitBreaker.releaseDeposit` for each one individually (not batched, to keep it free).

In production: Docker secrets are mounted at /run/secrets/account_json
For local development: Mount account.json as a volume or pass via secrets


## Configuration

### Local Development Setup

Before running locally, you need to set up your account credentials:

1. **Export your account from Polkadot.js extension:**
   - Open your Polkadot.js extension
   - Click on the three dots next to your account
   - Select "Export Account"
   - Enter your password and download the JSON file

2. **Create your local account.json:**
   ```bash
   # Copy the example file
   cp account.json.example account.json

   # Replace the contents with your exported account JSON
   # (or just rename your exported file to account.json)
   ```

3. **Note:** `account.json` is gitignored and will never be committed to the repository for security reasons.

### Configuration Options

You can customize the bot behavior using command-line arguments:

- RPC endpoint (default: `ws://localhost:9999`)
- Account JSON path (default: `./account.json`)
- Account password (default: `123456`)

## Usage

### Using Docker (Local Development)

Build the image:
```bash
docker build -t unlock-deposits-bot .
```

Run the bot (mounting your local account.json):
```bash
# Mount your local account.json into the container
docker run -v $(pwd)/account.json:/home/node/bot/account.json \
  unlock-deposits-bot \
  node release-deposits.js ws://host.docker.internal:9999 ./account.json 123456

# With remote RPC endpoint
docker run -v $(pwd)/account.json:/home/node/bot/account.json \
  unlock-deposits-bot \
  node release-deposits.js wss://hydration.ibp.network ./account.json 123456
```

**Note:**
- The `-v` flag mounts your local `account.json` into the container
- When running a local node, use `ws://host.docker.internal:9999` instead of `ws://localhost:9999` to connect from inside Docker to your host machine
- The Docker image does NOT contain account.json for security reasons

### Using Node directly

Install dependencies:
```bash
npm ci
```

Run the script:
```bash
# Using defaults
node release-deposits.js

# With custom arguments
node release-deposits.js wss://hydration.ibp.network ./account.json yourpassword
```

## Arguments

1. `argv[2]`: RPC address (default: `ws://localhost:9999`)
2. `argv[3]`: Account JSON path (default: `./account.json`)
3. `argv[4]`: Account password (default: `123456`)

## Running on a Schedule (Every 10 Minutes)

### Local Development (For Testing)

```bash
# Build and run (runs every 10 minutes automatically)
docker build -t unlock-deposits-bot .
docker run -d --name unlock-deposits-bot \
  -v $(pwd)/account.json:/home/node/bot/account.json \
  --restart unless-stopped \
  unlock-deposits-bot \
  ./bot-loop.sh ws://host.docker.internal:9999 ./account.json 123456
```

That's it! The bot will now run every 10 minutes forever.

**To view logs:**
```bash
docker logs -f unlock-deposits-bot
```

**To stop:**
```bash
docker stop unlock-deposits-bot
docker rm unlock-deposits-bot
```

**To customize RPC endpoint:**
```bash
docker run -d --name unlock-deposits-bot \
  -v $(pwd)/account.json:/home/node/bot/account.json \
  --restart unless-stopped \
  unlock-deposits-bot \
  ./bot-loop.sh wss://hydration.ibp.network ./account.json yourpassword
```

### Production Deployment

For production deployments, use **Docker Swarm with secrets** (see `SWARMPIT_DEPLOYMENT.md`).
This ensures credentials are encrypted and never stored in the codebase or Docker images.


## Environment Variables

You can customize the bot behavior using environment variables:
- `RPC_ENDPOINT`: The WebSocket endpoint (default: `ws://host.docker.internal:9999`)
- `ACCOUNT_JSON`: Path to account JSON file (default: `./account.json`)
- `ACCOUNT_PASSWORD`: Password for the account (default: `123456`)

## How it works

1. Connects to the specified RPC endpoint
2. Queries all `Tokens::Reserves` entries
3. Filters for reserves with id `'depositc'`
4. For each matching entry, submits an individual `circuitBreaker.releaseDeposit` extrinsic
5. Waits for each transaction to finalize before submitting the next one
6. Each call is free (no utility batch fees)
