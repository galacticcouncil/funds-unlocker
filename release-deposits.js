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

    const pairs = entries
        .filter(([, value]) => {
            const reserves = value.toHuman();
            return reserves.some((reserve) => reserve.id === 'depositc');
        })
        .map(([key, value]) => {
            const [accountId, currencyId] = key.args;
            return { who: accountId, assetId: currencyId, human: value.toHuman() };
        });

    console.log(`Found ${pairs.length} entries with id "depositc" (out of ${entries.length} total)\n`);

    for (const p of pairs) {
        console.log('-----------------------------------');
        console.log(`Account: ${p.who.toString()}`);
        console.log(`Asset ID: ${p.assetId.toString()}`);
        console.log(`Reserves: ${JSON.stringify(p.human, null, 2)}\n`);
    }

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

    console.log(`Submitting ${releasablePairs.length} individual extrinsic(s) as ${signer.address}...\n`);

    // Release each deposit one by one to prevent filling a block too much and any tx error.
    for (let i = 0; i < releasablePairs.length; i++) {
        const p = releasablePairs[i];
        console.log(`[${i + 1}/${releasablePairs.length}] Releasing deposit for ${p.who.toString()} / ${p.assetId.toString()}...`);

        const extrinsic = api.tx.circuitBreaker.releaseDeposit(p.who, p.assetId);

        await new Promise((resolve, reject) => {
            const unsubscribePromise = extrinsic
                .signAndSend(signer, (result) => {
                    const { status, dispatchError, txHash } = result;

                    if (status.isInBlock) {
                        console.log(`  Included in block: ${status.asInBlock.toHex()} (txHash: ${txHash.toHex()})`);
                    } else if (status.isFinalized) {
                        console.log(`  Finalized in block: ${status.asFinalized.toHex()}`);
                    }

                    if (dispatchError && (status.isInBlock || status.isFinalized)) {
                        if (dispatchError.isModule) {
                            const decoded = api.registry.findMetaError(dispatchError.asModule);
                            const errorInfo = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
                            console.error(`  DispatchError: ${errorInfo}`);
                        } else {
                            console.error(`  DispatchError: ${dispatchError.toString()}`);
                        }
                        unsubscribePromise.then((unsub) => unsub()).catch(() => {});
                        reject(new Error('Extrinsic failed'));
                        return;
                    }

                    if (status.isFinalized) {
                        unsubscribePromise.then((unsub) => unsub()).catch(() => {});
                        resolve();
                    }
                })
                .catch(reject);
        });

    }

    console.log(`\nAll releaseDeposit submissions complete (${releasablePairs.length} succeeded).`);

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


