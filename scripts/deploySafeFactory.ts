import 'dotenv/config';
import { Address, address, toNano, } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';

import { SafeFactory } from '../wrappers/SafeFactory/SafeFactory';


export async function run(provider: NetworkProvider) {

    const safe_code = await compile('/Safe/Safe');


    const safe_factory = provider.open(
        SafeFactory.createFromConfig(
            {
                init: 0,
                next_item_index: BigInt(1),
                safe_code: safe_code,
                safe_type: false,

                jetton_wallet_address: Address.parse("kQDS1Pk3ZsbyS_gyA1qA-J1uXXWzZK8fNoGZ9ynKioDnALSv"),
                jetton_wallet_set: 0,

                creator_address: Address.parse("0QBqaHqgAegzKkUZh6uQHwyRz1H-mwLl_OY1BRItXAeYxr-C"),
                content: SafeFactory.safeFactoryContentToCell({
                    uri: "https://static.storm.tg/vesting/root.json",
                    base: "https://static.storm.tg/vesting/"
                }),
            },
            await compile('/SafeFactory/SafeFactory')
        )
    );

    await safe_factory.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(safe_factory.address);

    console.log('get storage data', await safe_factory.getStorageData());
}