// Required imports
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

async function main() {
  let rpcAddr = process.argv[2] || 'ws://localhost:9999';

  console.log(`\nConnecting to RPC node: ${rpcAddr}\n`);

  // Initialise the provider to connect to the local node
  const provider = new WsProvider(rpcAddr);

  // Create the API and wait until ready
  const api = await ApiPromise.create({ provider });

  // Retrieve the chain & node information via rpc calls
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version()
  ]);

  console.log(`\nYou are connected to chain ${chain} using ${nodeName} v${nodeVersion}\n`);

  // Create a keyring instance with sr25519 type
  const keyring = new Keyring({ type: 'sr25519' });

  // Add Alice account (default test account)
  const alice = keyring.addFromUri('//Alice');

  console.log(`Sending system.remark extrinsic from Alice (${alice.address})...\n`);

  // Create a remark message
  const remarkMessage = 'Hello from HydraDX test script!';

  // Send the remark extrinsic
  try {
    const unsub = await api.tx.system
      .remark(remarkMessage)
      .signAndSend(alice, ({ status, events, dispatchError }) => {
        console.log(`Transaction status: ${status.type}`);

        if (dispatchError) {
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            const { docs, name, section } = decoded;
            console.error(`\nDispatch error: ${section}.${name}: ${docs.join(' ')}`);
          } else {
            console.error(`\nDispatch error: ${dispatchError.toString()}`);
          }
          unsub();
          process.exit(1);
        }

        if (status.isInBlock) {
          console.log(`\nIncluded in block hash: ${status.asInBlock.toHex()}`);

          // Process events
          events.forEach(({ event }) => {
            const { section, method, data } = event;
            console.log(`\t${section}.${method}:`, data.toString());
          });
        } else if (status.isFinalized) {
          console.log(`\nFinalized in block hash: ${status.asFinalized.toHex()}`);
          console.log(`\nRemark successfully sent: "${remarkMessage}"\n`);

          unsub();
          process.exit(0);
        }
      });
  } catch (error) {
    console.error('\nError sending transaction:');
    console.error(error.message);
    console.error('\nThis might be a runtime validation error. Try:');
    console.error('1. Restart your node with the latest runtime');
    console.error('2. Purge chain data: ./target/release/hydradx purge-chain --dev');
    console.error('3. Check if your runtime is properly compiled\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
