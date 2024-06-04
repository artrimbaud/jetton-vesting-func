import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';
import { Op, Gas } from './SafeConstants';



export type SafeContent = {
    uri: string
};


export type SafeVestingAndCliffConfig = {
    vesting_start_time: number;
    cliff_duration: number;
    vesting_total_duration: number;
    unlock_period: number;
    initially_unlocked_percentage: number;
};

export type SafeConfig = {
    init: number;
    collection_index: bigint;
    collection_address: Address;
    owner_address: Address;
    vesting_and_cliff_data: Cell;
};

export function SafeConfigToCell(config: SafeConfig): Cell {
    return beginCell()
        .storeUint(config.collection_index, 32)
        .storeAddress(config.collection_address)
        .storeAddress(config.owner_address)
        .storeRef(config.vesting_and_cliff_data)
        .endCell();
}

export class Safe implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Safe(address);
    }

    static safeVestingAndCliffDataConfigToCell(config: SafeVestingAndCliffConfig): Cell {
        return beginCell()
            .storeUint(config.vesting_start_time, 32)
            .storeUint(config.cliff_duration, 32)
            .storeUint(config.vesting_total_duration, 32)
            .storeUint(config.unlock_period, 32)
            .storeUint(config.initially_unlocked_percentage, 32)
            .endCell();
    }

    static safeContentToCell(content: SafeContent) {
        return (
            beginCell()
                .storeUint(1, 8) 
                .storeRef(beginCell().storeStringTail(content.uri).endCell())
            .endCell()
        );
    }

    static createFromConfig(config: SafeConfig, code: Cell, workchain = 0) {
        const data = SafeConfigToCell(config);
        const init = { code, data };
        return new Safe(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    static claimSafeMessage() {
        return beginCell()
            .storeUint(Op.claim_safe, 32) // opcode
            .storeUint(0, 64) // queryid
            .endCell();
    }

    async sendClaimSafeMessage(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Safe.claimSafeMessage(),
            value: toNano('0.5'),
        });
    }

    async sendClaimSafeMessageWithNotEnoughGas(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Safe.claimSafeMessage(),
            value: toNano('0.2'),
        });
    }

    async sendTransferSafe(
        provider: ContractProvider,
        via: Sender,
        toAddress: Address,
        forwardAmount: bigint,
        forwardPayload?: Cell,
        queryId?: number,
    ) {
        await provider.internal(via, {
            value: Gas.jetton_transfer,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.transfer_safe, 32)
                .storeUint(queryId ?? 0, 64)
                .storeAddress(toAddress)
                .storeAddress(via.address)
                .storeBit(0)
                .storeCoins(forwardAmount)
                .storeMaybeRef(forwardPayload)

                .endCell(),
        });
    }

    async getStorageData(provider: ContractProvider) {
        const result = await provider.get('get_storage_data', []);

        const init = result.stack.readNumber();
        const collection_index = result.stack.readBigNumber();
        const collection_address = result.stack.readAddress();
        const owner_address = result.stack.readAddress();
        
        const content = result.stack.readCell();

        const vesting_total_amount = result.stack.readBigNumber();
        const claimed_amount = result.stack.readBigNumber();

        const vesting_and_cliff_data = result.stack.readCell();
        const is_active = result.stack.readNumber();
        const is_transferable = result.stack.readBoolean();

        const vesting_and_cliff_data_slice = vesting_and_cliff_data.beginParse();
        const vesting_start_time = vesting_and_cliff_data_slice.loadUint(32);
        const cliff_duration = vesting_and_cliff_data_slice.loadUint(32);
        const vesting_total_duration = vesting_and_cliff_data_slice.loadUint(32);
        const unlock_period = vesting_and_cliff_data_slice.loadUint(32);
        const initially_unlocked_percentage = vesting_and_cliff_data_slice.loadUint(32);

        return {
            init,
            collection_index,
            collection_address,
            owner_address,
            vesting_total_amount,

            vesting_start_time,
            cliff_duration,
            vesting_total_duration,
            unlock_period,
            claimed_amount,
            initially_unlocked_percentage,

            is_active,
            is_transferable,
        };
    }
}
