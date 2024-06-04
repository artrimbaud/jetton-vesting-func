import 'dotenv/config';
import { Address, address, beginCell, toNano, } from '@ton/core';
import { jettonContentToCell, JettonMinter } from '../wrappers/Jetton/JettonMinter';
import { JettonWallet } from '../wrappers/Jetton/JettonWallet';


import { compile, NetworkProvider } from '@ton/blueprint';
import { SafeFactory } from '../wrappers/SafeFactory/SafeFactory';
import { Safe } from '../wrappers/Safe/Safe';


export async function run(provider: NetworkProvider) {

    const jettonMinter   = provider.open(
        JettonMinter.createFromConfig(
          {
            admin: Address.parse("UQBqaHqgAegzKkUZh6uQHwyRz1H-mwLl_OY1BRItXAeYxgQI"),
            content: jettonContentToCell({type: 1, uri: "https://testjetton.org/content.json"}),
            wallet_code: await compile('Jetton/JettonWallet'),
          },
          await compile('/Jetton/JettonMinter')));

    let userWallet = async (address:Address) => provider.open(
        JettonWallet.createFromAddress(
          await jettonMinter.getWalletAddress(address)
        )
   );

    const safeAddress = Address.parse("kQCG5Td0NzgQwKKVWnsKtcCwgpt49zS-RDv8rmMcGXpdigS5");

    const safeContract = provider.open(Safe.createFromAddress(safeAddress));

    const sendResult = await safeContract.sendClaimSafeMessage(provider.sender());
    
}