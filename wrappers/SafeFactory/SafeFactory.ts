import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { Safe, SafeContent } from '../Safe/Safe';

export type SafeMintPayload = {
    jetton_receiver: Address;
    content: Cell;

    vesting_start_time: number;
    cliff_duration: number;
    vesting_total_duration: number;
    unlock_period: number;
    initially_unlocked_percentage: number;
};

export type SafeFactoryConfig = {
    init: number;
    next_item_index: bigint;
    safe_code: Cell;
    safe_type: boolean;
    jetton_wallet_address: Address;
    jetton_wallet_set: number;
    creator_address: Address;
    content: Cell;
};

export type SafeFactoryContent = {
    image: string;
    name: string;
    description: string;
    cover_image: string;
};

export function SafeFactoryConfigToCell(config: SafeFactoryConfig): Cell {
    return beginCell()
        .storeBit(config.init)
        .storeUint(config.next_item_index, 32)
        .storeRef(config.safe_code)
        .storeBit(config.safe_type)
        .storeAddress(config.jetton_wallet_address)
        .storeBit(config.jetton_wallet_set)
        .storeAddress(config.creator_address)
        .storeRef(config.content)
        .endCell();
}

export class SafeFactory implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new SafeFactory(address);
    }

    static safeMintPayloadToCell(config: SafeMintPayload): Cell {
        return beginCell()
            .storeAddress(config.jetton_receiver)
            .storeRef(
                config.content
            )
            .storeRef(
                Safe.safeVestingAndCliffDataConfigToCell({
                    vesting_start_time: config.vesting_start_time,
                    cliff_duration: config.cliff_duration,
                    vesting_total_duration: config.vesting_total_duration,
                    unlock_period: config.unlock_period,
                    initially_unlocked_percentage: config.initially_unlocked_percentage,
                }),
            )
            .endCell();
    }

    static safeFactoryContentToCell(content: SafeFactoryContent) {
        return beginCell()
                .storeStringTail(content.image)
                .storeStringTail(content.name)
                .storeStringTail(content.description)
                .storeStringTail(content.cover_image)
            .endCell();
                
    }

    static createFromConfig(config: SafeFactoryConfig, code: Cell, workchain = 0) {
        const data = SafeFactoryConfigToCell(config);
        const init = { code, data };
        return new SafeFactory(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async getNextItemIndex(provider: ContractProvider) {
        const result = await provider.get('get_next_item_index', []);
        return result.stack.readBigNumber();
    }

    async getSafeAddressByIndex(provider: ContractProvider, index: bigint) {
        const result = await provider.get('get_safe_address_by_index', [{ type: 'int', value: index }]);

        return result.stack.readAddress();
    }

    async getStorageData(provider: ContractProvider) {
        const result = await provider.get('get_storage_data', []);

        const init = result.stack.readNumber();
        const next_item_index = result.stack.readBigNumber();
        const safe_code = result.stack.readCell();
        const safe_type = result.stack.readNumber();

        const jetton_wallet_address = result.stack.readAddress();
        const jetton_wallet_set = result.stack.readNumber();
        const creator_address = result.stack.readAddress();

        return {
            init,
            next_item_index,
            safe_code,
            safe_type,

            jetton_wallet_address,
            jetton_wallet_set,
            creator_address,
        };
    }
}
