// Script to collect (who, assetId) for reserves with id 'depositc' and release deposits
import { ApiPromise, WsProvider } from '@polkadot/api';
import Keyring from '@polkadot/keyring';
import fs from 'fs';
import { cryptoWaitReady } from '@polkadot/util-crypto';

async function main() {
    const rpcAddr = process.argv[2] || 'ws://host.docker.internal:9999';
    const accountJsonPath = process.argv[3] || './account.json';
    const accountPassword = process.argv[4] || '123456';

    console.log(`\nConnecting to RPC node: ${rpcAddr}\n`);

    const provider = new WsProvider(rpcAddr);
    const api = await ApiPromise.create({ provider });

    const [chain, nodeName, nodeVersion] = await Promise.all([
        api.rpc.system.chain(),
        api.rpc.system.name(),
        api.rpc.system.version()
    ]);
    console.log(`You are connected to chain ${chain} using ${nodeName} v${nodeVersion}\n`);

    console.log('Fetching all Tokens::Reserves entries...\n');
    const entries = await api.query.tokens.reserves.entries();

    const pairs = [];

    for (const [key, value] of entries) {
        const reserves = value.toHuman();
        if (reserves.some((reserve) => reserve.id === 'depositc')) {
            const [accountId, currencyId] = key.args;
            const pair = { who: accountId, assetId: currencyId, human: reserves };
            pairs.push(pair);

            console.log('-----------------------------------');
            console.log(`Account: ${pair.who.toString()}`);
            console.log(`Asset ID: ${pair.assetId.toString()}`);
            console.log(`Reserves: ${JSON.stringify(pair.human, null, 2)}\n`);
        }
    }

    console.log(`Found ${pairs.length} entries with id "depositc" (out of ${entries.length} total)\n`);

    if (pairs.length === 0) {
        console.log('No matching reserves found. Nothing to release.');
        await api.disconnect();
        return;
    }

    await cryptoWaitReady();
    const signer = loadSigner(accountJsonPath, accountPassword);

    console.log(`Checking lockdown status for ${pairs.length} asset(s)...\n`);

    const currentBlock = (await api.query.system.number()).toNumber();
    console.log(`Current block: ${currentBlock}\n`);

    const releasablePairs = [];
    let lockedCount = 0;

    for (const p of pairs) {
        const lockdownState = await api.query.circuitBreaker.assetLockdownState(p.assetId);

        if (lockdownState.isNone) {
            console.log(`  ✓  Asset ${p.assetId.toString()} has no lockdown state`);
            releasablePairs.push(p);
            continue;
        }

        const lockdown = lockdownState.unwrap();

        if (!lockdown.isLocked) {
            console.log(`  ✓  Asset ${p.assetId.toString()} is not locked`);
            releasablePairs.push(p);
            continue;
        }

        const untilBlock = lockdown.asLocked.toNumber();
        if (untilBlock >= currentBlock) {
            const blocksRemaining = untilBlock - currentBlock;
            console.log(`  ⚠️  Asset ${p.assetId.toString()} is still in lockdown until block ${untilBlock} (${blocksRemaining} blocks remaining)`);
            lockedCount++;
            continue;
        }

        console.log(`  ✓  Asset ${p.assetId.toString()} lockdown expired at block ${untilBlock}`);
        releasablePairs.push(p);
    }

    console.log(`\nSummary: ${releasablePairs.length} releasable, ${lockedCount} still locked\n`);

    if (releasablePairs.length === 0) {
        console.log('No releasable deposits found (all assets still in lockdown).');
        await api.disconnect();
        return;
    }

    console.log(`Submitting ${releasablePairs.length} extrinsic(s) as ${signer.address}...\n`);

    // Submit batches per block: fire X TXs → wait for next block → repeat.
    const BATCH_SIZE = 10;
    let batchIndex = 0;
    let successCount = 0;
    let failureCount = 0;

    await new Promise(async (resolve) => {
        let nonce = await api.rpc.system.accountNextIndex(signer.address);

        const unsubscribe = api.rpc.chain.subscribeNewHeads(() => {
            const start = batchIndex * BATCH_SIZE;

            if (start >= releasablePairs.length) {
                setTimeout(() => {
                    unsubscribe.then(unsub => unsub());
                    resolve();
                }, 10000); // wait 10s for last TXs to be included
                return;
            }

            const batch = releasablePairs.slice(start, start + BATCH_SIZE);
            console.log(`\n[Batch ${batchIndex + 1}] Submitting ${batch.length} TX(s)...`);

            batch.forEach((p, i) => {
                const txNum = start + i + 1;
                const currentNonce = nonce++;

                console.log(`  [${txNum}/${releasablePairs.length}] ${p.who.toString()} / ${p.assetId.toString()} (nonce: ${currentNonce})`);

                api.tx.circuitBreaker.releaseDeposit(p.who, p.assetId)
                    .signAndSend(signer, { nonce: currentNonce }, ({ status, dispatchError }) => {
                        if (status.isInBlock) {
                            if (dispatchError) {
                                failureCount++;
                                let errorMsg;
                                if (dispatchError.isModule) {
                                    const decoded = api.registry.findMetaError(dispatchError.asModule);
                                    errorMsg = `${decoded.section}.${decoded.name}`;
                                } else {
                                    errorMsg = dispatchError.toString();
                                }
                                console.error(`    [${txNum}] Failed: ${errorMsg}`);
                            } else {
                                successCount++;
                                console.log(`    [${txNum}] Success`);
                            }
                        }
                    })
                    .catch((err) => {
                        failureCount++;
                        console.error(`    [${txNum}] Submit error: ${err.message || err}`);
                    });
            });

            batchIndex++;
        });
    });

    console.log(`\n--- Summary ---`);
    console.log(`Submitted: ${releasablePairs.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failureCount}`);

    if (lockedCount > 0) {
        console.log(`\nNote: ${lockedCount} asset(s) were skipped due to active lockdown.`);
    }

    await api.disconnect();
}

function loadSigner(path, password) {
    try {
        const jsonStr = fs.readFileSync(path, 'utf-8');
        const json = JSON.parse(jsonStr);
        const content = Array.isArray(json.encoding?.content) ? json.encoding.content : [];
        const keyType = content.includes('ed25519') ? 'ed25519' : 'sr25519';
        const keyring = new Keyring({ type: keyType });
        const pair = keyring.addFromJson(json);
        pair.unlock(password);
        return pair;
    } catch (err) {
        throw new Error(`Failed to load signer from ${path}: ${err.message}`);
    }
}

main().catch(console.error).finally(() => process.exit());


