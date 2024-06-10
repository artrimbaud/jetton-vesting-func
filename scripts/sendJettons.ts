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

    const sender = Address.parse("0QBqaHqgAegzKkUZh6uQHwyRz1H-mwLl_OY1BRItXAeYxr-C");
    const receiver = Address.parse("0QDw6KsqikTuWEj97m1QCUjYXkW9Xg84NxttP79NMbWyh61E");

    //const senderJettonAddress = Address.parse("kQCOj99Ywl8yrvvfFwPLvOQ9lp7BBlODAvnDhPfTMa5r2jXU");
    //const receiverJettonAddress = Address.parse("kQBnEzb__WomkFYkcI1_PgRbYL4EC-9EBB8RpfGD3u8YIxTW");


    const senderJettonWallet = await userWallet(sender);

    const vestingAddress = SafeFactory.createFromAddress(Address.parse("kQCOj99Ywl8yrvvfFwPLvOQ9lp7BBlODAvnDhPfTMa5r2jXU"));
  
    
    let sentAmount = toNano('30');
    let forwardAmount = toNano('1');

    const safe_data = SafeFactory.safeMintPayloadToCell({
        jetton_receiver: receiver,
        content: Safe.safeContentToCell({
          uri: "17.json"
        }),
        vesting_start_time: 1718008457,
        cliff_duration: 0,
        vesting_total_duration: 1000000,
        unlock_period: 100,
        initially_unlocked_percentage: 10,
    });

    const sendResult = await senderJettonWallet.sendTransfer(
        provider.sender(), 
        toNano('1.5'), //tons
        sentAmount, 
        vestingAddress.address,
        receiver, 
        beginCell().endCell(),
        forwardAmount, 
        safe_data
    );
    
}