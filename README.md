# funds-unlocker
Bot and helper scripts for unlocking reserved funds triggered by reaching mint limit.

This bot automatically releases deposits for reserves with id 'depositc' by calling `circuitBreaker.releaseDeposit` for each one individually (not batched, to keep it free).

## Configuration

Before running, update the following in `release-deposits.js` or pass as command-line arguments:

- RPC endpoint (default: `ws://localhost:9999`)
- Account JSON path (default: `./account.json`)
- Account password (default: `123456`)

## Usage

### Using Docker

Build the image:
```bash
docker build -t unlock-deposits-bot .
```

Run the bot:
```bash
# Connect to node running on host machine (use host.docker.internal instead of localhost)
docker run unlock-deposits-bot node release-deposits.js ws://host.docker.internal:9999 ./account.json 123456

# Alternative: Use host network mode (Linux only)
docker run --network host unlock-deposits-bot

# With remote RPC endpoint
docker run unlock-deposits-bot node release-deposits.js wss://hydration.ibp.network ./account.json 123456
```

**Note:** When running a local node, use `ws://host.docker.internal:9999` instead of `ws://localhost:9999` to connect from inside Docker to your host machine.

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

### Simplest Way: Just Docker (2 commands)

```bash
# Build and run (runs every 10 minutes automatically)
docker build -t unlock-deposits-bot .
docker run -d --name unlock-deposits-bot --restart unless-stopped unlock-deposits-bot
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
docker run -d --name unlock-deposits-bot --restart unless-stopped \
  unlock-deposits-bot \
  ./bot-loop.sh wss://hydration.ibp.network ./account.json yourpassword
```


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
